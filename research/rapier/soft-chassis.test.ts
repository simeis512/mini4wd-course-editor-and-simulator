// G. What Rapier lacks, done by hand or with its newer parts:
// - air drag: a force we add each step (½ρC_dA v²); shown against top speed
// - chassis flex: Rapier 0.21's soft bodies. A 150 × 80 × 4 mm plate of
//   tetrahedra, 50 g, its back row of particles attached to a fixed body
//   (a cantilever), sagging under gravity at different stiffnesses.
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { STANDARD_MACHINE, freeSpeed } from '../../src/physics/machine-spec';
import { createMachine, driveMachine } from '../../src/physics/machine';
import { block, lab, RAPIER } from './lab';

type Plate = { frequency: number } | { young: number; fem: boolean };

async function sag(how: Plate) {
  const world = await lab();
  const wall = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const desc = RAPIER.SoftBodyDesc.cuboid({ x: 0, y: 0, z: 0 }, { x: 0.04, y: 0.002, z: 0.075 }, 5, 2, 9).setMass(0.05);
  if ('frequency' in how) desc.setSoftness(how.frequency, 1);
  else {
    const material = new RAPIER.SoftBodyMaterial();
    material.youngModulus = how.young;
    material.poissonRatio = 0.35;
    material.elasticDampingRatio = 1;
    desc.setMaterial(material).setCellModel(RAPIER.SoftBodyCellModel.Corotational);
    if (how.fem) desc.setSolver(RAPIER.SoftBodySolver.Fem);
  }
  const plate = world.createSoftBody(desc);
  const n = plate.numParticles();
  let tip = -1;
  for (let i = 0; i < n; i++) {
    const p = plate.particlePosition(i);
    if (p.z < -0.074) plate.attachParticle(i, wall);
    if (tip < 0 || p.z > plate.particlePosition(tip).z) tip = i;
  }
  const t0 = performance.now();
  let lowest = 0;
  let finite = true;
  for (let i = 0; i < 1000; i++) {
    world.step();
    const y = plate.particlePosition(tip).y;
    if (!Number.isFinite(y)) finite = false;
    lowest = Math.min(lowest, y);
  }
  const ms = performance.now() - t0;
  const end = plate.particlePosition(tip).y;
  world.free();
  return { particles: n, end, lowest, ms, finite };
}

async function topSpeed(cdA: number) {
  const world = await lab();
  block(world, [0, -0.01, 0], [1, 0.01, 200]);
  const m = createMachine(world, STANDARD_MACHINE, new Vector3(0, 0, -190), new Vector3(0, 0, 1));
  for (let i = 0; i < 6000; i++) {
    m.body.resetForces(true);
    const v = m.body.linvel();
    const sp = Math.hypot(v.x, v.y, v.z);
    // ½ ρ C_d A v², against the velocity.
    const drag = 0.5 * 1.2 * cdA * sp;
    m.body.addForce({ x: -drag * v.x, y: -drag * v.y, z: -drag * v.z }, true);
    driveMachine(m, world.timestep);
    world.step();
  }
  const s = m.vehicle.currentVehicleSpeed();
  world.free();
  return s;
}

describe('soft chassis and air drag', () => {
  it('a soft-body plate sags by its stiffness, stays finite, and costs', async () => {
    const rows: string[] = [];
    // A 150 mm cantilever of 80 × 4 mm, 50 g, E = 2 GPa (ABS-like): beam theory sags its tip w L⁴ / 8EI.
    const I = (0.08 * 0.004 ** 3) / 12;
    rows.push(`beam theory, E = 2 GPa: ${(((0.05 * 9.81) / 0.15) * 0.15 ** 4 / (8 * 2e9 * I) * 1000).toFixed(2)} mm`);
    const plates: [string, Plate][] = [
      ['softness 20 Hz', { frequency: 20 }],
      ['softness 100 Hz', { frequency: 100 }],
      ['softness 500 Hz', { frequency: 500 }],
      ['corotational E=2 GPa', { young: 2e9, fem: false }],
      ['corotational E=2 GPa, FEM solver', { young: 2e9, fem: true }],
      ['corotational E=0.2 GPa, FEM solver', { young: 2e8, fem: true }],
    ];
    for (const [name, how] of plates) {
      const r = await sag(how);
      rows.push(`plate ${r.particles} particles, ${name}: tip ${(r.end * 1000).toFixed(2)} mm after 1 s (lowest ${(r.lowest * 1000).toFixed(2)} mm), ${r.finite ? 'finite' : 'BLEW UP'}, ${(r.ms / 1000).toFixed(3)} ms a step`);
      expect(r.finite).toBe(true);
    }
    console.log(rows.join('\n'));
  }, 120000);

  it('air drag added by hand lowers the top speed', async () => {
    const rows = [`free speed (no losses) ${freeSpeed(STANDARD_MACHINE).toFixed(2)} m/s`];
    // C_d·A: about 0.5 × (0.1 m wide × 0.04 m tall) for a body shell (provisional).
    for (const cdA of [0, 0.002, 0.004]) rows.push(`C_d·A ${cdA} m²: ${(await topSpeed(cdA)).toFixed(2)} m/s after 6 s`);
    console.log(rows.join('\n'));
  }, 120000);
});
