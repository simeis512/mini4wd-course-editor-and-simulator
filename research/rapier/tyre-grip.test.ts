// B. Grip: Rapier's contacts have only Coulomb friction (full force at any
// slip), but the tyres are the ray-cast vehicle's, which has its own model.
// How do they answer a sideways push (cornering) and too much drive?
// The standard machine on a flat floor, no fences.
import { Vector3 } from 'three';
import { describe, it } from 'vitest';
import { createMachine, driveMachine } from '../../src/physics/machine';
import { STANDARD_MACHINE, type MachineSpec } from '../../src/physics/machine-spec';
import { block, lab, mean } from './lab';

async function sideways(push: number) {
  const world = await lab();
  block(world, [0, -0.01, 0], [5, 0.01, 50], 0.5);
  const m = createMachine(world, STANDARD_MACHINE, new Vector3(0, 0, -40), new Vector3(0, 0, 1));
  const drift: number[] = [];
  for (let i = 0; i < 1500; i++) {
    m.body.resetForces(true);
    if (i > 500) m.body.addForce({ x: push, y: 0, z: 0 }, true);
    driveMachine(m, world.timestep);
    world.step();
    if (i > 1000) drift.push(m.body.linvel().x);
  }
  const speed = m.vehicle.currentVehicleSpeed();
  world.free();
  return { drift: mean(drift), speed };
}

async function launch(spec: MachineSpec) {
  const world = await lab();
  block(world, [0, -0.01, 0], [5, 0.01, 50], 0.5);
  const m = createMachine(world, spec, new Vector3(0, 0, -40), new Vector3(0, 0, 1));
  for (let i = 0; i < 100; i++) {
    driveMachine(m, world.timestep);
    world.step();
  }
  const a = m.body.linvel().z / 0.1;
  world.free();
  return a;
}

describe('tyre grip', () => {
  it('sideways: the tyres slide in proportion to the push, with no sticking range', async () => {
    const rows: string[] = [];
    for (const f of [0.02, 0.05, 0.1, 0.2, 0.4, 0.8]) {
      const r = await sideways(f);
      rows.push(`side push ${f} N (${(f / (STANDARD_MACHINE.mass * 9.81)).toFixed(2)} g): drifts sideways at ${(r.drift * 1000).toFixed(0)} mm/s, forward ${r.speed.toFixed(2)} m/s`);
    }
    console.log(rows.join('\n'));
  }, 60000);

  it('forward: start-off acceleration against what grip allows', async () => {
    const rows: string[] = [];
    for (const torque of [1, 3, 10, 30]) {
      const spec = { ...STANDARD_MACHINE, motor: { ...STANDARD_MACHINE.motor, stallTorque: STANDARD_MACHINE.motor.stallTorque * torque } };
      const a = await launch(spec);
      rows.push(`stall torque ×${torque}: first 0.1 s ${a.toFixed(1)} m/s² (grip ${STANDARD_MACHINE.grip} × g = ${(STANDARD_MACHINE.grip * 9.81).toFixed(1)} m/s²)`);
    }
    console.log(rows.join('\n'));
  }, 60000);
});
