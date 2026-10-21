import * as THREE from 'three';
import { dotCell } from './ar-pose';

/** Distance between the dots left where the floor was found, m. */
const DOT_SPACING = 0.05;
/** Most dots kept; older ones are reused after this. */
const DOT_LIMIT = 3000;
/**
 * What the phone has found of the floor while the course is being aimed (#19):
 * a dot on every floor point the ring has touched. The depth view is `ArDepth`.
 */
export class ArScan {
  private dots: THREE.InstancedMesh;
  private cells = new Set<string>();
  private count = 0;

  constructor(scene: THREE.Scene) {
    this.dots = new THREE.InstancedMesh(DOT_GEOMETRY, DOT_MATERIAL, DOT_LIMIT);
    this.dots.count = 0;
    this.dots.frustumCulled = false;
    scene.add(this.dots);
  }

  /** Leave a dot at a floor point the ring touched, unless one is already near. */
  addDot(at: THREE.Vector3): void {
    const cell = dotCell(at, DOT_SPACING);
    if (this.cells.has(cell)) return;
    this.cells.add(cell);
    this.dots.setMatrixAt(this.count % DOT_LIMIT, new THREE.Matrix4().makeTranslation(at.x, at.y, at.z));
    this.count++;
    this.dots.count = Math.min(this.count, DOT_LIMIT);
    this.dots.instanceMatrix.needsUpdate = true;
  }

  /** Show the dots only while aiming. */
  set visible(on: boolean) {
    this.dots.visible = on;
  }

  /** Forget what was found, at the end of a session. */
  clear(): void {
    this.cells.clear();
    this.count = 0;
    this.dots.count = 0;
  }
}

const DOT_GEOMETRY = new THREE.CircleGeometry(0.008, 8).rotateX(-Math.PI / 2).translate(0, 0.002, 0);
// Not hidden by the real floor they lie on (occlusion, see ArDepth).
const DOT_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthTest: false });

