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

/** Shadow: how much wider and longer than the chassis, how dark right under it, and how high above the road it has faded away, mm (cosmetic, #99). */
const SHADOW = { wide: 1.7, long: 1.3, dark: 0.55, fade: 150 };
/** How far above the road the shadow lies, mm: clear of the road without seeming to float. */
const SHADOW_LIFT = 0.5;

/** A soft round blot, dark in the middle and gone at the edge, made without a canvas. */
function blotTexture(size = 64): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const r2 = ((2 * x + 1) / size - 1) ** 2 + ((2 * y + 1) / size - 1) ** 2;
      data[(y * size + x) * 4 + 3] = Math.round(255 * Math.max(0, 1 - r2) ** 2);
    }
  const texture = new THREE.DataTexture(data, size, size);
  texture.needsUpdate = true;
  return texture;
}

/**
 * A blurred round shadow for under the machine (#99, owner 2026-10-26: no
 * shadow maps), lying flat in its own XZ plane; `placeShadow` puts it on
 * the road.
 */
export function buildShadow(spec: MachineSpec): THREE.Mesh {
  const [w, , l] = spec.size;
  const geometry = new THREE.PlaneGeometry(w * M * SHADOW.wide, l * M * SHADOW.long).rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({ color: 0x000000, map: blotTexture(), transparent: true, depthWrite: false });
  const shadow = new THREE.Mesh(geometry, material);
  shadow.name = 'shadow';
  shadow.renderOrder = 1;
  return shadow;
}

/** How dark the shadow is with the chassis middle `height` mm above the ground under it: fading as the machine flies. */
export function shadowStrength(spec: MachineSpec, height: number): number {
  const above = Math.max(0, height - rideHeight(spec) * M);
  return SHADOW.dark * Math.max(0, 1 - above / SHADOW.fade);
}

/**
 * Lay the shadow on the ground under a machine at `position` facing
 * `quaternion` (course mm), along the way it faces; hidden over nothing.
 */
export function placeShadow(
  shadow: THREE.Mesh,
  spec: MachineSpec,
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
  ground: { point: THREE.Vector3; normal: THREE.Vector3 } | null,
): void {
  shadow.visible = !!ground;
  if (!ground) return;
  const up = ground.normal;
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
  forward.addScaledVector(up, -forward.dot(up));
  // Pointing straight into the ground: any way along it will do.
  if (forward.lengthSq() < 1e-6) forward.set(1, 0, 0).addScaledVector(up, -up.x);
  forward.normalize();
  const side = new THREE.Vector3().crossVectors(up, forward);
  shadow.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, forward));
  shadow.position.copy(ground.point).addScaledVector(up, SHADOW_LIFT);
  (shadow.material as THREE.MeshBasicMaterial).opacity = shadowStrength(spec, position.distanceTo(ground.point));
}

/** Turn the tyres to how far the machine has run, mm. */
export function spinTyres(g: THREE.Group, spec: MachineSpec, distance: number): void {
  const angle = distance / (spec.tyreRadius * M);
  for (const c of g.children) if (c.name === 'tyre') c.rotation.x = angle;
}
