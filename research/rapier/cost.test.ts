// D. Cost: how long one simulated second takes (1000 steps of 1 ms) as the
// machine gains bodies and joints, and with three machines in one world.
// AR gives the physics 12 ms a frame (FRAME_BUDGET, PR #123): at 60 fps
// real time needs 1 s of simulation in under 0.72 s of 12 ms slices.
import { Quaternion, Vector3 } from 'three';
import { describe, it } from 'vitest';
import { layoutCourse } from '../../src/course/course';
import { basicOval } from '../../src/course/presets';
import { createMachine, driveMachine, type Machine } from '../../src/physics/machine';
import { STANDARD_MACHINE } from '../../src/physics/machine-spec';
import { Run } from '../../src/physics/run';
import { RAPIER } from './lab';

/** Hang `n` extra bodies on the machine with prismatic joints (dampers, turning rollers...). */
function addBodies(world: RAPIER.World, m: Machine, n: number): void {
  const t = m.body.translation();
  const r = m.body.rotation();
  const q = new Quaternion(r.x, r.y, r.z, r.w);
  for (let i = 0; i < n; i++) {
    const local = new Vector3(((i % 4) - 1.5) * 0.02, 0.005, ((i >> 2) - 1) * 0.04);
    const p = local.clone().applyQuaternion(q).add(new Vector3(t.x, t.y, t.z));
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setRotation(r));
    world.createCollider(RAPIER.ColliderDesc.ball(0.003).setMass(0.005).setSensor(true), b);
    const j = world.createImpulseJoint(RAPIER.JointData.prismatic(local, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }), m.body, b, true) as RAPIER.PrismaticImpulseJoint;
    j.setLimits(-0.0015, 0.0015);
    j.setContactsEnabled(false);
  }
}

async function cost(extra: number, machines: number): Promise<number> {
  const run = (await Run.create(layoutCourse(basicOval()), 1, 0))!;
  const { world } = run;
  addBodies(world, run.machine, extra);
  const others: Machine[] = [];
  for (let k = 1; k < machines; k++) {
    const line = run.course.lanes[k].points;
    const m = createMachine(world, STANDARD_MACHINE, line[5].clone().multiplyScalar(0.001), line[6].clone().sub(line[5]));
    addBodies(world, m, extra);
    others.push(m);
  }
  const step = world.step.bind(world);
  (world as { step: () => void }).step = () => {
    for (const m of others) driveMachine(m, world.timestep);
    step();
  };
  run.advance(0.2);
  const t0 = performance.now();
  run.advance(1);
  const ms = performance.now() - t0;
  run.free();
  return ms;
}

describe('cost', () => {
  it('times one simulated second', async () => {
    const rows: string[] = [];
    for (const [extra, machines] of [[0, 1], [4, 1], [8, 1], [16, 1], [0, 3], [8, 3]]) {
      const ms = Math.min(await cost(extra, machines), await cost(extra, machines));
      rows.push(`${machines} machine(s), +${extra} bodies each: ${ms.toFixed(0)} ms per simulated second (${(ms / 1000).toFixed(3)} ms a step)`);
    }
    console.log(rows.join('\n'));
  }, 120000);
});
