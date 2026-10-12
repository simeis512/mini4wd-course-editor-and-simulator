import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { portKey, type Layout } from '../course/course';
import { buildCourseMeshes, MM } from '../course/mesh';
import type { PickHandlers, Selection } from './selection';

const BACKGROUND = new THREE.Color(0x1b1d22);
const TAP_SLOP = 6;

/** 3D orbit view of the course, with AR (WebXR) for viewing only. */
export class OrbitView {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 0.01, 200);
  private controls: OrbitControls;
  private grid = new THREE.GridHelper(10, 100, 0x555555, 0x333333);
  /** Course in millimetres, scaled to metres. */
  private root = new THREE.Group();
  private pieces: THREE.Group[] = [];
  private markers = new THREE.Group();
  private layout: Layout | null = null;
  private active = false;
  private downAt: { x: number; y: number } | null = null;

  constructor(
    private container: HTMLElement,
    private handlers: PickHandlers,
  ) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
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
    this.scene.add(this.root);

    this.camera.position.set(2, 2.5, -2);
    this.controls = new OrbitControls(this.camera, renderer.domElement);

    const arButton = ARButton.createButton(renderer);
    arButton.classList.add('ar-button');
    container.appendChild(arButton);
    renderer.xr.addEventListener('sessionstart', () => {
      this.scene.background = null;
      this.grid.visible = false;
      // Put the course on the floor a little in front of the viewer.
      this.root.position.set(0, -0.8, -1.2);
    });
    renderer.xr.addEventListener('sessionend', () => {
      this.scene.background = BACKGROUND;
      this.grid.visible = true;
      this.root.position.set(0, 0, 0);
    });

    const el = renderer.domElement;
    el.addEventListener('pointerdown', (e) => (this.downAt = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => {
      if (this.downAt && Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) <= TAP_SLOP) this.pick(e);
      this.downAt = null;
    });
    new ResizeObserver(() => this.resize()).observe(container);
  }

  setActive(active: boolean): void {
    this.active = active;
    this.resize();
    this.renderer.setAnimationLoop(active ? () => this.render() : null);
  }

  setData(layout: Layout, selection: Selection): void {
    if (layout !== this.layout) {
      this.layout = layout;
      for (const p of this.pieces) this.root.remove(p);
      this.pieces = buildCourseMeshes(layout);
      for (const p of this.pieces) this.root.add(p);
    }
    this.pieces.forEach((g, i) => {
      const on = selection?.kind === 'piece' && selection.index === i;
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) o.material = on ? highlighted(o.material) : unhighlighted(o.material);
      });
    });
    this.markers.clear();
    for (const ref of layout.open) {
      const selected = selection?.kind === 'port' && portKey(selection.ref) === portKey(ref);
      const m = new THREE.Mesh(MARKER_GEOMETRY, selected ? MARKER_SELECTED : MARKER_OPEN);
      m.applyMatrix4(layout.pieces[ref.piece].ports[ref.port]);
      m.userData.port = ref;
      this.markers.add(m);
    }
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
  }

  private render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private pick(e: PointerEvent): void {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObjects([this.markers, ...this.pieces], true)[0];
    if (!hit) return this.handlers.onPick(null);
    if (hit.object.userData.port) return this.handlers.onPick({ kind: 'port', ref: hit.object.userData.port });
    let o: THREE.Object3D | null = hit.object;
    while (o && o.userData.piece === undefined) o = o.parent;
    this.handlers.onPick(o ? { kind: 'piece', index: o.userData.piece } : null);
  }
}

const MARKER_GEOMETRY = new THREE.ConeGeometry(45, 90, 16).rotateX(Math.PI / 2).translate(0, 30, 30);
const MARKER_OPEN = new THREE.MeshStandardMaterial({ color: 0xff9a2e, emissive: 0x552200 });
const MARKER_SELECTED = new THREE.MeshStandardMaterial({ color: 0x3fd0ff, emissive: 0x114455 });

const highlightCache = new WeakMap<THREE.Material, THREE.Material>();
const baseOf = new WeakMap<THREE.Material, THREE.Material>();

function highlighted(m: THREE.Material | THREE.Material[]): THREE.Material {
  const base = unhighlighted(m);
  let h = highlightCache.get(base);
  if (!h) {
    const c = (base as THREE.MeshStandardMaterial).clone();
    c.emissive = new THREE.Color(0x1a6680);
    highlightCache.set(base, c);
    baseOf.set(c, base);
    h = c;
  }
  return h;
}

function unhighlighted(m: THREE.Material | THREE.Material[]): THREE.Material {
  const single = Array.isArray(m) ? m[0] : m;
  return baseOf.get(single) ?? single;
}
