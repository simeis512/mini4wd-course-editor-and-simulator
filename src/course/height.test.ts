import { describe, expect, it } from 'vitest';
import { GLOBAL_SPEC } from './catalog';
import { emptyCourse, layoutCourse, type Course } from './course';
import { addPiece, setPose } from './edit';
import { atLevel, pieceHeights, SUPPORT_MIN_GAP, supports } from './height';
import { basicOval, chain } from './presets';

/** A lone straight with its start port `y` mm off the floor. */
const raised = (y: number, course: Course = emptyCourse()): Course => {
  const c = addPiece(course, 'straight', null);
  return setPose(c, c.pieces.length - 1, { pos: [0, y, 0], rot: [0, 0, 0] });
};

describe('piece heights', () => {
  it('reads the lowest and highest road of each piece', () => {
    const layout = layoutCourse(chain(['straight', 'slope', 'straight']));
    const [flat, slope, top] = pieceHeights(layout);
    expect(flat).toEqual([0, 0]);
    expect(slope[0]).toBeCloseTo(0);
    expect(slope[1]).toBeCloseTo(110);
    expect(top[0]).toBeCloseTo(110);
  });

  it('keeps pieces that reach the filter height', () => {
    expect(atLevel([0, 110], 100)).toBe(true);
    expect(atLevel([0, 0], 100)).toBe(false);
    expect(atLevel([100, 100], 100)).toBe(true);
    expect(atLevel([0, 0], 0)).toBe(true);
  });
});

describe('supports', () => {
  it('puts none under road on the floor', () => {
    expect(supports(layoutCourse(chain(['straight', 'wave', 'curve45'])))).toEqual([]);
  });

  it('spaces stands evenly under raised road, away from the joints', () => {
    const s = supports(layoutCourse(raised(100)));
    expect(s).toHaveLength(2);
    for (const st of s) {
      expect(st.left.y).toBeCloseTo(100 - GLOBAL_SPEC.roadThickness);
      expect(st.right.y).toBeCloseTo(100 - GLOBAL_SPEC.roadThickness);
      expect(Math.abs(st.along.z)).toBeCloseTo(1);
    }
    const zs = s.map((st) => st.left.z).sort((a, b) => a - b);
    expect(zs[0]).toBeGreaterThan(50);
    expect(zs[1]).toBeLessThan(490);
  });

  it('leaves out stands that would barely clear the floor', () => {
    expect(supports(layoutCourse(raised(SUPPORT_MIN_GAP)))).toEqual([]);
  });

  it('only stands under the raised part of a slope', () => {
    const layout = layoutCourse(chain(['slope']));
    const s = supports(layout);
    expect(s.length).toBeGreaterThan(0);
    for (const st of s) expect(Math.max(st.left.y, st.right.y)).toBeGreaterThan(SUPPORT_MIN_GAP);
  });

  it('does not stand on road running underneath', () => {
    const below = addPiece(emptyCourse(), 'straight', null);
    expect(supports(layoutCourse(raised(150, below)))).toEqual([]);
  });

  it('stands the ramps on the floor and lets the bridge span the lanes below', () => {
    const layout = layoutCourse(basicOval());
    const s = supports(layout);
    const ramps = layout.pieces.flatMap((pc, i) => (pc.part.id === 'bridge-approach' ? [i] : []));
    for (const i of ramps) expect(s.some((st) => st.piece === i)).toBe(true);
    // No stand under the high middle of the bridge, where the lower lanes run.
    // The bridge itself has only the set's own support (below).
    const centre = layout.pieces.findIndex((pc) => pc.part.id === 'lane-change-center');
    expect(s.filter((st) => st.piece === centre)).toHaveLength(1);
  });

  it('stands the lane change support across the middle, outside the lower lanes', () => {
    const layout = layoutCourse(chain(['bridge-approach', 'lane-change-center']));
    const [st] = supports(layout).filter((st) => st.piece === 1);
    const pc = layout.pieces[1];
    expect(st.left.y).toBeCloseTo(97);
    expect(st.right.y).toBeCloseTo(97);
    // Across the part at its middle, just wider than the two lower lanes there.
    const toLocal = pc.matrix.clone().invert();
    const [l, r] = [st.left, st.right].map((p) => p.clone().applyMatrix4(toLocal));
    expect(l.z).toBeCloseTo(270);
    expect(r.z).toBeCloseTo(270);
    expect(Math.abs(l.x - r.x)).toBeGreaterThan(2 * (GLOBAL_SPEC.lanePitch + GLOBAL_SPEC.fenceThickness / 2));
  });
});
