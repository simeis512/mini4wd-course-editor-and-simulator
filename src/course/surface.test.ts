import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { getPart } from './catalog';
import { partGeometry } from './geometry';
import { buildPartGeometry } from './mesh';
import { WAVE_BUMPS, WAVE_HEIGHT, heightProfile } from './surface';

describe('wave surface', () => {
  const wave = partGeometry(getPart('wave'));
  const straight = partGeometry(getPart('straight'));

  it('is flat at both ends so it joins like a straight', () => {
    expect(wave.heights[0]).toBeCloseTo(0, 9);
    expect(wave.heights.at(-1)!).toBeCloseTo(0, 9);
    const end = (m: typeof wave) => new Vector3().setFromMatrixPosition(m.ports[1]);
    expect(end(wave).distanceTo(end(straight))).toBeLessThan(1e-9);
  });

  it('rises to the bump height the given number of times', () => {
    expect(Math.max(...wave.heights)).toBeCloseTo(WAVE_HEIGHT, 1);
    const peaks = wave.heights.filter((h, i, a) => i > 0 && i < a.length - 1 && h > a[i - 1] && h >= a[i + 1]);
    expect(peaks.length).toBe(WAVE_BUMPS);
  });

  it('raises the road mesh but leaves a straight flat', () => {
    const top = (geo: ReturnType<typeof buildPartGeometry>) => {
      geo.road.computeBoundingBox();
      return geo.road.boundingBox!.max.y;
    };
    expect(top(buildPartGeometry(getPart('wave')))).toBeCloseTo(WAVE_HEIGHT, 1);
    expect(top(buildPartGeometry(getPart('straight')))).toBeCloseTo(0, 9);
  });

  it('rejects an unknown profile', () => {
    expect(() => heightProfile('nope')).toThrow();
  });
});
