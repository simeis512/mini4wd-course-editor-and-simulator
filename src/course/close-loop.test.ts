import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { layoutCourse, type Course } from './course';
import { chain } from './presets';
import { CLOSE_LOOP_ANGLE, CLOSE_LOOP_DISTANCE, CLOSE_LOOP_LIMIT, closeLoop, loopEnds } from './close-loop';

/** A long oval: `n` straights each side and four 45° curves at each end, opened by bending the joint into piece `at` by `yaw` deg. */
function opened(n: number, yaw: number, at = 1): Course {
  const half = [...Array(n).fill('straight'), ...Array(4).fill('curve45')];
  const c = chain([...half, ...half]);
  (c.pieces[at] as { bend?: { yaw?: number } }).bend = { yaw };
  return c;
}

/** Every bend and twist a closing added, deg. */
function added(before: Course, after: Course): number[] {
  return after.pieces.flatMap((rec, i) => {
    const was = before.pieces[i] as { bend?: { pitch?: number; yaw?: number }; twist?: number };
    const now = rec as typeof was;
    return [
      (now.bend?.pitch ?? 0) - (was.bend?.pitch ?? 0),
      (now.bend?.yaw ?? 0) - (was.bend?.yaw ?? 0),
      (now.twist ?? 0) - (was.twist ?? 0),
    ];
  });
}

describe('loopEnds (#86)', () => {
  it('finds the two open ends of a group that does not close', () => {
    const ends = loopEnds(layoutCourse(opened(26, 3.1)), 5)!;
    expect([ends.a.piece, ends.b.piece].sort((p, q) => p - q)).toEqual([0, 59]);
    expect(ends.angle).toBeCloseTo(3.1, 3);
  });

  it('has none for a loop that already closes', () => {
    expect(loopEnds(layoutCourse(opened(4, 0)), 0)).toBeNull();
  });
});

describe('closeLoop (#86)', () => {
  const course = opened(26, 3.1);
  const result = closeLoop(course, 0, 0.01);

  it('brings the ends together until they meet as a closure, nearly exactly', () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ends.distance).toBeLessThanOrEqual(CLOSE_LOOP_DISTANCE);
    expect(result.ends.angle).toBeLessThanOrEqual(CLOSE_LOOP_ANGLE);
    const layout = layoutCourse(result.course);
    expect(layout.open).toEqual([]);
    expect(layout.closures).toHaveLength(1);
  });

  it('adds no more than the limit to any joint or piece, in stored steps', () => {
    if (!result.ok) throw new Error('did not close');
    const all = added(course, result.course);
    for (const v of all) {
      expect(Math.abs(v)).toBeLessThanOrEqual(CLOSE_LOOP_LIMIT + 1e-9);
      expect(Math.abs(v * 100 - Math.round(v * 100))).toBeLessThan(1e-6);
    }
    // Spread over many joints rather than a few.
    expect(all.filter((v) => Math.abs(v) > 1e-9).length).toBeGreaterThan(20);
  });

  it('keeps the floor pieces on the floor and level, and the middle where it was', () => {
    if (!result.ok) throw new Error('did not close');
    const [before, after] = [layoutCourse(course), layoutCourse(result.course)];
    for (const pc of after.pieces) {
      for (const p of pc.ports) {
        expect(Math.abs(p.elements[13])).toBeLessThan(1e-6);
        expect(new Vector3(0, 1, 0).transformDirection(p).y).toBeCloseTo(1, 9);
      }
    }
    // Up to the 0.1° / 0.1mm the moved group's first piece is stored to (spec 16.5).
    const middle = (p: typeof before) => new Vector3().setFromMatrixPosition(p.pieces[30].matrix);
    expect(middle(after).distanceTo(middle(before))).toBeLessThan(5);
    const end = (p: typeof before) => new Vector3().setFromMatrixPosition(p.pieces[0].matrix);
    expect(end(after).distanceTo(end(before))).toBeGreaterThan(1);
  });

  it('changes nothing and says how far is left when the ends are too far apart', () => {
    const far = closeLoop(opened(8, 6), 0, 0.01);
    expect(far.ok).toBe(false);
    if (far.ok) return;
    expect(far.reason).toBe('too-far');
    expect(far.angle).toBeGreaterThan(CLOSE_LOOP_ANGLE);
  });

  it('says when there are not exactly two open ends', () => {
    const r = closeLoop(opened(4, 0), 0, 0.01);
    expect(r).toMatchObject({ ok: false, reason: 'no-ends' });
  });
});
