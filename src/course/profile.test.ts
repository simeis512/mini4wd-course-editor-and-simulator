import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { getPart } from './catalog';
import { attach, facingError, partGeometry } from './geometry';
import { WAVE_AMPLITUDE, lateralProfile } from './profile';

describe('wave', () => {
  const wave = partGeometry(getPart('wave'));
  const straight = partGeometry(getPart('straight'));
  const pos = (m: { elements: number[] }) => new Vector3(m.elements[12], m.elements[13], m.elements[14]);

  it('ends exactly where a straight ends, facing the same way', () => {
    // An end port faces a start port of the next piece, so compare against a straight's start turned round.
    const err = facingError(wave.ports[1], attach(straight.ports[1], straight.ports[0]).multiply(straight.ports[0]));
    expect(err.distance).toBeLessThan(1e-9);
    expect(err.angle).toBeLessThan(1e-6);
  });

  it('swings once to the left by the amplitude, staying level', () => {
    const xs = wave.samples.map((f) => pos(f).x);
    expect(Math.max(...xs)).toBeCloseTo(WAVE_AMPLITUDE, 6);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-1e-9);
    const peaks = xs.filter((x, i) => i > 0 && i < xs.length - 1 && x > xs[i - 1] && x >= xs[i + 1]);
    expect(peaks.length).toBe(1);
    for (const f of wave.samples) expect(Math.abs(pos(f).y)).toBeLessThan(1e-9);
  });

  it('turns each frame to follow the swing', () => {
    const forward = (i: number) => new Vector3(0, 0, 1).transformDirection(wave.samples[i]);
    const quarter = Math.round(wave.samples.length / 4);
    expect(forward(quarter).x).toBeGreaterThan(0);
    expect(forward(3 * quarter).x).toBeLessThan(0);
  });

  it('rejects an unknown profile', () => {
    expect(() => lateralProfile('nope')).toThrow();
  });
});
