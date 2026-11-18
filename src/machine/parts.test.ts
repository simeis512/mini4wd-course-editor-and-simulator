import { describe, expect, it } from 'vitest';
import { byId, CHASSIS, motorLine, MOTORS, rollerMass, ROLLER_KINDS } from './parts';

describe('motorLine (#25, owner 2026-10-27)', () => {
  it('goes through the middle of the recommended load and frees up at 1.25 times its speed', () => {
    const m = byId(MOTORS, 'hyper-dash-3');
    const { freeRpm, stallTorque } = motorLine(m);
    expect(freeRpm).toBeCloseTo(19200 * 1.25);
    // The middle point is on the line.
    const torqueAt = (rpm: number) => stallTorque * (1 - rpm / freeRpm);
    expect(torqueAt(19200)).toBeCloseTo(0.00165, 6);
    expect(stallTorque).toBeCloseTo(0.00165 * 5, 6);
  });

  it('keeps the normal motor at about the 12,000 rpm it had', () => {
    const { freeRpm, stallTorque } = motorLine(byId(MOTORS, 'normal'));
    expect(freeRpm).toBe(15000);
    expect(stallTorque).toBeCloseTo(0.0035, 6);
  });

  it('scales with the battery voltage', () => {
    const m = byId(MOTORS, 'torque-2');
    const full = motorLine(m, 3);
    const low = motorLine(m, 2.4);
    expect(low.freeRpm / full.freeRpm).toBeCloseTo(0.8);
    expect(low.stallTorque / full.stallTorque).toBeCloseTo(0.8);
  });
});

describe('parts lists', () => {
  it('have unique ids', () => {
    for (const list of [CHASSIS, MOTORS, ROLLER_KINDS]) expect(new Set(list.map((p) => p.id)).size).toBe(list.length);
  });

  it('weigh rollers by their size', () => {
    expect(rollerMass(ROLLER_KINDS[0], 13) * 2).toBeCloseTo(1.7);
    expect(rollerMass(ROLLER_KINDS[0], 19)).toBeGreaterThan(rollerMass(ROLLER_KINDS[0], 13));
  });

  it('throws for an unknown id', () => {
    expect(() => byId(CHASSIS, 'nope')).toThrow();
  });
});
