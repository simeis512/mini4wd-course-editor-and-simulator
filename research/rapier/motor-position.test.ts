// 6. Motor position (モーター位置): can the simulator tell a midship motor
// (MS chassis, motor in the middle along the length) from a rear motor
// (Super-II type, across the back)?
//
// The standard machine (src/physics) with 18 g of its 130 g taken out of the
// chassis box and put in a motor-sized box, in the middle or at the back.
// Rapier works out the centre of mass and the inertia from the colliders;
// we read the tyre loads standing still, and the pitch in the air over the
// ramp-jump oval.
import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { layoutCourse } from '../../src/course/course';
import { rampJumpOval } from '../../src/course/presets';
import { createMachine, driveMachine, type Machine } from '../../src/physics/machine';
import { STANDARD_MACHINE } from '../../src/physics/machine-spec';
import { Run } from '../../src/physics/run';
import { block, lab, RAPIER } from './lab';

const MOTOR = 0.018;
type Layout = 'none' | 'midship' | 'rear';

/** Take the motor's mass out of the chassis box and put it in its own box. */
function fitMotor(world: RAPIER.World, m: Machine, where: Layout): void {
  if (where === 'none') return;
  m.colliders[0].setMass(m.spec.mass - MOTOR);
  // Motor can: 24 × 15 × 30 mm (FA-130 size, approx.), along the length in the middle for MS, across the back for a rear motor.
  const desc = where === 'midship'
    ? RAPIER.ColliderDesc.cuboid(0.012, 0.0075, 0.015)
    : RAPIER.ColliderDesc.cuboid(0.015, 0.0075, 0.012).setTranslation(0, 0, -0.055);
  // A sensor: it only carries mass and cannot touch the course.
  world.createCollider(desc.setMass(MOTOR).setSensor(true), m.body);
}

async function standing(where: Layout) {
  const world = await lab();
  block(world, [0, -0.01, 0], [1, 0.01, 1]);
  const m = createMachine(world, STANDARD_MACHINE, new Vector3(0, 0, 0), new Vector3(0, 0, 1));
  fitMotor(world, m, where);
  for (let i = 0; i < 300; i++) {
    driveMachine(m, world.timestep, false);
    world.step();
  }
  const loads = [0, 1, 2, 3].map((i) => m.vehicle.wheelSuspensionForce(i) ?? 0);
  const com = m.body.localCom();
  const inertia = m.body.principalInertia();
  world.free();
  return { front: loads[0] + loads[1], rear: loads[2] + loads[3], com, inertia };
}

async function jump(where: Layout) {
  const run = (await Run.create(layoutCourse(rampJumpOval())))!;
  fitMotor(run.world, run.machine, where);
  let s = run.advance(0);
  let noseDown = 0;
  let noseUp = 0;
  let air = 0;
  while (s.time < 8 && !s.out && s.laps < 3) {
    s = run.advance(0.001);
    const wheels = [0, 1, 2, 3].filter((i) => run.machine.vehicle.wheelIsInContact(i)).length;
    if (wheels > 0) continue;
    air++;
    const forward = new Vector3(0, 0, 1).applyQuaternion(s.quaternion);
    const pitch = (Math.asin(Math.max(-1, Math.min(1, forward.y))) * 180) / Math.PI;
    noseDown = Math.min(noseDown, pitch);
    noseUp = Math.max(noseUp, pitch);
  }
  run.free();
  return { air, noseDown, noseUp, out: s.out, laps: s.laps, time: s.time };
}

describe('motor position', () => {
  it('moves the centre of mass, the tyre loads and the pitch in the air', async () => {
    const rows: string[] = [];
    const res: Record<string, Awaited<ReturnType<typeof standing>>> = {};
    for (const where of ['none', 'midship', 'rear'] as Layout[]) {
      const st = await standing(where);
      res[where] = st;
      const j = await jump(where);
      rows.push(
        `${where.padEnd(8)} centre of mass z ${(st.com.z * 1000).toFixed(1)} mm; principal inertia ${[st.inertia.x, st.inertia.y, st.inertia.z].map((v) => (v * 1e7).toFixed(0)).join('/')} g·cm²; ` +
          `front/rear tyre load ${st.front.toFixed(3)}/${st.rear.toFixed(3)} N; ` +
          `over the ramp: ${j.air} ms in the air, pitch ${j.noseUp.toFixed(1)}° up to ${j.noseDown.toFixed(1)}° down, ${j.out ?? `${j.laps} laps in ${j.time.toFixed(2)} s`}`,
      );
    }
    console.log(rows.join('\n'));
    expect(res.rear.com.z).toBeLessThan(res.midship.com.z - 0.005);
    expect(res.rear.rear).toBeGreaterThan(res.midship.rear + 0.05);
  }, 60000);
});
