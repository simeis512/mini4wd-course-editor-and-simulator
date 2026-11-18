import { describe, expect, it } from 'vitest';
import { freeSpeedKmh, massOf, ROLLER_PRESETS, setupWarnings, standardSetup, validateSetup, withChassis } from './setup';

describe('standardSetup', () => {
  it('is valid and has nothing to warn about', () => {
    const s = standardSetup();
    expect(() => validateSetup(s)).not.toThrow();
    expect(setupWarnings(s)).toEqual([]);
  });

  it('presets are within the regulation', () => {
    for (const p of ROLLER_PRESETS) expect(setupWarnings({ ...standardSetup(), rollers: p.rollers(150) })).toEqual([]);
  });
});

describe('massOf', () => {
  it('starts from the chassis guide and adds what is fitted', () => {
    const s = standardSetup();
    const m = massOf(s);
    // The guide's build, with its own rollers, is what the standard setup is.
    expect(m.estimated).toBeCloseTo(115);
    const heavier = massOf({ ...s, dampers: [{ weight: 'heavy', x: 0, y: 10, z: -60, stroke: 3 }], weights: [{ mass: 2, x: 0, y: 5, z: 0 }] });
    expect(heavier.estimated - m.estimated).toBeCloseTo(10.8);
  });

  it('takes lighter cells off', () => {
    const s = standardSetup();
    expect(massOf(s).total - massOf({ ...s, battery: 'neo-champ' }).total).toBeCloseTo(8);
  });

  it('uses the weighed mass when there is one', () => {
    expect(massOf({ ...standardSetup(), measuredMass: 140 }).total).toBe(140);
  });
});

describe('setupWarnings', () => {
  it('says when the rollers are too wide or the brake too low', () => {
    const s = standardSetup();
    const w = setupWarnings({
      ...s,
      rollers: [{ ...s.rollers[0], width: 108 }],
      brakes: [{ sponge: 'white', z: -60, width: 30, length: 10, gap: 0.5 }],
    });
    expect(w.some((t) => t.includes('108mm'))).toBe(true);
    expect(w.some((t) => t.includes('ブレーキ'))).toBe(true);
  });

  it('says when the machine is too long', () => {
    const s = standardSetup();
    expect(setupWarnings({ ...s, rollers: [{ ...s.rollers[0], z: 85 }] }).some((t) => t.includes('全長'))).toBe(true);
  });
});

describe('withChassis', () => {
  it('swaps the motor for one that fits the shaft', () => {
    const s = withChassis(standardSetup(), 'ma');
    expect(s.motor).toBe('torque-2-pro');
    expect(withChassis(s, 'me').motor).toBe('torque-2-pro');
  });
});

describe('freeSpeedKmh', () => {
  it('is faster with a higher gear and bigger tyres', () => {
    const s = standardSetup();
    expect(freeSpeedKmh({ ...s, gearRatio: 3.5 })).toBeGreaterThan(freeSpeedKmh(s));
    expect(freeSpeedKmh({ ...s, tyre: 'large' })).toBeGreaterThan(freeSpeedKmh(s));
    // 15,000 rpm / 4.2 × π × 26 mm
    expect(freeSpeedKmh(s)).toBeCloseTo(17.5, 1);
  });
});

describe('validateSetup', () => {
  it('refuses unknown parts and bad numbers', () => {
    expect(() => validateSetup({ ...standardSetup(), motor: 'x' })).toThrow();
    expect(() => validateSetup({ ...standardSetup(), gearRatio: 6 })).toThrow();
    expect(() => validateSetup({ ...standardSetup(), weights: [{ mass: 0, x: 0, y: 0, z: 0 }] })).toThrow();
    expect(() => validateSetup({ ...standardSetup(), weights: [{ mass: 1, x: NaN, y: 0, z: 0 }] })).toThrow();
  });
});
