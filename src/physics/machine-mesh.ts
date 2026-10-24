import * as THREE from 'three';
import { rideHeight, wheelPoints } from './machine';
import type { MachineSpec } from './machine-spec';

// How the machine looks in the 3D view (#27): its chassis box, tyres and
// rollers, in millimetres like the course, with its origin at the chassis
// box's middle as in the physics.

/** Orange, to stand out on white, red and blue roads. */
const COLORS = { chassis: '#ff8a1f', tyre: '#1b1d22', roller: '#e8e8e8' };

/** Millimetres in a metre: the spec is in metres. */
const M = 1000;

function mesh(geometry: THREE.BufferGeometry, color: string): THREE.Mesh {
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
}

/** The machine drawn from its spec; its tyres are children named `tyre` that `spinTyres` turns. */
export function buildMachineMesh(spec: MachineSpec): THREE.Group {
  const g = new THREE.Group();
  g.name = 'machine';
  const [w, h, l] = spec.size;
  g.add(mesh(new THREE.BoxGeometry(w * M, h * M, l * M), COLORS.chassis));
  const tyre = new THREE.CylinderGeometry(spec.tyreRadius * M, spec.tyreRadius * M, spec.tyreWidth * M, 24).rotateZ(Math.PI / 2);
  for (const [x, , z] of wheelPoints(spec)) {
    const t = mesh(tyre, COLORS.tyre);
    t.name = 'tyre';
    // Axles a tyre's radius above the road.
    t.position.set(x * M, (spec.tyreRadius - rideHeight(spec)) * M, z * M);
    g.add(t);
  }
  for (const r of spec.rollers) {
    const roller = mesh(new THREE.CylinderGeometry(r.radius * M, r.radius * M, r.height * M, 20), COLORS.roller);
    roller.position.set(r.at[0] * M, (r.at[1] - rideHeight(spec)) * M, r.at[2] * M);
    g.add(roller);
  }
  return g;
}

/** Turn the tyres to how far the machine has run, mm. */
export function spinTyres(g: THREE.Group, spec: MachineSpec, distance: number): void {
  const angle = distance / (spec.tyreRadius * M);
  for (const c of g.children) if (c.name === 'tyre') c.rotation.x = angle;
}
