import { describe, expect, it } from 'vitest';
import { layoutCourse } from '../course/course';
import { basicOval, chain } from '../course/presets';
import { standardSetup, type MachineSetup } from '../machine/setup';
import { freeSpeed } from './machine-spec';
import { specFromSetup } from './machine-setup';
import { Run } from './run';

const straights = (n: number) => layoutCourse(chain(Array(n).fill('straight')));

/** Run straight along `n` straights for `seconds`, and say how far it got. */
async function runFor(setup: MachineSetup, seconds: number, n = 20) {
  const run = (await Run.create(straights(n), 1, 0, specFromSetup(setup)))!;
  const s = run.advance(seconds);
  const lifts = run.damperLifts();
  run.free();
  return { ...s, lifts };
}

describe('specFromSetup (#32)', () => {
  it('shares the mass out between the chassis box, the dampers and the weights', () => {
    const s: MachineSetup = {
      ...standardSetup(),
      measuredMass: 150,
      dampers: [{ weight: 'heavy', x: 0, y: 20, z: -60, stroke: 3 }],
      weights: [{ mass: 5, x: 0, y: 5, z: 40 }],
    };
    const spec = specFromSetup(s);
    expect(spec.mass).toBeCloseTo((150 - 8.8 - 5) / 1000, 9);
    expect(spec.dampers![0].mass).toBeCloseTo(0.0088, 9);
    expect(spec.weights![0].at).toEqual([0, 0.005, 0.04]);
  });

  it('puts the rollers in mirrored pairs inside the width across them', () => {
    const spec = specFromSetup(standardSetup());
    expect(spec.rollers).toHaveLength(4);
    expect(spec.rollers[0].at[0]).toBeCloseTo(0.105 / 2 - 0.0065, 9);
    expect(spec.rollers[1].at[0]).toBeCloseTo(-(0.105 / 2 - 0.0065), 9);
  });

  it('sits lower on smaller tyres', () => {
    const big = specFromSetup({ ...standardSetup(), tyre: 'large' });
    const small = specFromSetup({ ...standardSetup(), tyre: 'small-narrow' });
    expect(big.clearance - small.clearance).toBeCloseTo(0.0035, 9);
  });

  it('is faster with a faster motor and a higher gear', () => {
    const s = standardSetup();
    expect(freeSpeed(specFromSetup({ ...s, motor: 'hyper-dash-3' }))).toBeGreaterThan(freeSpeed(specFromSetup(s)));
    expect(freeSpeed(specFromSetup({ ...s, gearRatio: 3.5 }))).toBeGreaterThan(freeSpeed(specFromSetup(s)));
    expect(freeSpeed(specFromSetup({ ...s, battery: 'neo-champ' }))).toBeLessThan(freeSpeed(specFromSetup(s)));
  });
});

describe('a setup on the course (#32)', () => {
  it('speeds up slower when it is heavier', async () => {
    const light = await runFor(standardSetup(), 0.3);
    const heavy = await runFor({ ...standardSetup(), weights: [{ mass: 60, x: 0, y: 10, z: 0 }] }, 0.3);
    expect(heavy.distance).toBeLessThan(light.distance);
  });

  it('drags on a brake that touches the road, and not on one held clear', async () => {
    const pad = { sponge: 'white', z: -60, width: 40, length: 15 };
    const free = await runFor(standardSetup(), 1);
    const clear = await runFor({ ...standardSetup(), brakes: [{ ...pad, gap: 2 }] }, 1);
    const touching = await runFor({ ...standardSetup(), brakes: [{ ...pad, gap: -1 }] }, 1);
    expect(clear.distance).toBeCloseTo(free.distance, -1);
    expect(touching.distance).toBeLessThan(0.8 * free.distance);
  });

  it('lets a riding mass damper settle at the bottom of its travel, and a fixed one ride with the chassis', async () => {
    const s = await runFor({ ...standardSetup(), dampers: [{ weight: 'heavy', x: 30, y: 15, z: -50, stroke: 4 }, { weight: 'round', x: -30, y: 15, z: -50, stroke: 0 }] }, 0.5);
    expect(s.out).toBeNull();
    expect(s.lifts).toHaveLength(1);
    expect(Math.abs(s.lifts[0])).toBeLessThan(0.3);
  });

  it('leaves a riding damper behind, up its shaft within its stroke, when the chassis is jolted down', async () => {
    const setup = { ...standardSetup(), dampers: [{ weight: 'heavy', x: 0, y: 15, z: -50, stroke: 4 }] };
    const run = (await Run.create(straights(6), 1, 0, specFromSetup(setup)))!;
    run.advance(0.2);
    // As when the road drops away under it for a moment.
    run.machine.body.setLinvel({ x: 0, y: -1, z: 0 }, true);
    let most = 0;
    for (let i = 0; i < 200; i++) {
      run.advance(0.001);
      most = Math.max(most, ...run.damperLifts());
    }
    expect(most).toBeGreaterThan(0.3);
    expect(most).toBeLessThan(4);
    // And it comes back down.
    run.advance(0.5);
    expect(run.damperLifts()[0]).toBeLessThan(0.1);
    run.free();
  });

  it('laps the basic oval in every lane as the standard setup', async () => {
    for (const lane of [0, 1, 2]) {
      const run = (await Run.create(layoutCourse(basicOval()), 1, lane, specFromSetup(standardSetup())))!;
      let s = run.advance(0);
      while (s.time < 20 && s.laps < 2 && !s.out) s = run.advance(0.01);
      expect(s.out, `lane ${lane}`).toBeNull();
      run.free();
    }
  }, 60000);
});
