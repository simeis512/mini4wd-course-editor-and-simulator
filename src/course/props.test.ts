import { describe, expect, it } from 'vitest';
import { emptyCourse, layoutCourse } from './course';
import { addPiece } from './edit';
import { propAt, propOutline, propPoint } from './props';
import { addStopper, newStopper } from './stoppers';
import { placeStart, TIMER } from './timing';

/** A straight along + Z with the start 100mm in and the timer 150mm past it, and a box and a hose beside it. */
function course() {
  let c = placeStart(addPiece(emptyCourse(), 'straight', null), 0, 100);
  c = addStopper(c, { kind: 'box', size: 0, x: 600, z: 270, yaw: 0 });
  return addStopper(c, newStopper('hose', -600, 270));
}

describe('propAt (#56, #53)', () => {
  const layout = layoutCourse(course());

  it('finds the timer over the road, then the start line on it, then the stoppers', () => {
    expect(propAt(layout, 0, 100)).toEqual({ kind: 'start' });
    // The timer covers the left lane (+ X) 250mm in.
    expect(propAt(layout, 120, 250)).toEqual({ kind: 'timer' });
    expect(propAt(layout, -120, 250)).toBeNull();
    expect(propAt(layout, 600, 270)).toEqual({ kind: 'stopper', index: 0 });
    expect(propAt(layout, -400, 270, 5)).toEqual({ kind: 'stopper', index: 1 });
  });

  it('leaves out what is skipped, keeping the stoppers numbered', () => {
    const skipBox = (r: { kind: string; index?: number }) => r.kind === 'stopper' && r.index === 0;
    expect(propAt(layout, 600, 270, 0, skipBox)).toBeNull();
    expect(propAt(layout, -400, 270, 5, skipBox)).toEqual({ kind: 'stopper', index: 1 });
    expect(propAt(layout, 0, 100, 0, (r) => r.kind === 'start')).toBeNull();
  });

  it('gives a point to keep the settings beside', () => {
    expect(propPoint(layout, { kind: 'start' })!.toArray()).toEqual([0, 0, 100]);
    expect(propPoint(layout, { kind: 'timer' })!.y).toBeCloseTo(TIMER.bodyHeight);
    expect(propPoint(layout, { kind: 'stopper', index: 0 })!.x).toBe(600);
    expect(propPoint(layout, { kind: 'stopper', index: 1 })!.x).toBeCloseTo(-600);
    expect(propPoint(layout, { kind: 'stopper', index: 5 })).toBeNull();
    // The settings keep off all of it, not just its middle.
    const hose = propOutline(layout, { kind: 'stopper', index: 1 });
    expect(Math.min(...hose.map((p) => p[0]))).toBeCloseTo(-800, -1);
    expect(propOutline(layout, { kind: 'stopper', index: 0 })).toHaveLength(4);
    expect(propOutline(layout, { kind: 'start' }).length).toBeGreaterThanOrEqual(4);
  });
});
