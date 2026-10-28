// H. Flexible course pieces: the fences of real pieces lean out when a
// machine is pressed into them in a curve, and spring back. Can Rapier do it?
//
// A fence of 50 mm sections (25 mm tall, 5 mm thick), each a dynamic body
// hinged along its foot to the fixed road, held upright by the hinge's
// motor as a torsion spring κ (N·m/rad) with damping. A 13 mm roller
// carrying 130 g runs along it at 3 m/s pressed out by 4 N (≈ m v²/R at
// R ≈ 0.3 m), at 12 mm up. Against the same fence fixed.
import { describe, expect, it } from 'vitest';
import { lab, mean, RAPIER } from './lab';

const SECTION = 0.05;
const HEIGHT = 0.025;
const ROLLER_Y = 0.012;
const PUSH = 4;

async function run(kappa: number | null) {
  const world = await lab(0);
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const sections: RAPIER.RigidBody[] = [];
  for (let i = 0; i < 20; i++) {
    const z = i * SECTION;
    const desc = kappa === null ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic();
    const body = world.createRigidBody(desc.setTranslation(0.0625, HEIGHT / 2, z));
    // A hair short so neighbouring sections do not rub.
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.0025, HEIGHT / 2, SECTION / 2 - 0.0005).setMass(0.01).setFriction(0.01), body);
    if (kappa !== null) {
      const hinge = world.createImpulseJoint(
        RAPIER.JointData.revolute({ x: 0.0625, y: 0, z }, { x: 0, y: -HEIGHT / 2, z: 0 }, { x: 0, y: 0, z: 1 }),
        ground, body, true,
      ) as RAPIER.RevoluteImpulseJoint;
      hinge.configureMotorModel(RAPIER.MotorModel.ForceBased);
      hinge.configureMotorPosition(0, kappa, kappa / 50);
      hinge.setContactsEnabled(false);
    }
    sections.push(body);
  }
  const roller = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(0.0625 - 0.0025 - 0.0065, ROLLER_Y, 0.1).setLinvel(0, 0, 3).lockRotations(),
  );
  world.createCollider(RAPIER.ColliderDesc.ball(0.0065).setMass(0.13).setFriction(0.01), roller);
  roller.addForce({ x: PUSH, y: 0, z: 0 }, true);
  const out: number[] = [];
  const lean = sections.map(() => 0);
  const t0 = performance.now();
  let after = 0;
  for (let i = 0; i < 300; i++) {
    world.step();
    const p = roller.translation();
    if (p.z > 0.2 && p.z < 0.8) out.push(p.x - (0.0625 - 0.0025 - 0.0065));
    sections.forEach((s, k) => {
      const r = s.rotation();
      lean[k] = Math.max(lean[k], 2 * Math.asin(Math.min(1, Math.abs(r.z))));
    });
    // Once the roller has gone by, how far the 5th section still leans.
    if (i === 299) {
      const r = sections[4].rotation();
      after = 2 * Math.asin(Math.min(1, Math.abs(r.z)));
    }
  }
  const ms = performance.now() - t0;
  const speed = roller.linvel().z;
  world.free();
  return { out: mean(out), lean: Math.max(...lean.slice(4, 16)), after, speed, ms: ms / 300 };
}

describe('flexible fence', () => {
  it('fence sections on spring hinges: seams catch the roller', async () => {
    const rows: string[] = [];
    const deg = (r: number) => ((r * 180) / Math.PI).toFixed(2);
    const res: Record<string, Awaited<ReturnType<typeof run>>> = {};
    for (const k of [null, 2, 0.6, 0.2]) {
      const r = await run(k);
      res[String(k)] = r;
      const theory = k === null ? 0 : (PUSH * ROLLER_Y) / k;
      rows.push(
        `${k === null ? 'fixed fence     ' : `κ=${String(k).padEnd(4)} N·m/rad `}: roller pushed out ${(r.out * 1000).toFixed(2)} mm` +
          ` (spring alone: ${(theory * ROLLER_Y * 1000).toFixed(2)} mm), sections lean up to ${deg(r.lean)}° (${deg(theory)}°),` +
          ` 5th section ${deg(r.after)}° after it passed, speed ${r.speed.toFixed(2)} m/s, ${r.ms.toFixed(3)} ms a step`,
      );
    }
    console.log(rows.join('\n'));
    expect(res['0.6'].out).toBeGreaterThan(res['null'].out + 0.0005);
  }, 60000);
});

// The way round: to the machine, a fence that gives by F/k is the same as a
// roller that gives by F/k on a stiff fence (two springs in series), so put
// the fence's give between the roller and the chassis. A box chassis
// (130 g) runs along a continuous rigid wall at 3 m/s, pressed out by 4 N
// for 0.15 s (a curve) and then let go.
//  - 'body': the roller a 2 g ball on a sideways prismatic joint whose motor
//    is the fence's spring k (N/m), or the same with 20 g;
//  - 'shift': the roller stays a collider on the chassis, moved in each step
//    by F/k from its fence push (contact force events, smoothed 5 ms): no
//    extra body, the fence's own mass left out.
type Give = { kind: 'stiff' } | { kind: 'body'; k: number; mass: number } | { kind: 'shift'; k: number };

async function seriesSpring(give: Give) {
  const world = await lab(0);
  const wall = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0.0625, HEIGHT / 2, 0.5));
  const wallCollider = world.createCollider(RAPIER.ColliderDesc.cuboid(0.0025, HEIGHT / 2, 1).setFriction(0.01), wall);
  const chassis = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, ROLLER_Y, 0.05).setLinvel(0, 0, 3).lockRotations());
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.04, 0.01, 0.075).setMass(0.13).setSensor(true), chassis);
  const at = { x: 0.0535, y: 0, z: 0 };
  let roller: RAPIER.Collider | null = null;
  if (give.kind === 'body') {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, ROLLER_Y, 0.05).setLinvel(0, 0, 3));
    world.createCollider(RAPIER.ColliderDesc.ball(0.0065).setMass(give.mass).setFriction(0.01), body);
    const j = world.createImpulseJoint(RAPIER.JointData.prismatic(at, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }), chassis, body, true) as RAPIER.PrismaticImpulseJoint;
    j.configureMotorModel(RAPIER.MotorModel.ForceBased);
    j.configureMotorPosition(0, give.k, 0.5 * 2 * Math.sqrt(give.k * 0.13));
    j.setLimits(-0.006, 0.006);
    j.setContactsEnabled(false);
  } else {
    roller = world.createCollider(RAPIER.ColliderDesc.ball(0.0065).setTranslation(at.x, at.y, at.z).setMass(0).setFriction(0.01), chassis);
    roller.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
    roller.setContactForceEventThreshold(0);
  }
  const queue = new RAPIER.EventQueue(true);
  let held = 0;
  const pressed: number[] = [];
  let released = 0;
  for (let i = 0; i < 300; i++) {
    chassis.resetForces(true);
    if (i < 150) chassis.addForce({ x: PUSH, y: 0, z: 0 }, true);
    world.step(queue);
    let f = 0;
    queue.drainContactForceEvents((e) => {
      if (e.collider1() === wallCollider.handle || e.collider2() === wallCollider.handle) f += e.totalForceMagnitude();
    });
    if (give.kind === 'shift' && roller) {
      held += (f - held) * Math.min(1, world.timestep / 0.005);
      roller.setTranslationWrtParent({ x: at.x - held / give.k, y: at.y, z: at.z });
    }
    if (i >= 100 && i < 150) pressed.push(chassis.translation().x);
    if (i === 299) released = chassis.translation().x;
  }
  const speed = chassis.linvel().z;
  world.free();
  return { pressed: mean(pressed), released, speed };
}

describe('flexible fence as a spring behind the roller', () => {
  it('lets the machine out by F/k in the curve and back after', async () => {
    const rows: string[] = [];
    const res: Record<string, Awaited<ReturnType<typeof seriesSpring>>> = {};
    const gives: [string, Give][] = [
      ['stiff (today)', { kind: 'stiff' }],
      ['body 2 g, k=4000', { kind: 'body', k: 4000, mass: 0.002 }],
      ['body 20 g, k=4000', { kind: 'body', k: 4000, mass: 0.02 }],
      ['shift, k=4000', { kind: 'shift', k: 4000 }],
      ['shift, k=1333', { kind: 'shift', k: 1333 }],
    ];
    for (const [name, give] of gives) {
      const r = await seriesSpring(give);
      res[name] = r;
      const k = 'k' in give ? give.k : null;
      rows.push(
        `${name.padEnd(18)}: pressed 4 N → machine ${(r.pressed * 1000).toFixed(2)} mm out` +
          ` (F/k ${k === null ? 0 : ((PUSH / k) * 1000).toFixed(2)} mm), 0.15 s after letting go ${(r.released * 1000).toFixed(2)} mm, speed ${r.speed.toFixed(2)} m/s`,
      );
    }
    console.log(rows.join('\n'));
    const out = res['shift, k=1333'].pressed - res['stiff (today)'].pressed;
    expect(Math.abs(out - PUSH / 1333)).toBeLessThan(0.0005);
  }, 60000);
});

// The 'shift' way on the real machine round the basic oval: each roller
// moved in towards the chassis by its smoothed fence push / k.
import { layoutCourse } from '../../src/course/course';
import { basicOval } from '../../src/course/presets';
import { rideHeight } from '../../src/physics/machine';
import { Run } from '../../src/physics/run';

async function ovalWithGive(k: number | null) {
  const run = (await Run.create(layoutCourse(basicOval())))!;
  const { world, machine } = run;
  const fences = [...run.colliders.kinds].find(([, v]) => v.kind === 'fences')![0];
  const rollers = machine.colliders.slice(1);
  const index = new Map(rollers.map((c, i) => [c.handle, i]));
  for (const c of rollers) {
    c.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
    c.setContactForceEventThreshold(0);
  }
  const queue = new RAPIER.EventQueue(true);
  const held = [0, 0, 0, 0];
  let most = 0;
  const step = world.step.bind(world);
  (world as { step: () => void }).step = () => {
    step(queue);
    const f = [0, 0, 0, 0];
    queue.drainContactForceEvents((e) => {
      if (e.collider1() !== fences && e.collider2() !== fences) return;
      const i = index.get(e.collider1()) ?? index.get(e.collider2());
      if (i !== undefined) f[i] += e.totalForceMagnitude();
    });
    if (k === null) return;
    rollers.forEach((c, i) => {
      held[i] += (f[i] - held[i]) * Math.min(1, world.timestep / 0.005);
      const give = Math.min(0.005, held[i] / k);
      most = Math.max(most, give);
      const r = machine.spec.rollers[i];
      c.setTranslationWrtParent({ x: r.at[0] - Math.sign(r.at[0]) * give, y: r.at[1] - rideHeight(machine.spec), z: r.at[2] });
    });
  };
  let s = run.advance(0);
  while (s.time < 12 && !s.out && s.laps < 3) s = run.advance(0.01);
  run.free();
  return { s, most };
}

describe('flexible fence on the basic oval', () => {
  it('laps with the fences giving', async () => {
    const rows: string[] = [];
    for (const k of [null, 4000, 1333]) {
      const { s, most } = await ovalWithGive(k);
      rows.push(`${k === null ? 'stiff fences' : `k=${k} N/m`}: ${s.out ?? `${s.laps} laps`} in ${s.time.toFixed(2)} s, lap times ${s.lapTimes.map((t) => t.toFixed(3)).join(' / ')} s, most give ${(most * 1000).toFixed(2)} mm`);
    }
    console.log(rows.join('\n'));
  }, 120000);
});
