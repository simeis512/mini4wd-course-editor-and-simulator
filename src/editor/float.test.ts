import { describe, expect, it } from 'vitest';
import { floatSpot, rectAround } from './float';

const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

describe('floatSpot', () => {
  it('goes beside the selection on the right when there is room', () => {
    const sel = rect(100, 200, 200, 300);
    expect(floatSpot(200, 100, 1000, 800, sel, [sel])).toEqual([224, 200]);
  });

  it('moves off the highlighted pieces, even to the far side', () => {
    const sel = rect(400, 380, 420, 400);
    // A run lighting up everything right of the joint.
    const run = rect(420, 100, 900, 700);
    const [x, y] = floatSpot(200, 300, 1000, 800, sel, [sel, run]);
    expect(x + 200).toBeLessThanOrEqual(400);
    expect(y).toBeGreaterThanOrEqual(8);
  });

  it('keeps on the stage', () => {
    const sel = rect(950, 780, 990, 795);
    const [x, y] = floatSpot(200, 300, 1000, 800, sel, [sel]);
    expect(x).toBeGreaterThanOrEqual(8);
    expect(x + 200).toBeLessThanOrEqual(992);
    expect(y + 300).toBeLessThanOrEqual(792);
  });

  it('sits in the top right corner with nothing selected on screen', () => {
    expect(floatSpot(200, 100, 1000, 800, null, [])).toEqual([792, 8]);
  });
});

describe('rectAround', () => {
  it('bounds the points', () => {
    expect(rectAround([[3, 4], [1, 9], [5, 2]])).toEqual(rect(1, 2, 5, 9));
    expect(rectAround([])).toBeNull();
  });
});
