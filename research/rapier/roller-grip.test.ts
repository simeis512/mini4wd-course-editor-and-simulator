// K. The racers' belief that a narrow edged roller bites into the fence and
// a wide one slides, put into the roller grip model (roller-grip.ts), and
// the climbing-out runs of climb.test.ts done again with it.
import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { layoutCourse } from '../../src/course/course';
import { chain } from '../../src/course/presets';
import { createMachine, driveMachine, type Machine } from '../../src/physics/machine';
import { STANDARD_MACHINE } from '../../src/physics/machine-spec';
import { Run } from '../../src/physics/run';
import { block, deg, lab, RAPIER } from './lab';
import { NARROW_EDGE, rollerGripForce, WIDE_FLAT, type RollerGrip } from './roller-grip';

const FENCE = { height: 0.05, thickness: 0.005 };
const FACE = 0.053;
const ROLLER_H = 0.012;
const MAX_LEAN = deg(20);
/** Old model (climb.test.ts): only a thrust force μ·N·min(1, θ/θ₀), nothing against sliding up. */
const OLD = { mu: 0.3, theta0: 2 };

type Grip = RollerGrip | 'old';

/**
 * Hook the grip into a machine: each step, before `step`, the grip forces
 * from the last step's fence pushes; after it, the new pushes. `leanKappa`
 * leans the fence by push·h/κ as an upward N·tan φ at each roller.
 */
function hookGrip(world: RAPIER.World, m: Machine, fence: number, grip: Grip, thrustDeg: number, leanKappa: number | null) {
  const rollers = m.colliders.slice(1);
  for (const c of rollers) {
    c.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
    c.setContactForceEventThreshold(0);
  }
  const index = new Map(rollers.map((c, i) => [c.handle, i]));
  const queue = new RAPIER.EventQueue(true);
  const held = [0, 0, 0, 0];
  /** The fence's lean at each roller, rad: its shape, which eases back off the fence. */
  const lean = [0, 0, 0, 0];
  const normals = rollers.map(() => new Vector3());
  const stats = { mostLean: 0, down: 0, steps: 0 };
  const before = () => {
    m.body.resetForces(true);
    m.body.resetTorques(true);
    const r = m.body.rotation();
    const down = new Vector3(0, -1, 0).applyQuaternion(new Quaternion(r.x, r.y, r.z, r.w));
    let vertical = 0;
    rollers.forEach((c, k) => {
      if (held[k] <= 0) return;
      const at = c.translation();
      if (leanKappa !== null) m.body.addForceAtPoint({ x: 0, y: held[k] * Math.tan(lean[k]), z: 0 }, at, true);
      if (grip === 'old') {
        const f = OLD.mu * held[k] * Math.min(1, thrustDeg / OLD.theta0);
        m.body.addForceAtPoint({ x: down.x * f, y: down.y * f, z: down.z * f }, at, true);
        vertical -= f;
      } else {
        const g = rollerGripForce(m.body, c, m.spec.rollers[k].radius, thrustDeg, held[k], normals[k], grip, world.timestep);
        if (!g) return;
        m.body.addForceAtPoint(g.force, g.at, true);
        vertical += g.force.y;
      }
    });
    stats.down -= vertical;
    stats.steps++;
  };
  const after = () => {
    const f = [0, 0, 0, 0];
    queue.drainContactForceEvents((e) => {
      if (e.collider1() !== fence && e.collider2() !== fence) return;
      const k = index.get(e.collider1()) ?? index.get(e.collider2());
      if (k === undefined) return;
      f[k] += e.totalForceMagnitude();
      const d = e.maxForceDirection();
      normals[k].set(d.x, d.y, d.z);
    });
    const a = Math.min(1, world.timestep / 0.005);
    // Off the fence, no push: the smoothing only rides over the knocks while touching (Codex review).
    f.forEach((v, k) => {
      held[k] = v > 0 ? held[k] + (v - held[k]) * a : 0;
      if (leanKappa !== null) lean[k] += (Math.min(MAX_LEAN, (held[k] * ROLLER_H) / leanKappa) - lean[k]) * a;
      stats.mostLean = Math.max(stats.mostLean, lean[k]);
    });
  };
  return { queue, before, after, stats };
}

async function wall(leanDeg: number, grip: Grip, thrustDeg: number, push = 4) {
  const world = await lab();
  block(world, [0, -0.01, 1], [0.5, 0.01, 2]);
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -deg(leanDeg));
  const c = new Vector3(FENCE.thickness / 2, FENCE.height / 2, 0).applyQuaternion(q).add(new Vector3(FACE, 0, 1));
  const fb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(c.x, c.y, c.z).setRotation(q));
  const fence = world.createCollider(RAPIER.ColliderDesc.cuboid(FENCE.thickness / 2, FENCE.height / 2, 2).setFriction(0.5), fb);
  const m = createMachine(world, STANDARD_MACHINE, new Vector3(0, 0, -0.8), new Vector3(0, 0, 1));
  m.body.setLinvel({ x: 0, y: 0, z: 3 }, true);
  const hook = hookGrip(world, m, fence.handle, grip, thrustDeg, null);
  let out = false;
  let speed = 0;
  for (let i = 0; i < 1000 && !out; i++) {
    hook.before();
    if (i >= 50) m.body.addForce({ x: push, y: 0, z: 0 }, true);
    driveMachine(m, world.timestep);
    world.step(hook.queue);
    hook.after();
    const r = m.body.rotation();
    const up = new Vector3(0, 1, 0).applyQuaternion(new Quaternion(r.x, r.y, r.z, r.w));
    if (m.body.translation().x > FACE || up.y < Math.cos(deg(60))) out = true;
    speed = m.vehicle.currentVehicleSpeed();
  }
  world.free();
  return { out, down: hook.stats.down / hook.stats.steps, speed };
}

const flatOval = () => {
  const u = ['curve45', 'curve45', 'curve45', 'curve45'];
  return chain(['straight', 'straight', ...u, 'straight', 'straight', ...u]);
};

async function oval(freeRpm: number, grip: Grip, thrustDeg: number, kappa: number) {
  const spec = { ...STANDARD_MACHINE, motor: { ...STANDARD_MACHINE.motor, freeRpm } };
  const run = (await Run.create(layoutCourse(flatOval()), 1, 0, spec))!;
  const { world, machine } = run;
  // Past 4 m/s needs a larger lengthUnit (#139).
  world.lengthUnit = 0.05;
  const fences = [...run.colliders.kinds].find(([, v]) => v.kind === 'fences')![0];
  const hook = hookGrip(world, machine, fences, grip, thrustDeg, kappa);
  const step = world.step.bind(world);
  (world as { step: () => void }).step = () => {
    hook.before();
    step(hook.queue);
    hook.after();
  };
  let s = run.advance(0);
  let fastest = 0;
  let wheelsOff = 0;
  let mostRoll = 0;
  let steps = 0;
  while (s.time < 8 && !s.out && s.laps < 3) {
    s = run.advance(0.001);
    steps++;
    fastest = Math.max(fastest, s.speed);
    if ([0, 1, 2, 3].some((i) => !machine.vehicle.wheelIsInContact(i))) wheelsOff++;
    const up = new Vector3(0, 1, 0).applyQuaternion(s.quaternion);
    if (!s.out) mostRoll = Math.max(mostRoll, Math.acos(Math.max(-1, Math.min(1, up.y))));
  }
  run.free();
  return { s, fastest, wheelsOff: wheelsOff / steps, mostRoll };
}

const label = (g: Grip) => (g === 'old' ? 'old model (thrust force only)' : g.name);

describe('roller grip', () => {
  it('on a fence of fixed lean: the narrow edge holds on where the wide roller and the old model climb out', async () => {
    const thrusts = [0, 0.5, 1, 2];
    const rows: string[] = [];
    const res: Record<string, boolean> = {};
    for (const grip of ['old', WIDE_FLAT, NARROW_EDGE] as Grip[]) {
      rows.push(label(grip));
      for (const lean of [10, 15, 20]) {
        const cells: string[] = [];
        for (const t of thrusts) {
          const r = await wall(lean, grip, t);
          res[`${label(grip)} ${lean} ${t}`] = r.out;
          cells.push(`${t}°: ${r.out ? 'OUT' : 'ok '}`);
        }
        rows.push(`  fence lean ${lean}°  ${cells.join('  ')}`);
      }
    }
    // Hold-down on an upright fence, and the speed it costs.
    for (const grip of ['old', WIDE_FLAT, NARROW_EDGE] as Grip[]) {
      const cells: string[] = [];
      for (const t of [0, 2]) {
        const r = await wall(0, grip, t);
        cells.push(`${t}°: down ${r.down.toFixed(2)} N, ${r.speed.toFixed(2)} m/s`);
      }
      rows.push(`upright fence, ${label(grip).padEnd(30)} ${cells.join('   ')}`);
    }
    console.log(rows.join('\n'));
    expect(res[`${NARROW_EDGE.name} 10 0`]).toBe(false);
  }, 300000);

  it('round a flat oval with fences that lean as they are pushed', async () => {
    const kappa = (4 * ROLLER_H) / deg(10);
    const rows: string[] = [];
    for (const grip of ['old', WIDE_FLAT, NARROW_EDGE] as Grip[]) {
      for (const thrust of [0.5, 2]) {
        const cells: string[] = [];
        for (const rpm of [18000, 24000, 30000]) {
          const { s, fastest, wheelsOff, mostRoll } = await oval(rpm, grip, thrust, kappa);
          cells.push(`${rpm}rpm ${s.out ? `OUT(${s.out})` : `${s.lapTimes.length ? s.lapTimes[s.lapTimes.length - 1].toFixed(2) + 's' : '3 laps'}`} ${fastest.toFixed(1)}m/s tyre off ${(wheelsOff * 100).toFixed(0)}% tilt ${((mostRoll * 180) / Math.PI).toFixed(0)}°`);
        }
        rows.push(`${label(grip).padEnd(30)} thrust ${thrust}°: ${cells.join('  ')}`);
      }
    }
    console.log(rows.join('\n'));
  }, 300000);

  it('which part of the narrow edge tips the machine with 2° of thrust: the grip or the bite', async () => {
    const kappa = (4 * ROLLER_H) / deg(10);
    const rows: string[] = [];
    for (const [mu, t0] of [[0.5, 1], [0.5, 3], [0.35, 1], [0.35, 3], [0.2, 1]]) {
      const grip: RollerGrip = { name: `μ_ax ${mu}, θ₀ ${t0}°`, muAx: mu, theta0Deg: t0, rollingDrag: 0.02 };
      const cells: string[] = [];
      for (const thrust of [0.5, 2]) {
        const { s, wheelsOff, mostRoll } = await oval(24000, grip, thrust, kappa);
        cells.push(`thrust ${thrust}°: ${s.out ? `OUT(${s.out})` : '3 laps  '} tyre off ${(wheelsOff * 100).toFixed(0)}% tilt ${((mostRoll * 180) / Math.PI).toFixed(0)}°`);
      }
      rows.push(`${grip.name.padEnd(16)} 24000rpm  ${cells.join('   ')}`);
    }
    console.log(rows.join('\n'));
  }, 300000);
});
