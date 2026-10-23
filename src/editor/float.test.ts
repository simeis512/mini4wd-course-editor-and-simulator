import { describe, expect, it } from 'vitest';
import { cornerSpot, rectAround } from './float';

const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

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
