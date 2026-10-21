import { describe, expect, it } from 'vitest';
import { findClashes, MACHINE_CLEARANCE } from './clash';
import { layoutCourse, type Course, type PieceRec } from './course';
import { LEVEL_HEIGHT } from './catalog';
import { basicOval, chain } from './presets';

/** A straight on its own, its start port at (x, y, z) heading along `yaw`. */
function straight(x: number, y: number, z: number, yaw = 0): PieceRec {
  return { part: 'straight', port: 0, free: null, pose: { pos: [x, y, z], rot: [yaw, 0, 0] } };
}

/** Two straights, the second crossing over the first's middle square to it, `height` above. */
function crossing(height: number): Course {
  return { v: 1, catalog: 1, pieces: [straight(0, 0, 0), straight(-270, height, 270, 90)] };
}

describe('findClashes', () => {
  it('finds nothing wrong with the basic oval and its lane change', () => {
    expect(findClashes(layoutCourse(basicOval()))).toEqual([]);
  });

  it('finds two pieces crossing on the same level (#14)', () => {
    const clashes = findClashes(layoutCourse(crossing(0)));
    expect(clashes).toHaveLength(1);
    expect(clashes[0]).toMatchObject({ kind: 'interference', pieces: [0, 1] });
  });

  it('finds road crossing just above the fences of another (#14)', () => {
    expect(findClashes(layoutCourse(crossing(40)))[0]?.kind).toBe('interference');
  });

  it('warns of too little room under a crossing (#15)', () => {
    const clashes = findClashes(layoutCourse(crossing(70)));
    expect(clashes).toHaveLength(1);
    const c = clashes[0];
    expect(c.kind).toBe('clearance');
    if (c.kind !== 'clearance') return;
    expect([c.lower, c.upper]).toEqual([0, 1]);
    // From the lower road up to the underside of the upper one.
    expect(c.gap).toBeCloseTo(67, 6);
    expect(c.at.y).toBeCloseTo(0, 6);
  });

  it('allows a crossing one level up', () => {
    expect(LEVEL_HEIGHT - 3).toBeGreaterThanOrEqual(MACHINE_CLEARANCE);
    expect(findClashes(layoutCourse(crossing(LEVEL_HEIGHT)))).toEqual([]);
  });

  it('lets pieces side by side touch, but not overlap', () => {
    const touching: Course = { v: 1, catalog: 1, pieces: [straight(0, 0, 0), straight(365, 0, 0)] };
    expect(findClashes(layoutCourse(touching))).toEqual([]);
    const overlapping: Course = { v: 1, catalog: 1, pieces: [straight(0, 0, 0), straight(330, 0, 0)] };
    expect(findClashes(layoutCourse(overlapping))).toHaveLength(1);
  });

  it('does not count joined pieces meeting at their joint', () => {
    expect(findClashes(layoutCourse(chain(['straight', 'curve45', 'curve45', 'wave', 'slope', 'straight'])))).toEqual([]);
  });

  it('finds a ring of curves closing back over its own start', () => {
    // Nine curves come round past the start and run over the first piece.
    expect(findClashes(layoutCourse(chain(Array(9).fill('curve45')))).map((c) => c.kind)).toEqual(['interference']);
  });
});
