// J. Rapier holds every body's speed under 400 × lengthUnit m/s. The
// simulator's lengthUnit of 0.01 (src/physics/world.ts) caps the machine
// at 4 m/s (14.4 km/h); real machines run 8-17 m/s.
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createMachine, driveMachine } from '../../src/physics/machine';
import { STANDARD_MACHINE, freeSpeed } from '../../src/physics/machine-spec';
import { block, lab, RAPIER } from './lab';

describe('speed cap', () => {
  it('a ball set going at 50 m/s keeps at most 400 × lengthUnit', async () => {
    await RAPIER.init();
    const rows: string[] = [];
    for (const lu of [1, 0.1, 0.05, 0.01]) {
      const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
      world.lengthUnit = lu;
      world.timestep = 1e-3;
      const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setLinvel(0, 0, 50));
      world.createCollider(RAPIER.ColliderDesc.ball(0.01).setMass(0.1), b);
      world.step();
      rows.push(`lengthUnit ${lu}: 50 m/s → ${b.linvel().z.toFixed(2)} m/s after one step`);
      world.free();
    }
    console.log(rows.join('\n'));
  });

  it('the machine with a faster motor stops at 4 m/s at lengthUnit 0.01', async () => {
    const rows: string[] = [];
    for (const lu of [0.01, 0.05]) {
      for (const rpm of [12000, 24000, 48000]) {
        const spec = { ...STANDARD_MACHINE, motor: { ...STANDARD_MACHINE.motor, freeRpm: rpm } };
        const world = await lab();
        world.lengthUnit = lu;
        block(world, [0, -0.01, 0], [1, 0.01, 200]);
        const m = createMachine(world, spec, new Vector3(0, 0, -190), new Vector3(0, 0, 1));
        for (let i = 0; i < 4000; i++) {
          driveMachine(m, world.timestep);
          world.step();
        }
        const v = m.vehicle.currentVehicleSpeed();
        rows.push(`lengthUnit ${lu}, motor ${rpm} rpm: top speed ${freeSpeed(spec).toFixed(2)} m/s on paper, ${v.toFixed(2)} m/s after 4 s`);
        if (lu === 0.01 && rpm > 12000) expect(v).toBeCloseTo(4, 2);
        world.free();
      }
    }
    console.log(rows.join('\n'));
  }, 60000);
});
