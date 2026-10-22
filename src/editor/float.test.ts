import { describe, expect, it } from 'vitest';
import { cornerSpot, floatSpot, rectAround } from './float';

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

describe('cornerSpot', () => {
  it('stands in the top right corner whatever is selected', () => {
    expect(cornerSpot(200, 300, 1000, 800, [rect(100, 200, 200, 300)])).toEqual([792, 8]);
    expect(cornerSpot(200, 300, 1000, 800, [rect(400, 380, 420, 400)])).toEqual([792, 8]);
    expect(cornerSpot(200, 300, 1000, 800, [])).toEqual([792, 8]);
  });

  it('moves down, clear of the fit button, when it would hide the selection', () => {
    expect(cornerSpot(200, 300, 1000, 800, [rect(850, 50, 900, 100)])).toEqual([792, 444]);
  });

  it('goes to the top left when both right corners would hide it', () => {
    expect(cornerSpot(200, 300, 1000, 800, [rect(850, 0, 900, 800)])).toEqual([8, 8]);
  });

  it('keeps on a stage narrower than the box', () => {
    expect(cornerSpot(290, 300, 200, 800, [])).toEqual([8, 8]);
  });
});
