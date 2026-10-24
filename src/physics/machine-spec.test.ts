import { describe, expect, it } from 'vitest';
import { driveForce, freeSpeed, motorTorque, STANDARD_MACHINE } from './machine-spec';

describe('motor (spec simulator.md 3)', () => {
  const m = STANDARD_MACHINE.motor;

  it('gives its stall torque held still and none at its free speed', () => {
    expect(motorTorque(m, 0)).toBe(m.stallTorque);
    expect(motorTorque(m, m.freeRpm / 2)).toBeCloseTo(m.stallTorque / 2, 12);
    expect(motorTorque(m, m.freeRpm)).toBe(0);
    expect(motorTorque(m, 2 * m.freeRpm)).toBe(0);
  });

  it('pushes the standard machine hardest from a standstill, and not at all at about 3.9 m/s', () => {
    expect(freeSpeed(STANDARD_MACHINE)).toBeCloseTo(3.89, 2);
    expect(driveForce(STANDARD_MACHINE, 0)).toBeCloseTo((0.0035 * 4.2 * 0.7) / 0.013, 9);
    expect(driveForce(STANDARD_MACHINE, freeSpeed(STANDARD_MACHINE))).toBeCloseTo(0, 9);
  });
});
