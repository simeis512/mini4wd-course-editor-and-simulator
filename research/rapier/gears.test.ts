// 5. Gears (ギヤ): how far can Rapier carry the drive train?
//
// Rapier has no gear joint (nothing ties one body's turning to another's
// by a ratio), and gear teeth as colliders are far below what it can touch
// at 1 ms (0.5-module teeth, ~10,000 rpm). So: each shaft is a body on a
// revolute joint, and the mesh between two gears is a stiff torsion spring
// we apply each step, with a dead band for the backlash. Then: does the
// ratio hold, does the backlash show, does the motor's reaction twist the
// chassis, and does Rapier turn spinning bodies gyroscopically?
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { lab, RAPIER } from './lab';

/** A shaft on the chassis turning about x, with the inertia of a small gear (or the motor's armature). */
function shaft(world: RAPIER.World, chassis: RAPIER.RigidBody, x: number, inertia: number): RAPIER.RigidBody {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0, 0));
  world.createCollider(
    RAPIER.ColliderDesc.ball(0.004).setMassProperties(0.003, { x: 0, y: 0, z: 0 }, { x: inertia, y: inertia, z: inertia }, { x: 0, y: 0, z: 0, w: 1 }),
    body,
  ).setSensor(true);
  world.createImpulseJoint(RAPIER.JointData.revolute({ x, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }), chassis, body, true).setContactsEnabled(false);
  return body;
}

/** Turning about x relative to the chassis, rad/s. */
const spin = (b: RAPIER.RigidBody, chassis: RAPIER.RigidBody) => b.angvel().x - chassis.angvel().x;

async function drive(backlash: number, chassisFree: boolean) {
  const world = await lab(0);
  // The motor spins past Rapier's limit of π/4 per step at 1 ms (785 rad/s, see below).
  world.timestep = 2.5e-4;
  const steps = (t: number) => Math.round(t / world.timestep);
  const chassis = world.createRigidBody(chassisFree ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.04, 0.01, 0.075).setMass(0.13), chassis).setSensor(true);
  const ratio = 4.2;
  const motor = shaft(world, chassis, 0.02, 2e-8);
  const wheel = shaft(world, chassis, -0.02, 6e-8);
  // Load on the wheel shaft: a drag torque ∝ speed, as the tyres would feel.
  const load = 2e-5;
  // Mesh stiffness and damping at the wheel shaft, N·m/rad and N·m·s/rad (provisional).
  const K = 0.05;
  const C = 2e-5;
  let angle = 0; // motor turned, rad, minus ratio × wheel turned, measured at the wheel
  const ratios: number[] = [];
  let firstTurn = -1;
  for (let i = 0; i < steps(1); i++) {
    const wm = spin(motor, chassis);
    const ww = spin(wheel, chassis);
    angle += (wm / ratio - ww) * world.timestep;
    const wind = Math.abs(angle) <= backlash / 2 ? 0 : angle - Math.sign(angle) * (backlash / 2);
    const mesh = wind === 0 ? 0 : K * wind + C * (wm / ratio - ww); // torque at the wheel shaft
    const motorTorque = 0.0035 * (1 - (wm * 60) / (2 * Math.PI) / 12000) * (i >= steps(0.1) ? 1 : 0);
    for (const b of [motor, wheel]) {
      b.resetTorques(true);
    }
    chassis.resetTorques(true);
    motor.addTorque(rot(chassis, motorTorque - mesh / ratio), true);
    wheel.addTorque(rot(chassis, mesh - load * ww), true);
    // What the gears push on the motor and wheel, the chassis gets back.
    chassis.addTorque(rot(chassis, -(motorTorque - mesh / ratio) - (mesh - load * ww)), true);
    world.step();
    if (i >= steps(0.1) && firstTurn < 0 && Math.abs(spin(wheel, chassis)) > 1) firstTurn = (i - steps(0.1)) * world.timestep * 1000;
    if (i > steps(0.7)) ratios.push(spin(motor, chassis) / spin(wheel, chassis));
  }
  const out = {
    ratio: ratios.reduce((a, b) => a + b, 0) / ratios.length,
    wheelRpm: (spin(wheel, chassis) * 60) / (2 * Math.PI),
    firstTurn,
    chassisRoll: chassis.angvel().x,
  };
  world.free();
  return out;
}

/** A torque about the chassis's x axis, as a world vector. */
function rot(chassis: RAPIER.RigidBody, t: number) {
  const r = chassis.rotation();
  const v = new Vector3(t, 0, 0).applyQuaternion(new Quaternion(r.x, r.y, r.z, r.w));
  return { x: v.x, y: v.y, z: v.z };
}

describe('gears', () => {
  it('a torsion-spring mesh keeps the ratio, shows backlash and twists the chassis back', async () => {
    const tight = await drive(0, false);
    const loose = await drive((2 * Math.PI) / 180 * 3, false);
    const free = await drive(0, true);
    console.log(
      [
        `no backlash: motor/wheel ${tight.ratio.toFixed(3)} (set 4.2), wheel ${tight.wheelRpm.toFixed(0)} rpm, wheel starts turning ${tight.firstTurn.toFixed(2)} ms after the motor`,
        `3° backlash: motor/wheel ${loose.ratio.toFixed(3)}, wheel starts turning ${loose.firstTurn.toFixed(2)} ms after the motor`,
        `chassis free to turn: it turns at ${free.chassisRoll.toFixed(2)} rad/s the other way (reaction torque)`,
      ].join('\n'),
    );
    expect(Math.abs(tight.ratio - 4.2)).toBeLessThan(0.05);
    expect(loose.firstTurn).toBeGreaterThan(tight.firstTurn);
    expect(Math.abs(free.chassisRoll)).toBeGreaterThan(0);
  }, 60000);

  it('Rapier turns bodies gyroscopically, but loses its grip on bodies spinning at motor speed', async () => {
    // Spun about its middle axis, a body with three different inertias
    // flips over and back (the Dzhanibekov effect): only with gyroscopic
    // terms in the integration.
    const world = await lab(0);
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setAngvel({ x: 0.01, y: 20, z: 0 }));
    world.createCollider(
      RAPIER.ColliderDesc.ball(0.01).setMassProperties(0.01, { x: 0, y: 0, z: 0 }, { x: 1e-6, y: 2e-6, z: 3e-6 }, { x: 0, y: 0, z: 0, w: 1 }),
      b,
    );
    const flips: number[] = [];
    for (let i = 0; i < 3000; i++) {
      world.step();
      const r = b.rotation();
      const w = b.angvel();
      flips.push(new Vector3(w.x, w.y, w.z).applyQuaternion(new Quaternion(r.x, r.y, r.z, r.w).invert()).y);
    }
    world.free();
    // A tyre (300 rad/s ≈ 14 km/h on 26 mm, 650 ≈ 30 km/h) and the motor (1300 rad/s ≈ 12,400 rpm), spun about their axles for 1 s.
    const rows: string[] = [`middle-axis spin, body-frame ω every 0.25 s: ${flips.filter((_, i) => i % 250 === 0).map((x) => x.toFixed(0)).join(' ')} rad/s`];
    const kept: Record<string, number> = {};
    for (const [w, dt] of [[300, 1e-3], [650, 1e-3], [1300, 1e-3], [1300, 2.5e-4]]) {
      const world2 = await lab(0);
      world2.timestep = dt;
      const d = world2.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setAngvel({ x: 0, y: w, z: 0 }));
      world2.createCollider(RAPIER.ColliderDesc.cylinder(0.005, 0.013).setMass(0.01), d);
      for (let i = 0; i < Math.round(1 / dt); i++) world2.step();
      kept[`${w} ${dt}`] = d.angvel().y;
      rows.push(`disc spun at ${w} rad/s, step ${dt * 1000} ms: after 1 s ${d.angvel().y.toFixed(1)} rad/s`);
      world2.free();
    }
    // Spun about an axle set by turning the collider, not the body, it wobbles.
    const world3 = await lab(0);
    const d3 = world3.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setAngvel({ x: 650, y: 0, z: 0 }));
    world3.createCollider(RAPIER.ColliderDesc.cylinder(0.005, 0.013).setRotation({ x: 0, y: 0, z: Math.sin(Math.PI / 4), w: Math.cos(Math.PI / 4) }).setMass(0.01), d3);
    let tilt = 0;
    for (let i = 0; i < 1000; i++) {
      world3.step();
      const r = d3.rotation();
      const axis = new Vector3(1, 0, 0).applyQuaternion(new Quaternion(r.x, r.y, r.z, r.w));
      tilt = Math.max(tilt, Math.acos(Math.min(1, Math.abs(axis.x))));
    }
    rows.push(`disc on a turned collider spun at 650 rad/s: axle wandered ${((tilt * 180) / Math.PI).toFixed(0)}° in 1 s`);
    world3.free();
    console.log(rows.join('\n'));
    expect(Math.min(...flips)).toBeLessThan(-15);
    expect(Math.abs(kept['300 0.001'] - 300)).toBeLessThan(1);
    // Rapier turns a body at most π/4 per step: 785 rad/s at 1 ms.
    expect(kept['1300 0.001']).toBeCloseTo(Math.PI / 4 / 1e-3, 0);
    expect(Math.abs(kept['1300 0.00025'] - 1300)).toBeLessThan(5);
  }, 60000);
});
