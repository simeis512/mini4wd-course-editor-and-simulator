import * as THREE from 'three';

// Seeing the machine through fences from the side camera (#136, owner
// 2026-10-30): only the fences near the machine that stand between it and
// the camera are made see-through; the rest stay as they are.

/** How much of a fence still shows when it is seen through (cosmetic). */
const SEE_THROUGH_OPACITY = 0.25;

const faded = new Map<THREE.Material, THREE.Material>();

/** A see-through copy of a fence's material, made once for each. */
function fadedOf(m: THREE.Material): THREE.Material {
  let f = faded.get(m);
  if (!f) {
    f = m.clone();
    f.transparent = true;
    f.opacity = SEE_THROUGH_OPACITY;
    f.depthWrite = false;
    faded.set(m, f);
  }
  return f;
}

export class FenceFade {
  /** Fences now seen through, with their own materials. */
  private shown = new Map<THREE.Mesh, THREE.Material>();
  private ray = new THREE.Raycaster();

  /**
   * See through the fences of `pieces` that the lines from `eye` to
   * `points` (world) pass through; give back the others. Null gives all back.
   */
  update(pieces: readonly THREE.Object3D[], eye: THREE.Vector3, points: THREE.Vector3[] | null): void {
    const hit = new Set<THREE.Mesh>();
    if (points) {
      const fences: THREE.Mesh[] = [];
      for (const p of pieces) for (const c of p.children) if (c.name === 'fence') fences.push(c as THREE.Mesh);
      // Only fences the lines can reach: a box round them all.
      const reach = new THREE.Box3().setFromPoints([eye, ...points]);
      const near = fences.filter((f) => {
        f.geometry.boundingBox ?? f.geometry.computeBoundingBox();
        return reach.intersectsBox(f.geometry.boundingBox!.clone().applyMatrix4(f.matrixWorld));
      });
      for (const p of points) {
        const d = p.clone().sub(eye);
        this.ray.set(eye, d.clone().normalize());
        this.ray.far = d.length();
        for (const h of this.ray.intersectObjects(near, false)) hit.add(h.object as THREE.Mesh);
      }
    }
    for (const [mesh, own] of this.shown) {
      if (hit.has(mesh)) continue;
      mesh.material = own;
      this.shown.delete(mesh);
    }
    for (const mesh of hit) {
      if (this.shown.has(mesh)) continue;
      this.shown.set(mesh, mesh.material as THREE.Material);
      mesh.material = fadedOf(mesh.material as THREE.Material);
    }
  }
}
