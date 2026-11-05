import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createMachine, driveMachine } from './machine';
import { freeSpeed, STANDARD_MACHINE, type MachineSpec } from './machine-spec';
import { STEP } from './run';
import { createPhysicsWorld, SPEED_CAP } from './world';

/** Say so when a machine's paper top speed comes this near Rapier's speed cap (#139). */
const CAP_WARN = 0.8;

/** The standard machine with a motor that turns `rpm` with no load. */
const withMotor = (rpm: number): MachineSpec => ({ ...STANDARD_MACHINE, motor: { ...STANDARD_MACHINE.motor, freeRpm: rpm } });

describe('physics world (#139)', () => {
  it('keeps contact tolerances at 0.05 mm of overlap and 0.2 mm of look-ahead', async () => {
    const world = await createPhysicsWorld();
    const p = world.integrationParameters;
    expect(p.normalizedAllowedLinearError * world.lengthUnit).toBeCloseTo(0.05e-3, 7);
    expect(p.normalizedPredictionDistance * world.lengthUnit).toBeCloseTo(0.2e-3, 7);
    world.free();
  });

  it('lets a body keep 15 m/s, as fast as real machines run', async () => {
    const world = await createPhysicsWorld();
    world.gravity = { x: 0, y: 0, z: 0 };
    world.timestep = STEP;
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setLinvel(0, 0, 15));
    world.createCollider(RAPIER.ColliderDesc.ball(0.01).setMass(0.1), b);
    world.step();
    expect(b.linvel().z).toBeCloseTo(15, 3);
    world.free();
  });

  it('lets a machine with a 24,000 rpm motor run well past the old 4 m/s cap', async () => {
    const spec = withMotor(24000);
    const world = await createPhysicsWorld();
    world.timestep = STEP;
    world.createCollider(RAPIER.ColliderDesc.cuboid(1, 0.01, 200).setTranslation(0, -0.01, 0));
    const m = createMachine(world, spec, new Vector3(0, 0, -190), new Vector3(0, 0, 1));
    for (let i = 0; i < 4000; i++) {
      driveMachine(m, STEP);
      world.step();
    }
    const v = m.vehicle.currentVehicleSpeed();
    expect(v).toBeGreaterThan(6);
    expect(v).toBeLessThan(freeSpeed(spec));
    world.free();
  }, 60000);

  it('leaves room under the cap for fast machines', () => {
    // A tuned machine on paper (48,000 rpm with the standard gears) is
    // about 15.6 m/s; past 80 % of the cap the cap would start to show.
    for (const rpm of [STANDARD_MACHINE.motor.freeRpm, 48000]) {
      expect(freeSpeed(withMotor(rpm))).toBeLessThan(CAP_WARN * SPEED_CAP);
    }
  });
});
