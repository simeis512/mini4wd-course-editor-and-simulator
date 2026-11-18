import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { REGULATION } from '../machine/parts';
import { rideHeight, type MachineSpec } from '../physics/machine-spec';
import { buildMachineMesh } from '../physics/machine-mesh';

// The machine screen's 3D look at the machine (#31): the machine as the
// physics builds it, on a road with the regulation's width and length
// marked round it, turned with the mouse or fingers. Drawn only when
// something changes.

const VIEW = { fov: 35, from: new THREE.Vector3(-170, 140, 200) };
/** How solid the chassis box looks here (cosmetic). */
const CHASSIS_OPACITY = 0.35;

export class MachinePreview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(VIEW.fov, 1, 1, 5000);
  private controls: OrbitControls;
  private machine: THREE.Group | null = null;
  private resize = new ResizeObserver(() => this.fitSize());

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(devicePixelRatio);
    host.append(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-1, 2, 1.5);
    this.scene.add(sun);
    this.scene.add(this.road());
    this.camera.position.copy(VIEW.from);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 10, 0);
    this.controls.minDistance = 80;
    this.controls.maxDistance = 1200;
    this.controls.addEventListener('change', () => this.draw());
    this.controls.update();
    this.resize.observe(host);
  }

  /** A road under the machine, with the regulation's outline on it. */
  private road(): THREE.Group {
    const g = new THREE.Group();
    const road = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3a3e47, roughness: 0.9 }));
    g.add(road);
    const grid = new THREE.GridHelper(400, 40, 0x555b66, 0x474c56);
    grid.position.y = 0.05;
    g.add(grid);
    const w = REGULATION.width / 2;
    const l = REGULATION.length / 2;
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(w, 0.1, l), new THREE.Vector3(-w, 0.1, l), new THREE.Vector3(-w, 0.1, -l), new THREE.Vector3(w, 0.1, -l)]),
      new THREE.LineBasicMaterial({ color: 0x3fd0ff }),
    );
    g.add(outline);
    return g;
  }

  show(spec: MachineSpec): void {
    if (this.machine) {
      this.scene.remove(this.machine);
      this.machine.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
    this.machine = buildMachineMesh(spec);
    // See through the chassis box to the dampers, brakes and weights under it.
    const box = this.machine.children[0] as THREE.Mesh;
    Object.assign(box.material as THREE.MeshStandardMaterial, { transparent: true, opacity: CHASSIS_OPACITY, depthWrite: false });
    // Its origin is the chassis box's middle: set it on the road.
    this.machine.position.y = rideHeight(spec) * 1000;
    this.scene.add(this.machine);
    this.draw();
  }

  private fitSize(): void {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.draw();
  }

  draw(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
