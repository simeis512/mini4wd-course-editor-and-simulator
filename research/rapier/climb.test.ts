// I. A fence that leans out a little in a curve, and rollers with little
// thrust: do the rollers slide up it and the machine climb out?
//
// The standard machine (ray tyres, fixed ball rollers) runs along a 50 mm
// fence whose top leans out by φ, pushed into it by 4 N at its centre of
// mass (≈ m v²/R in a curve). Thrust is the added force of thrust.test.ts:
// μ·N·min(1, θ/θ₀) down at each roller from its fence push. A leaning
// fence's push itself points a little up (N·sin φ): nothing is added for
// that, it comes from the contact.
import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createMachine, driveMachine } from '../../src/physics/machine';
import { STANDARD_MACHINE } from '../../src/physics/machine-spec';
import { block, deg, lab, RAPIER } from './lab';

const FENCE = { height: 0.05, thickness: 0.005 };
const FACE = 0.053; // inner face at road level, m from the machine's middle
const PUSH = 4;
const MU = 0.3;
const THETA0 = 2;

/**
 * How the fence leans: 'fixed' by `leanDeg`; 'give' it leans by its push
 * over κ (N·m/rad, the push taken at roller height), the fence turned as a
 * kinematic body; 'force' the fence stays upright and the lean is put in as
 * a force, N·tan φ up at each roller, φ from the push as for 'give' (the
 * way that would work on the course's one-piece fence trimesh).
 */
type Lean = { mode: 'fixed'; deg: number } | { mode: 'give' | 'force'; kappa: number };
const ROLLER_H = 0.012;
const MAX_LEAN = deg(20);

export async function climb(how: Lean | number, thrustDeg: number, push = PUSH) {
  const world = await lab();
  block(world, [0, -0.01, 1], [0.5, 0.01, 2]);
  const mode: Lean = typeof how === 'number' ? { mode: 'fixed', deg: how } : how;
  const lean = mode.mode === 'fixed' ? deg(mode.deg) : 0;
  // The fence box, its inner foot edge at (FACE, 0), turned about z so its top goes out (+x).
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -lean);
  const centre = new Vector3(FENCE.thickness / 2, FENCE.height / 2, 0).applyQuaternion(q).add(new Vector3(FACE, 0, 1));
  const fenceDesc = mode.mode === 'give' ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.fixed();
  const fenceBody = world.createRigidBody(fenceDesc.setTranslation(centre.x, centre.y, centre.z).setRotation(q));
  let phi = 0;
  let mostLean = lean;
  const fence = world.createCollider(RAPIER.ColliderDesc.cuboid(FENCE.thickness / 2, FENCE.height / 2, 2).setFriction(0.5), fenceBody);
  const m = createMachine(world, STANDARD_MACHINE, new Vector3(0, 0, -0.8), new Vector3(0, 0, 1));
  m.body.setLinvel({ x: 0, y: 0, z: 3 }, true);
  const rollers = m.colliders.slice(1);
  for (const c of rollers) {
    c.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
    c.setContactForceEventThreshold(0);
  }
  const index = new Map(rollers.map((c, i) => [c.handle, i]));
  const queue = new RAPIER.EventQueue(true);
  const held = [0, 0, 0, 0];
  let highest = 0;
  let roll = 0;
  let out = false;
  for (let i = 0; i < 1000 && !out; i++) {
    m.body.resetForces(true);
    m.body.resetTorques(true);
    const r = m.body.rotation();
    const rq = new Quaternion(r.x, r.y, r.z, r.w);
    const down = new Vector3(0, -1, 0).applyQuaternion(rq);
    // The pull of the curve, outwards, after the machine is up to the fence.
    if (i >= 50) m.body.addForce({ x: push, y: 0, z: 0 }, true);
    rollers.forEach((c, k) => {
      const f = MU * held[k] * Math.min(1, thrustDeg / THETA0);
      if (f > 0) m.body.addForceAtPoint({ x: down.x * f, y: down.y * f, z: down.z * f }, c.translation(), true);
      // The leaning fence's push points up by φ: N·tan φ, world up.
      if (mode.mode === 'force' && held[k] > 0) m.body.addForceAtPoint({ x: 0, y: held[k] * Math.tan(phi), z: 0 }, c.translation(), true);
    });
    if (mode.mode !== 'fixed') {
      // Lean by the fence's push at roller height over κ, smoothed over 5 ms (the fence's own sway left out).
      const target = Math.min(MAX_LEAN, (held.reduce((a, b) => a + b, 0) * ROLLER_H) / mode.kappa);
      phi += (target - phi) * Math.min(1, world.timestep / 0.005);
      mostLean = Math.max(mostLean, phi);
      if (mode.mode === 'give') {
        const qq = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -phi);
        const cc = new Vector3(FENCE.thickness / 2, FENCE.height / 2, 0).applyQuaternion(qq).add(new Vector3(FACE, 0, 1));
        fenceBody.setNextKinematicTranslation({ x: cc.x, y: cc.y, z: cc.z });
        fenceBody.setNextKinematicRotation({ x: qq.x, y: qq.y, z: qq.z, w: qq.w });
      }
    }
    driveMachine(m, world.timestep);
    world.step(queue);
    held.fill(0);
    queue.drainContactForceEvents((e) => {
      if (e.collider1() !== fence.handle && e.collider2() !== fence.handle) return;
      const k = index.get(e.collider1()) ?? index.get(e.collider2());
      if (k !== undefined) held[k] += e.totalForceMagnitude();
    });
    for (const c of rollers) highest = Math.max(highest, c.translation().y);
    roll = Math.max(roll, Math.acos(Math.max(-1, Math.min(1, new Vector3(0, 1, 0).applyQuaternion(rq).y))));
    const t = m.body.translation();
    // Over the fence, or rolled onto it.
    if (t.x > FACE || roll > deg(60)) out = true;
  }
  world.free();
  return { out, highest, roll, mostLean };
}

describe('climbing a leaning fence', () => {
  it('rollers slide up a fence that leans out unless the thrust holds them down', async () => {
    const leans = [0, 3, 6, 10, 15];
    const thrusts = [0, 0.5, 1, 2];
    const rows = [`lean \\ thrust  ${thrusts.map((t) => `${t}°`.padEnd(22)).join('')}`];
    const res: Record<string, boolean> = {};
    for (const l of leans) {
      const cells: string[] = [];
      for (const t of thrusts) {
        const r = await climb(l, t);
        res[`${l} ${t}`] = r.out;
        cells.push(`${r.out ? 'OUT' : 'ok '} roller ${(r.highest * 1000).toFixed(0).padStart(2)}mm roll ${((r.roll * 180) / Math.PI).toFixed(0).padStart(2)}°`.padEnd(22));
      }
      rows.push(`${String(l).padStart(2)}°            ${cells.join('')}`);
    }
    console.log(rows.join('\n'));
    expect(res['0 0']).toBe(false);
    expect(res['15 0']).toBe(true);
    expect(res['15 2']).toBe(false);
  }, 300000);

  it('a fence that leans by how hard it is pushed: out only when pushed hard (fast) with little thrust', async () => {
    // κ such that 4 N at roller height leans it 10° (provisional).
    const kappa = (PUSH * ROLLER_H) / deg(10);
    const rows: string[] = [];
    for (const mode of ['give', 'force'] as const) {
      for (const thrust of [0.5, 2]) {
        const cells: string[] = [];
        for (const push of [2, 4, 6]) {
          const r = await climb({ mode, kappa }, thrust, push);
          cells.push(`${push} N: ${r.out ? 'OUT' : 'ok '} lean ${((r.mostLean * 180) / Math.PI).toFixed(1).padStart(4)}°`);
        }
        rows.push(`${mode === 'give' ? 'fence turned  ' : 'as a force    '} thrust ${thrust}°: ${cells.join('   ')}`);
      }
    }
    console.log(rows.join('\n'));
  }, 300000);
});

// On a real course: the standard machine round a flat oval with a
// faster motor, each roller's fence push leaning "its" bit of fence by
// push·h/κ (as a force, N·tan φ up at that roller), and the thrust force.
import { layoutCourse } from '../../src/course/course';
import { chain } from '../../src/course/presets';

/** A flat oval with no lane change, so that the curves are the only way out: two straights, a U-turn, two straights, a U-turn. */
const flatOval = () => {
  const u = ['curve45', 'curve45', 'curve45', 'curve45'];
  return chain(['straight', 'straight', ...u, 'straight', 'straight', ...u]);
};
import { Run } from '../../src/physics/run';

async function oval(freeRpm: number, thrustDeg: number, kappa: number | null, lane = 0) {
  const spec = { ...STANDARD_MACHINE, motor: { ...STANDARD_MACHINE.motor, freeRpm } };
  const run = (await Run.create(layoutCourse(flatOval()), 1, lane, spec))!;
  const { world, machine } = run;
  // Past 4 m/s needs a larger lengthUnit (speed-cap.test.ts).
  world.lengthUnit = 0.05;
  const fences = [...run.colliders.kinds].find(([, v]) => v.kind === 'fences')![0];
  const rollers = machine.colliders.slice(1);
  const index = new Map(rollers.map((c, i) => [c.handle, i]));
  for (const c of rollers) {
    c.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
    c.setContactForceEventThreshold(0);
  }
  const queue = new RAPIER.EventQueue(true);
  const held = [0, 0, 0, 0];
  const phi = [0, 0, 0, 0];
  let mostLean = 0;
  const step = world.step.bind(world);
  (world as { step: () => void }).step = () => {
    machine.body.resetForces(true);
    machine.body.resetTorques(true);
    const r = machine.body.rotation();
    const down = new Vector3(0, -1, 0).applyQuaternion(new Quaternion(r.x, r.y, r.z, r.w));
    rollers.forEach((c, k) => {
      if (held[k] <= 0) return;
      const f = MU * held[k] * Math.min(1, thrustDeg / THETA0);
      const up = kappa === null ? 0 : held[k] * Math.tan(phi[k]);
      machine.body.addForceAtPoint({ x: down.x * f, y: down.y * f + up, z: down.z * f }, c.translation(), true);
    });
    step(queue);
    const f = [0, 0, 0, 0];
    queue.drainContactForceEvents((e) => {
      if (e.collider1() !== fences && e.collider2() !== fences) return;
      const k = index.get(e.collider1()) ?? index.get(e.collider2());
      if (k !== undefined) f[k] += e.totalForceMagnitude();
    });
    const a = Math.min(1, world.timestep / 0.005);
    f.forEach((v, k) => {
      // The push is smoothed only while touching: off the fence there is none (Codex review).
      held[k] = v > 0 ? held[k] + (v - held[k]) * a : 0;
      // The lean is the fence's shape: it follows the push and eases back off it (5 ms, provisional).
      if (kappa !== null) phi[k] += (Math.min(MAX_LEAN, (held[k] * ROLLER_H) / kappa) - phi[k]) * a;
      mostLean = Math.max(mostLean, phi[k]);
    });
  };
  let s = run.advance(0);
  let fastest = 0;
  while (s.time < 8 && !s.out && s.laps < 3) {
    s = run.advance(0.01);
    fastest = Math.max(fastest, s.speed);
  }
  run.free();
  return { s, fastest, mostLean };
}

describe('climbing on a flat oval', () => {
  it('a faster machine with little thrust climbs out where the fences give', async () => {
    const kappa = (PUSH * ROLLER_H) / deg(10);
    const rows: string[] = [];
    for (const rpm of [12000, 18000, 24000, 30000]) {
      for (const [thrust, k] of [[0.5, null], [0.5, kappa], [2, kappa]] as [number, number | null][]) {
        const { s, fastest, mostLean } = await oval(rpm, thrust, k);
        rows.push(
          `motor ${rpm} rpm, thrust ${thrust}°, ${k === null ? 'stiff fences' : 'leaning fences'}: ${s.out ? `OUT (${s.out}) at ${s.time.toFixed(2)} s` : `${s.laps} laps in ${s.time.toFixed(2)} s`}, top speed ${fastest.toFixed(2)} m/s, most lean ${((mostLean * 180) / Math.PI).toFixed(1)}°`,
        );
      }
    }
    console.log(rows.join('\n'));
  }, 300000);
});
