// 1. Thrust angle (スラスト角): does a tilted roller running along a fence
// push the machine down (or up)?
//
// A box machine slides along the floor without friction (standing in for
// rolling tyres), rotation locked, pushed sideways into a fence by 1.3 N
// (≈ m v²/R at 3 m/s round R = 0.9 m). One front roller turns on a
// revolute joint whose axis leans by θ towards the front (+) or the back (-).
// The floor's normal force against the weight shows the down / up force.
import { describe, expect, it } from 'vitest';
import { block, deg, lab, mean, pairForce, RAPIER } from './lab';

const MASS = 0.13;
const ROLLER_MASS = 0.002;
const SPEED = 3;
const PUSH = 1.3;

type Roller = 'turning-cylinder' | 'turning-ball' | 'fixed-ball';

async function thrust(theta: number, roller: Roller, mu = 0.3) {
  const world = await lab();
  const floor = block(world, [0, -0.01, 0], [1, 0.01, 10], 0);
  const fence = block(world, [0.0625, 0.05, 0], [0.01, 0.05, 10], mu);
  const chassis = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.0105, 0).setLinvel(0, 0, SPEED).lockRotations(),
  );
  const box = world.createCollider(RAPIER.ColliderDesc.cuboid(0.04, 0.01, 0.075).setMass(MASS).setFriction(0), chassis);
  const at = { x: 0.046, y: 0.0015, z: 0.075 };
  if (roller === 'fixed-ball') {
    world.createCollider(
      RAPIER.ColliderDesc.ball(0.0065).setTranslation(at.x, at.y, at.z).setMass(0).setFriction(0.01)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min),
      chassis,
    );
  } else {
    const q = { x: Math.sin(theta / 2), y: 0, z: 0, w: Math.cos(theta / 2) };
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y + 0.0105, at.z).setRotation(q).setLinvel(0, 0, SPEED),
    );
    const shape = roller === 'turning-cylinder' ? RAPIER.ColliderDesc.cylinder(0.003, 0.0065) : RAPIER.ColliderDesc.ball(0.0065);
    world.createCollider(shape.setMass(ROLLER_MASS).setFriction(mu), body);
    const joint = world.createImpulseJoint(
      RAPIER.JointData.revoluteWithAxes(at, { x: 0, y: 0, z: 0 }, { x: 0, y: Math.cos(theta), z: Math.sin(theta) }, { x: 0, y: 1, z: 0 }),
      chassis, body, true,
    );
    // The roller sits a hair into the chassis box; left on, that contact rubs and slows the machine hard.
    joint.setContactsEnabled(false);
  }
  chassis.addForce({ x: PUSH, y: 0, z: 0 }, true);
  const floorForce: number[] = [];
  for (let i = 0; i < 300; i++) {
    world.step();
    if (i >= 150) floorForce.push(pairForce(world, box, floor).normal);
  }
  const speed = chassis.linvel().z;
  world.free();
  const weight = (MASS + (roller === 'fixed-ball' ? 0 : ROLLER_MASS)) * 9.81;
  return { down: mean(floorForce) - weight, speed };
}

describe('thrust angle', () => {
  it('turning rollers on tilted axes push the machine down or up; fixed balls do not', async () => {
    const rows: string[] = [];
    const result: Record<string, number> = {};
    for (const roller of ['turning-cylinder', 'turning-ball', 'fixed-ball'] as Roller[]) {
      for (const d of [-5, -2, 0, 1, 2, 5, 10]) {
        if (roller === 'fixed-ball' && d !== 0) continue;
        const r = await thrust(deg(d), roller);
        result[`${roller} ${d}`] = r.down;
        rows.push(`${roller.padEnd(17)} θ=${String(d).padStart(3)}°  extra down force ${r.down.toFixed(3)} N  speed after 0.3 s ${r.speed.toFixed(2)} m/s`);
      }
    }
    console.log(rows.join('\n'));
    expect(Math.abs(result['turning-cylinder 0'])).toBeLessThan(0.05);
    expect(result['turning-cylinder 5']).toBeGreaterThan(0.05);
    expect(result['turning-cylinder -5']).toBeLessThan(-0.05);
  }, 60000);

  it('down force grows with fence friction and with how hard the roller is pressed', async () => {
    const rows: string[] = [];
    for (const mu of [0.1, 0.3, 0.6]) {
      const r = await thrust(deg(2), 'turning-cylinder', mu);
      rows.push(`μ=${mu}  θ=2°  extra down force ${r.down.toFixed(3)} N`);
    }
    console.log(rows.join('\n'));
  }, 60000);
});

// The same on a real course: the standard machine's fixed ball rollers
// swapped for turning ones on joints (with or without thrust), round the
// basic oval's trimesh fences. Do they catch on the triangles, and does the
// machine still lap?
import { Quaternion, Vector3 } from 'three';
import { layoutCourse } from '../../src/course/course';
import { basicOval } from '../../src/course/presets';
import { rideHeight } from '../../src/physics/machine';
import { Run } from '../../src/physics/run';

async function lapWith(roller: Roller, theta: number, mu = 0.3, inertiaScale = 1, iters = 4) {
  const run = (await Run.create(layoutCourse(basicOval())))!;
  run.world.numSolverIterations = iters;
  const { world, machine } = run;
  if (roller !== 'fixed-ball') {
    const r = machine.body.rotation();
    const q = new Quaternion(r.x, r.y, r.z, r.w);
    const t = machine.body.translation();
    const tilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), theta);
    machine.colliders.slice(1).forEach((c, i) => {
      world.removeCollider(c, false);
      const spec = machine.spec.rollers[i];
      const local = new Vector3(spec.at[0], spec.at[1] - rideHeight(machine.spec), spec.at[2]);
      const p = local.clone().applyQuaternion(q).add(new Vector3(t.x, t.y, t.z));
      const rq = q.clone().multiply(tilt);
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setRotation(rq));
      const shape = roller === 'turning-cylinder' ? RAPIER.ColliderDesc.cylinder(spec.height / 2, spec.radius) : RAPIER.ColliderDesc.ball(spec.radius);
      const I = 0.5 * ROLLER_MASS * spec.radius ** 2 * inertiaScale;
      machine.colliders[i + 1] = world.createCollider(shape.setMassProperties(ROLLER_MASS, { x: 0, y: 0, z: 0 }, { x: I, y: I, z: I }, { x: 0, y: 0, z: 0, w: 1 }).setFriction(mu).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min).setRestitution(machine.spec.rollerRestitution), body);
      const axis = new Vector3(0, 1, 0).applyQuaternion(tilt);
      world
        .createImpulseJoint(RAPIER.JointData.revoluteWithAxes(local, { x: 0, y: 0, z: 0 }, axis, { x: 0, y: 1, z: 0 }), machine.body, body, true)
        .setContactsEnabled(false);
    });
  }
  let s = run.advance(0);
  let slowest = Infinity;
  while (s.time < 12 && !s.out && s.laps < 3) {
    s = run.advance(0.01);
    if (s.time > 1) slowest = Math.min(slowest, s.speed);
  }
  run.free();
  return { s, slowest };
}

describe('thrust angle on the basic oval', () => {
  it('turning rollers lap the trimesh fences', async () => {
    const rows: string[] = [];
    for (const [roller, d] of [['fixed-ball', 0], ['turning-ball', 0], ['turning-cylinder', 0], ['turning-cylinder', 2], ['turning-cylinder', -2]] as [Roller, number][]) {
      const { s, slowest } = await lapWith(roller, deg(d));
      rows.push(`${roller.padEnd(17)} θ=${String(d).padStart(2)}°: ${s.out ?? `${s.laps} laps`} in ${s.time.toFixed(2)} s, lap times ${s.lapTimes.map((t) => t.toFixed(2)).join(' / ')} s, slowest after 1 s ${slowest.toFixed(2)} m/s`);
    }
    for (const [mu, I, it] of [[0.05, 1, 4], [0.3, 10, 4], [0.3, 1, 12]]) {
      const { s, slowest } = await lapWith('turning-cylinder', 0, mu, I, it);
      rows.push(`turning-cylinder μ=${mu} inertia×${I} iterations ${it}: ${s.out ?? `${s.laps} laps`} in ${s.time.toFixed(2)} s, lap times ${s.lapTimes.map((t) => t.toFixed(2)).join(' / ')} s, slowest after 1 s ${slowest.toFixed(2)} m/s`);
    }
    console.log(rows.join('\n'));
  }, 120000);
});

// The way round: keep the fixed, near-frictionless ball rollers that lap
// well, and add the thrust force ourselves. Each step, each roller's push
// from the fence (contact force events) gives a force along the machine's
// down, F = μ·N·min(1, θ/θ₀), at the roller (θ₀ provisional: below it the
// roller's rubber/plastic gives, as a tyre's slip angle does).
async function lapWithThrustForce(thetaDeg: number, mu = 0.3, theta0 = 2, smooth = 0.02) {
  const run = (await Run.create(layoutCourse(basicOval())))!;
  const { world, machine } = run;
  const queue = new RAPIER.EventQueue(true);
  const rollers = machine.colliders.slice(1);
  for (const c of rollers) {
    c.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
    c.setContactForceEventThreshold(0);
  }
  const index = new Map(rollers.map((c, i) => [c.handle, i]));
  const fences = [...run.colliders.kinds].find(([, k]) => k.kind === 'fences')![0];
  const pressed = [0, 0, 0, 0];
  /** The fence's push on each roller smoothed over `smooth` s: single steps knock up to 50 N (see roller-forces). */
  const held = [0, 0, 0, 0];
  let extraLoad = 0;
  let samples = 0;
  const step = world.step.bind(world);
  (world as { step: () => void }).step = () => {
    machine.body.resetForces(true);
    // addForceAtPoint adds a torque too, which resetForces leaves.
    machine.body.resetTorques(true);
    const r = machine.body.rotation();
    const q = new Quaternion(r.x, r.y, r.z, r.w);
    const down = new Vector3(0, -1, 0).applyQuaternion(q);
    let total = 0;
    rollers.forEach((c, i) => {
      const f = mu * held[i] * Math.min(1, Math.abs(thetaDeg) / theta0) * Math.sign(thetaDeg);
      if (!f) return;
      const p = c.translation();
      machine.body.addForceAtPoint({ x: down.x * f, y: down.y * f, z: down.z * f }, p, true);
      total += f;
    });
    extraLoad += total;
    samples++;
    step(queue);
    pressed.fill(0);
    queue.drainContactForceEvents((e) => {
      // Only the fences' push: the road's would feed the down force back into itself.
      if (e.collider1() !== fences && e.collider2() !== fences) return;
      const i = index.get(e.collider1()) ?? index.get(e.collider2());
      if (i !== undefined) pressed[i] += e.totalForceMagnitude();
    });
    const k = smooth > 0 ? Math.min(1, world.timestep / smooth) : 1;
    pressed.forEach((p, i) => (held[i] += (p - held[i]) * k));
  };
  let s = run.advance(0);
  let slowest = Infinity;
  while (s.time < 12 && !s.out && s.laps < 3) {
    s = run.advance(0.01);
    if (s.time > 1) slowest = Math.min(slowest, s.speed);
  }
  run.free();
  return { s, slowest, meanDown: extraLoad / samples };
}

describe('thrust angle as an added force', () => {
  it('fixed ball rollers plus a down force from their fence push lap like the plain machine', async () => {
    const rows: string[] = [];
    for (const [d, sm] of [[0, 0.02], [2, 0], [2, 0.02], [-2, 0.02], [5, 0.02]]) {
      const { s, slowest, meanDown } = await lapWithThrustForce(d, 0.3, 2, sm);
      rows.push(`θ=${String(d).padStart(2)}° smoothed ${sm * 1000} ms: ${s.out ?? `${s.laps} laps`} in ${s.time.toFixed(2)} s, lap times ${s.lapTimes.map((t) => t.toFixed(2)).join(' / ')} s, slowest after 1 s ${slowest.toFixed(2)} m/s, mean added down force ${meanDown.toFixed(3)} N`);
    }
    console.log(rows.join('\n'));
  }, 120000);
});
