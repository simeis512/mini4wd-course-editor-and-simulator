import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { portKey, sameJoint, type Layout, type PlacedPiece } from '../course/course';
import { GLOBAL_SPEC } from '../course/catalog';
import { supports } from '../course/height';
import { buildCourseMeshes, buildSupportMesh, MM, pieceTracks, roadOutline } from '../course/mesh';
import type { DragHandlers, PickHandlers, Selection } from './selection';
import type { EditorView } from './view';

const BACKGROUND = new THREE.Color(0x1b1d22);

// Three uses a WebXR Layers projection layer whenever the browser offers one.
// On Android Chrome that path left the AR camera feed black, so hide it and
// let three fall back to the long-supported XRWebGLLayer, which composites
// with alpha over the camera image.
if (typeof XRWebGLBinding !== 'undefined' && 'createProjectionLayer' in XRWebGLBinding.prototype) {
  delete (XRWebGLBinding.prototype as Partial<XRWebGLBinding>).createProjectionLayer;
}
const TAP_SLOP = 6;

/**
 * 3D orbit view of the course, with AR (WebXR) for viewing only. Dragging
 * the selected piece moves it across the level it was grabbed at; any other
 * drag orbits the camera.
 */
export class OrbitView implements EditorView {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 0.01, 200);
  private controls: OrbitControls;
  private grid = new THREE.GridHelper(10, 100, 0x555555, 0x333333);
  /** Course in millimetres, scaled to metres. */
  private root = new THREE.Group();
  private pieces: THREE.Group[] = [];
  /** Stands under raised road, shown only (#11). */
  private supports: THREE.Mesh | null = null;
  private markers = new THREE.Group();
  /** Outlines of the selected piece (solid) and the pieces joined to it (dashed), as in the 2D view. */
  private outlines = new THREE.Group();
  private layout: Layout | null = null;
  private active = false;
  private downAt: { x: number; y: number } | null = null;
  /** A piece being dragged: the level plane it moves on and where it was grabbed (course mm). */
  private moving: { plane: THREE.Plane; from: THREE.Vector3; dragged: boolean } | null = null;
  private selection: Selection = null;
  private arStatus: HTMLElement;

  constructor(
    private container: HTMLElement,
    private handlers: PickHandlers & DragHandlers,
  ) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    // Clear to transparent so the camera feed shows through in AR.
    renderer.setClearColor(0x000000, 0);
    renderer.xr.enabled = true;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene.background = BACKGROUND;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(2, 4, 1);
    this.scene.add(sun);
    // Just under the road so the grid does not show through it.
    this.grid.position.y = -0.005;
    this.scene.add(this.grid);
    this.root.scale.setScalar(MM);
    this.root.add(this.markers);
    this.root.add(this.outlines);
    this.scene.add(this.root);

    this.camera.position.set(2, 2.5, -2);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    // Middle drag moves the camera (as in most 3D tools); the wheel still zooms.
    this.controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    this.controls.addEventListener('change', () => this.handlers.onViewChange?.());

    // Our own DOM overlay for AR: an exit button and a status line, so
    // problems on the phone are visible instead of a silent black screen.
    const overlay = document.getElementById('ar-overlay')!;
    this.arStatus = document.getElementById('ar-status')!;
    const arButton = ARButton.createButton(renderer, {
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: overlay },
    });
    arButton.classList.add('ar-button');
    container.appendChild(arButton);
    document.getElementById('ar-exit')!.addEventListener('click', () => void renderer.xr.getSession()?.end());
    renderer.xr.addEventListener('sessionstart', () => {
      document.documentElement.classList.add('xr-presenting');
      overlay.hidden = false;
      const session = renderer.xr.getSession();
      const layer = session?.renderState.layers?.length ? 'projection' : 'webgl';
      this.arStatus.textContent = `AR表示中：コースは足元の少し前に置いています（${session?.environmentBlendMode ?? '?'} / ${layer}）`;
      this.scene.background = null;
      this.grid.visible = false;
      this.controls.enabled = false;
      this.placeForAr();
    });
    renderer.xr.addEventListener('sessionend', () => {
      document.documentElement.classList.remove('xr-presenting');
      overlay.hidden = true;
      this.scene.background = BACKGROUND;
      this.grid.visible = true;
      this.controls.enabled = true;
      this.root.position.set(0, 0, 0);
      // Keep the loop matching the current view now the session is over.
      this.setActive(this.active);
    });

    const el = renderer.domElement;
    // Capture on the container so a drag on the selected piece starts before
    // the orbit controls see the pointer.
    container.addEventListener('pointerdown', (e) => this.onDown(e), { capture: true });
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => {
      const tap = this.downAt !== null && Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) <= TAP_SLOP;
      if (this.moving) {
        const dragged = this.moving.dragged;
        this.moving = null;
        this.handlers.onDragEnd(dragged);
        if (dragged) {
          this.downAt = null;
          return;
        }
      }
      if (tap) this.pick(e);
      this.downAt = null;
    });
    el.addEventListener('pointercancel', () => {
      if (this.moving) this.handlers.onDragEnd(false);
      this.moving = null;
      this.downAt = null;
    });
    new ResizeObserver(() => this.resize()).observe(container);
  }

  setActive(active: boolean): void {
    this.active = active;
    this.resize();
    // Never stop the loop while an AR session is running.
    const run = active || this.renderer.xr.isPresenting;
    this.renderer.setAnimationLoop(run ? () => this.render() : null);
  }

  /** Centre the course on the floor about 1.5 m in front of where AR started. */
  private placeForAr(): void {
    this.root.position.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.root);
    const centre = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    // The 'local' space starts at the phone, so the floor is roughly 1.2 m below.
    this.root.position.set(-centre.x, -1.2, -1.5 - centre.z);
  }

  private onDown(e: PointerEvent): void {
    if (e.target !== this.renderer.domElement || this.renderer.xr.isPresenting) return;
    this.downAt = { x: e.clientX, y: e.clientY };
    const sel = this.selection;
    if (sel?.kind !== 'piece' || !e.isPrimary || e.button !== 0) return;
    const hit = this.raycaster(e).intersectObjects(this.pieces, true)[0];
    if (!hit || pieceOf(hit.object) !== sel.index || !this.handlers.onDragStart(sel.index)) return;
    e.stopPropagation();
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.moving = {
      plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -hit.point.y),
      from: this.root.worldToLocal(hit.point.clone()),
      dragged: false,
    };
  }

  private onMove(e: PointerEvent): void {
    const m = this.moving;
    if (!m || !this.downAt) return;
    if (!m.dragged && Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) <= TAP_SLOP) return;
    const at = this.raycaster(e).ray.intersectPlane(m.plane, new THREE.Vector3());
    if (!at) return;
    m.dragged = true;
    const p = this.root.worldToLocal(at);
    this.handlers.onDragMove(p.x - m.from.x, p.z - m.from.z, e.shiftKey);
  }

  setData(layout: Layout, selection: Selection): void {
    this.selection = selection;
    if (layout !== this.layout) {
      this.layout = layout;
      for (const p of this.pieces) this.root.remove(p);
      this.pieces = buildCourseMeshes(layout);
      for (const p of this.pieces) this.root.add(p);
      if (this.supports) {
        this.root.remove(this.supports);
        this.supports.geometry.dispose();
      }
      this.supports = buildSupportMesh(supports(layout));
      this.root.add(this.supports);
    }
    // The selected piece glows; the pieces joined to it (which move with it) glow faintly.
    const group = selection?.kind === 'piece' ? layout.group[selection.index] : -1;
    this.pieces.forEach((g, i) => {
      const level = selection?.kind === 'piece' && selection.index === i ? 2 : layout.group[i] === group ? 1 : 0;
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) o.material = level ? highlighted(o.material, level) : unhighlighted(o.material);
      });
    });
    this.outlines.clear();
    if (selection?.kind === 'piece') {
      layout.pieces.forEach((pc, i) => {
        if (layout.group[i] !== group) return;
        for (const line of outlineOf(pc, i, i === selection.index)) this.outlines.add(line);
      });
    }
    this.markers.clear();
    const split = new Set(layout.split.map(portKey));
    for (const ref of layout.open) {
      const selected = selection?.kind === 'port' && portKey(selection.ref) === portKey(ref);
      const m = new THREE.Mesh(MARKER_GEOMETRY, selected ? MARKER_SELECTED : split.has(portKey(ref)) ? MARKER_SPLIT : MARKER_OPEN);
      m.applyMatrix4(layout.pieces[ref.piece].ports[ref.port]);
      m.userData.port = ref;
      this.markers.add(m);
    }
    for (const j of layout.joints) {
      const selected = selection?.kind === 'joint' && sameJoint(selection, j);
      const m = new THREE.Mesh(JOINT_GEOMETRY, selected ? MARKER_SELECTED : MARKER_JOINT);
      m.applyMatrix4(layout.pieces[j.a.piece].ports[j.a.port]);
      m.userData.joint = { a: j.a, b: j.b };
      this.markers.add(m);
    }
  }

  /** Point on the page over the course point (mm), or null when it is behind the camera. */
  clientOf(x: number, y: number, z: number): [number, number] | null {
    this.root.updateMatrixWorld();
    const p = this.root.localToWorld(new THREE.Vector3(x, y, z)).project(this.camera);
    if (p.z > 1) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    return [r.left + ((p.x + 1) / 2) * r.width, r.top + ((1 - p.y) / 2) * r.height];
  }

  /** Floor point (course mm, X/Z) the camera looks at. */
  get centre(): [number, number] {
    return [this.controls.target.x / MM, this.controls.target.z / MM];
  }

  /** Floor point (course mm, X/Z) under a point on the page, or null when it is off the view or above the horizon. */
  floorAt(clientX: number, clientY: number): [number, number] | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    if (clientX < r.left || clientY < r.top || clientX > r.right || clientY > r.bottom) return null;
    const at = this.raycaster({ clientX, clientY }).ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    if (!at) return null;
    const p = this.root.worldToLocal(at);
    return [p.x, p.z];
  }

  /** Aim the camera at the whole course. */
  fit(): void {
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.root);
    if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 0, 0.5));
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    this.controls.target.copy(centre);
    this.camera.position.copy(centre).add(new THREE.Vector3(0.35, 0.7, -0.6).multiplyScalar(size));
    this.camera.near = size / 1000;
    this.camera.far = size * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!this.active || w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.handlers.onViewChange?.();
  }

  private render(): void {
    try {
      if (!this.renderer.xr.isPresenting) this.controls.update();
      this.renderer.render(this.scene, this.camera);
    } catch (e) {
      this.arStatus.textContent = `描画エラー: ${(e as Error).message}`;
      throw e;
    }
  }

  private raycaster(e: { clientX: number; clientY: number }): THREE.Raycaster {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    return ray;
  }

  private pick(e: PointerEvent): void {
    const hit = this.raycaster(e).intersectObjects([this.markers, ...this.pieces], true)[0];
    if (!hit) return this.handlers.onPick(null);
    if (hit.object.userData.port) return this.handlers.onPick({ kind: 'port', ref: hit.object.userData.port });
    if (hit.object.userData.joint) return this.handlers.onPick({ kind: 'joint', ...hit.object.userData.joint });
    const piece = pieceOf(hit.object);
    this.handlers.onPick(piece === null ? null : { kind: 'piece', index: piece });
  }
}

function pieceOf(object: THREE.Object3D): number | null {
  let o: THREE.Object3D | null = object;
  while (o && o.userData.piece === undefined) o = o.parent;
  return o ? o.userData.piece : null;
}

const OUTLINE_SOLID = new THREE.LineBasicMaterial({ color: 0x3fd0ff });
const OUTLINE_DASHED = new THREE.LineDashedMaterial({ color: 0x3fd0ff, dashSize: 50, gapSize: 30 });

/** The edge of a piece's road at the height of its fence tops, one loop per track. */
function outlineOf(pc: PlacedPiece, index: number, solid: boolean): THREE.Line[] {
  const y = GLOBAL_SPEC.fenceHeight + 1;
  return pieceTracks(pc, index).map(({ samples, section }) => {
    const pts = roadOutline(samples, section, y);
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), solid ? OUTLINE_SOLID : OUTLINE_DASHED);
    if (!solid) line.computeLineDistances();
    return line;
  });
}

const MARKER_GEOMETRY = new THREE.ConeGeometry(45, 90, 16).rotateX(Math.PI / 2).translate(0, 30, 30);
const MARKER_OPEN = new THREE.MeshStandardMaterial({ color: 0xff9a2e, emissive: 0x552200 });
const MARKER_SELECTED = new THREE.MeshStandardMaterial({ color: 0x3fd0ff, emissive: 0x114455 });
const MARKER_SPLIT = new THREE.MeshStandardMaterial({ color: 0xff5a5a, emissive: 0x551111 });
const MARKER_JOINT = new THREE.MeshStandardMaterial({ color: 0x39c26b, emissive: 0x0d3d1f });
/** A flat bar across the middle of a joint, standing just above the road. */
const JOINT_GEOMETRY = new THREE.BoxGeometry(90, 12, 24).translate(0, 8, 0);

const HIGHLIGHT = [0, 0x0a2a35, 0x1a6680];
const highlightCache = [0, 1, 2].map(() => new WeakMap<THREE.Material, THREE.Material>());
const baseOf = new WeakMap<THREE.Material, THREE.Material>();

/** `level` 2: the selection; 1: joined to it. */
function highlighted(m: THREE.Material | THREE.Material[], level: number): THREE.Material {
  const base = unhighlighted(m);
  let h = highlightCache[level].get(base);
  if (!h) {
    const c = (base as THREE.MeshStandardMaterial).clone();
    c.emissive = new THREE.Color(HIGHLIGHT[level]);
    highlightCache[level].set(base, c);
    baseOf.set(c, base);
    h = c;
  }
  return h;
}

function unhighlighted(m: THREE.Material | THREE.Material[]): THREE.Material {
  const single = Array.isArray(m) ? m[0] : m;
  return baseOf.get(single) ?? single;
}
