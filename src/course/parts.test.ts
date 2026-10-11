import { describe, expect, it } from 'vitest';
import { LANE_COUNT, LANE_WIDTH_MM, TRACK_WIDTH_MM, WALL_THICKNESS_MM, laneCenterOffsetMm } from './parts';

describe('laneCenterOffsetMm', () => {
  it('centres the middle lane on the track centreline', () => {
    expect(laneCenterOffsetMm(1)).toBe(0);
  });

  it('places the outer lanes symmetrically', () => {
    expect(laneCenterOffsetMm(0)).toBe(-laneCenterOffsetMm(LANE_COUNT - 1));
  });

  it('keeps every lane inside the track', () => {
    for (let i = 0; i < LANE_COUNT; i++) {
      const edge = Math.abs(laneCenterOffsetMm(i)) + LANE_WIDTH_MM / 2 + WALL_THICKNESS_MM;
      expect(edge).toBeLessThanOrEqual(TRACK_WIDTH_MM / 2);
    }
  });

  it('rejects out-of-range lanes', () => {
    expect(() => laneCenterOffsetMm(LANE_COUNT)).toThrow(RangeError);
  });
});
