import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { MM } from '../course/mesh';
import { AR_SCALES, AR_TURN_STEP, arPose, floorPivot, headingOf, nextScale, scaleLabel } from './ar-pose';

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
}

/** Where the course goes when the floor cannot be found: this far in front of the phone and below it, m. */
const FALLBACK_AHEAD = 1.5;
const FALLBACK_BELOW = 1.2;

/**
 * AR (WebXR) for viewing the course only (spec 8, #19): the button, our
 * overlay, and where the course stands. The course follows the floor point
 * the phone aims at until a tap puts it down; it can then be turned, shown
 * at real size or smaller, or put down again.
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
  private buttons: { scale: HTMLButtonElement; replace: HTMLButtonElement };

  constructor(
    private renderer: THREE.WebGLRenderer,
    container: HTMLElement,
    private root: THREE.Object3D,
    scene: THREE.Scene,
    hooks: ArHooks,
  ) {
    // Our own DOM overlay for AR: an exit button, the controls and a status
    // line, so problems on the phone are visible instead of a silent black screen.
    const overlay = document.getElementById('ar-overlay')!;
    this.status = document.getElementById('ar-status')!;
    const arButton = ARButton.createButton(renderer, {
      optionalFeatures: ['dom-overlay', 'hit-test'],
      domOverlay: { root: overlay },
    });
    arButton.classList.add('ar-button');
    container.appendChild(arButton);

    this.reticle = new THREE.Mesh(RETICLE_GEOMETRY, RETICLE_MATERIAL);
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    scene.add(this.reticle);

    const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
    this.buttons = { scale: button('ar-scale'), replace: button('ar-replace') };
    button('ar-exit').addEventListener('click', () => void renderer.xr.getSession()?.end());
    button('ar-turn-left').addEventListener('click', () => this.turn(AR_TURN_STEP));
    button('ar-turn-right').addEventListener('click', () => this.turn(-AR_TURN_STEP));
    this.buttons.scale.addEventListener('click', () => {
      this.scale = nextScale(this.scale);
      this.update();
    });
    this.buttons.replace.addEventListener('click', () => this.startAiming());
    // A tap on our controls must not also count as a tap on the floor.
    document.getElementById('ar-controls')!.addEventListener('beforexrselect', (e) => e.preventDefault());

    renderer.xr.addEventListener('sessionstart', () => {
      document.documentElement.classList.add('xr-presenting');
      overlay.hidden = false;
      hooks.onStart();
      this.pivot = this.coursePivot();
      const session = renderer.xr.getSession()!;
      session.addEventListener('select', () => this.putDown());
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
    if (!this.aiming || this.hitPending) return;
    if (this.hitSource) {
      const pose = frame.getHitTestResults(this.hitSource)[0]?.getPose(space);
      this.reticle.visible = !!pose;
      if (pose) {
        this.reticle.matrix.fromArray(pose.transform.matrix);
        this.at = new THREE.Vector3().setFromMatrixPosition(this.reticle.matrix);
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
    this.status.textContent = !this.aiming
      ? `${scaleLabel(this.scale)}で表示中。「置き直す」で場所を変えられます`
      : this.reticle.visible
          ? '床をタップするとコースをそこに置きます'
          : 'スマホを床に向けて、ゆっくり動かしてください';
  }
}

const RETICLE_GEOMETRY = new THREE.RingGeometry(0.06, 0.08, 32).rotateX(-Math.PI / 2);
const RETICLE_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x3fd0ff });
