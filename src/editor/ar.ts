import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { MM } from '../course/mesh';
import { ArGestures } from './ar-gesture';
import { ArDepth, DEPTH_SENSING } from './ar-depth';
import { ArScan } from './ar-scan';
import { AR_SCALES, AR_TURN_STEP, arPose, edgeArrow, floorPivot, headingOf, nextScale, scaleLabel, turnAbout } from './ar-pose';

// Three uses a WebXR Layers projection layer whenever the browser offers one.
// On Android Chrome that path left the AR camera feed black, so hide it and
// let three fall back to the long-supported XRWebGLLayer, which composites
// with alpha over the camera image.
if (typeof XRWebGLBinding !== 'undefined' && 'createProjectionLayer' in XRWebGLBinding.prototype) {
  delete (XRWebGLBinding.prototype as Partial<XRWebGLBinding>).createProjectionLayer;
}

/** What the 3D view changes while AR runs. */
export interface ArHooks {
  onStart(): void;
  onEnd(): void;
  /** The running machine on the course, if any (#99). */
  machine(): THREE.Object3D | null;
}

/** Where the course goes when the floor cannot be found: this far in front of the phone and below it, m. */
const FALLBACK_AHEAD = 1.5;
const FALLBACK_BELOW = 1.2;

/**
 * AR (WebXR) for the course (spec 8, #19): the button, our overlay, and
 * where the course stands. The course follows the floor point the phone
 * aims at until a tap puts it down; it can then be turned, shown at real
 * size or smaller, or put down again. The machine can run on it (#99, run
 * by RunMode), with an arrow at the screen's edge while it is out of sight.
 */
export class ArMode {
  readonly status: HTMLElement;
  /** The size shown, kept from one session to the next. */
  private scale: number = AR_SCALES[0];
  private yaw = 0;
  /** Course point (mm) that stands on the floor point. */
  private pivot = new THREE.Vector3();
  /** Floor point (scene m) the course stands on, or null until one is known. */
  private at: THREE.Vector3 | null = null;
  /** Following the aimed floor point; false once put down. */
  private aiming = false;
  /** Turn the course to face the way the phone looks at the next frame. */
  private faceViewer = false;
  private hitSource: XRHitTestSource | null = null;
  /** Whether the phone is still being asked for floor finding. */
  private hitPending = false;
  /** Ring on the floor point being aimed at. */
  private reticle: THREE.Mesh;
  private buttons: { scale: HTMLButtonElement; replace: HTMLButtonElement; depth: HTMLButtonElement; occlusion: HTMLButtonElement };
  /** What has been found of the room, shown while aiming. */
  private scan: ArScan;
  /** The phone's depth view, coloured and for occlusion. */
  private depth: ArDepth;
  /** Whether this session shares the phone's depth view. */
  private hasDepth = false;
  private gestures: ArGestures;
  /** Points to the machine while it is off the screen. */
  private arrow: HTMLElement;

  constructor(
    private renderer: THREE.WebGLRenderer,
    container: HTMLElement,
    private root: THREE.Object3D,
    scene: THREE.Scene,
    private hooks: ArHooks,
  ) {
    // Our own DOM overlay for AR: an exit button, the controls and a status
    // line, so problems on the phone are visible instead of a silent black screen.
    const overlay = document.getElementById('ar-overlay')!;
    this.status = document.getElementById('ar-status')!;
    this.arrow = document.getElementById('ar-arrow')!;
    const arButton = ARButton.createButton(renderer, {
      optionalFeatures: ['dom-overlay', 'hit-test', 'depth-sensing'],
      domOverlay: { root: overlay },
      depthSensing: DEPTH_SENSING,
    });
    arButton.classList.add('ar-button');
    container.appendChild(arButton);

    this.reticle = new THREE.Mesh(RETICLE_GEOMETRY, RETICLE_MATERIAL);
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    scene.add(this.reticle);
    this.scan = new ArScan(scene);
    this.depth = new ArDepth(scene);

    const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
    this.buttons = { scale: button('ar-scale'), replace: button('ar-replace'), depth: button('ar-depth'), occlusion: button('ar-occlusion') };
    button('ar-exit').addEventListener('click', () => void renderer.xr.getSession()?.end());
    button('ar-turn-left').addEventListener('click', () => this.turn(AR_TURN_STEP));
    button('ar-turn-right').addEventListener('click', () => this.turn(-AR_TURN_STEP));
    this.buttons.scale.addEventListener('click', () => {
      this.scale = nextScale(this.scale);
      this.update();
    });
    this.buttons.replace.addEventListener('click', () => this.startAiming());
    this.buttons.depth.addEventListener('click', () => {
      this.depth.viewWanted = !this.depth.viewWanted;
      this.update();
    });
    this.buttons.occlusion.addEventListener('click', () => {
      this.depth.occlusionWanted = !this.depth.occlusionWanted;
      this.update();
    });
    this.gestures = new ArGestures(document.getElementById('ar-touch')!, {
      enabled: () => !this.aiming && !!this.at,
      onDrag: (from, to) => this.drag(from, to),
      onTwist: (turn, centre) => this.twist(-turn, centre),
    });
    // A tap on our controls must not also count as a tap on the floor.
    for (const id of ['ar-controls', 'ar-run']) document.getElementById(id)!.addEventListener('beforexrselect', (e) => e.preventDefault());

    renderer.xr.addEventListener('sessionstart', () => {
      document.documentElement.classList.add('xr-presenting');
      overlay.hidden = false;
      hooks.onStart();
      this.pivot = this.coursePivot();
      const session = renderer.xr.getSession()!;
      session.addEventListener('select', () => this.putDown());
      this.hasDepth = ArDepth.available(session);
      this.hitSource = null;
      this.hitPending = true;
      void session
        .requestReferenceSpace('viewer')
        .then(async (space) => (this.hitSource = (await session.requestHitTestSource?.({ space })) ?? null))
        .catch(() => null)
        .finally(() => (this.hitPending = false));
      this.at = null;
      this.startAiming();
    });
    renderer.xr.addEventListener('sessionend', () => {
      document.documentElement.classList.remove('xr-presenting');
      overlay.hidden = true;
      this.hitSource?.cancel();
      this.hitSource = null;
      this.reticle.visible = false;
      this.scan.clear();
      this.depth.hide();
      this.gestures.clear();
      this.arrow.hidden = true;
      this.root.visible = true;
      this.root.matrixAutoUpdate = true;
      this.root.position.set(0, 0, 0);
      this.root.quaternion.identity();
      this.root.scale.setScalar(MM);
      hooks.onEnd();
    });
  }

  /** Follow the floor each frame while aiming; call before rendering an AR frame. */
  onFrame(frame: XRFrame | undefined): void {
    const space = this.renderer.xr.getReferenceSpace();
    if (!frame || !space) return;
    const viewer = frame.getViewerPose(space);
    if (this.faceViewer && viewer) {
      const o = viewer.transform.orientation;
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(o.x, o.y, o.z, o.w));
      this.yaw = headingOf(forward);
      this.faceViewer = false;
    }
    if (this.hasDepth) this.depth.update(frame, viewer?.views[0], this.aiming);
    this.pointAtMachine(viewer?.views[0]);
    if (!this.aiming) return;
    if (this.hitPending) return;
    if (this.hitSource) {
      const pose = frame.getHitTestResults(this.hitSource)[0]?.getPose(space);
      this.reticle.visible = !!pose;
      if (pose) {
        this.reticle.matrix.fromArray(pose.transform.matrix);
        this.at = new THREE.Vector3().setFromMatrixPosition(this.reticle.matrix);
        this.scan.addDot(this.at);
      }
    } else if (viewer) {
      // No floor finding on this phone: stand the course in front, a little below.
      const p = viewer.transform.position;
      const ahead = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(FALLBACK_AHEAD);
      this.at = new THREE.Vector3(p.x, p.y - FALLBACK_BELOW, p.z).add(ahead);
      this.aiming = false;
    }
    this.update();
  }

  /** Show the arrow at the screen's edge towards the machine while it is off the screen (#99). */
  private pointAtMachine(view: XRView | undefined): void {
    const machine = this.hooks.machine();
    let at: ReturnType<typeof edgeArrow> = null;
    if (machine && view && this.root.visible) {
      machine.updateWorldMatrix(true, false);
      const p = new THREE.Vector3().setFromMatrixPosition(machine.matrixWorld);
      p.applyMatrix4(new THREE.Matrix4().fromArray(view.transform.inverse.matrix));
      const behind = p.z > 0;
      p.applyMatrix4(new THREE.Matrix4().fromArray(view.projectionMatrix));
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) at = edgeArrow(p.x, p.y, behind);
    }
    this.arrow.hidden = !at;
    if (!at) return;
    this.arrow.style.left = `${((at.x + 1) / 2) * window.innerWidth}px`;
    this.arrow.style.top = `${((1 - at.y) / 2) * window.innerHeight}px`;
    // Screen y points down.
    this.arrow.style.transform = `translate(-50%, -50%) rotate(${-at.angle}rad)`;
  }

  /** Follow the aimed floor point again, facing the way the phone looks. */
  private startAiming(): void {
    this.aiming = true;
    this.faceViewer = true;
    this.update();
  }

  /** Put the course down where it stands (a tap on the floor). */
  private putDown(): void {
    if (!this.aiming || !this.at) return;
    this.aiming = false;
    this.reticle.visible = false;
    this.update();
  }

  /** Slide the course so the floor under the finger follows it. */
  private drag(from: { x: number; y: number }, to: { x: number; y: number }): void {
    if (!this.at) return;
    const a = this.floorUnder(from, this.at.y);
    const b = this.floorUnder(to, this.at.y);
    if (!a || !b) return;
    this.at.add(b.sub(a));
    this.update();
  }

  /** Turn the course by `turn` (radians about the up axis) around the floor under a point on the screen (#19). */
  private twist(turn: number, centre: { x: number; y: number }): void {
    if (!this.at) return;
    const c = this.floorUnder(centre, this.at.y);
    if (c) this.at = turnAbout(this.at, c, turn);
    this.yaw += turn;
    this.update();
  }

  /** Scene point at height `y` under a point on the (full-screen) AR view, or null above the horizon. */
  private floorUnder(p: { x: number; y: number }, y: number): THREE.Vector3 | null {
    const xr = this.renderer.xr.getCamera();
    const camera = xr.cameras[0] ?? xr;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((p.x / window.innerWidth) * 2 - 1, -(p.y / window.innerHeight) * 2 + 1), camera);
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
  }

  private turn(degrees: number): void {
    this.yaw += THREE.MathUtils.degToRad(degrees);
    this.update();
  }

  /** The course point (mm) to stand on the floor, from the course as the 3D view shows it. */
  private coursePivot(): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.root);
    return floorPivot(box.isEmpty() ? box : new THREE.Box3(box.min.divideScalar(MM), box.max.divideScalar(MM)));
  }

  /** Stand the course where it belongs and bring the overlay up to date. */
  private update(): void {
    this.root.visible = !!this.at;
    if (this.at) {
      this.root.matrixAutoUpdate = false;
      this.root.matrix.copy(arPose(this.pivot, this.at, this.yaw, this.scale));
      this.root.matrixWorldNeedsUpdate = true;
    }
    this.buttons.scale.textContent = `大きさ：${scaleLabel(this.scale)}`;
    this.buttons.replace.hidden = this.aiming;
    this.scan.visible = this.aiming;
    this.buttons.depth.hidden = !this.aiming || !this.hasDepth;
    this.buttons.depth.textContent = this.depth.viewWanted ? '奥行き：表示' : '奥行き：非表示';
    this.buttons.occlusion.hidden = !this.hasDepth;
    this.buttons.occlusion.textContent = this.depth.occlusionWanted ? '隠れ：オン' : '隠れ：オフ';
    this.status.textContent = !this.aiming
      ? `${scaleLabel(this.scale)}で表示中。ドラッグで移動、2本指で回転、「置き直す」で選び直し`
      : this.reticle.visible
          ? '床をタップするとコースをそこに置きます'
          : 'スマホを床に向けて、ゆっくり動かしてください';
  }
}

const RETICLE_GEOMETRY = new THREE.RingGeometry(0.06, 0.08, 32).rotateX(-Math.PI / 2);
// Not hidden by the real floor it lies on (occlusion, see ArDepth).
const RETICLE_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x3fd0ff, depthTest: false });
