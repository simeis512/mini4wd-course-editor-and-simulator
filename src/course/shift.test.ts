import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { getPart } from './catalog';
import { compatible, jointLanes, jointOffset, layoutCourse, type Course } from './course';
import { jointShift, markIntended, setShift } from './edit';
import { splitJoint } from './joining';
import { checkLaps } from './laps';
import { basicOval, chain } from './presets';

// Joints shifted sideways by whole lanes, and bridge approaches joined to ordinary parts (#60).

const pos = (layout: ReturnType<typeof layoutCourse>, piece: number) => new Vector3().setFromMatrixPosition(layout.pieces[piece].matrix);
const straight = getPart('straight');
const approach = getPart('bridge-approach');

describe('jointOffset', () => {
  it('moves by whole lanes, and half a lane between odd and even lane counts', () => {
    expect(jointOffset(straight.ports[1], straight.ports[0], 1)).toBe(120);
    expect(jointOffset(straight.ports[1], straight.ports[0], -1)).toBe(-120);
    expect(jointOffset(approach.ports[1], straight.ports[0])).toBe(60);
  });
});

describe('shifted joints', () => {
  it('moves the next piece a lane to the right and lines up the lanes that still meet', () => {
    const c = setShift(chain(['straight', 'straight']), { piece: 0, port: 1 }, { piece: 1, port: 0 }, 1);
    expect(c.pieces[1]).toMatchObject({ shift: 1 });
    // Right is − X.
    expect(pos(layoutCourse(c), 1).x).toBeCloseTo(-120, 9);
    expect(jointLanes(straight, 1, straight, 0, 1)).toEqual([
      [1, 0],
      [2, 1],
    ]);
    // Seen from the other side the shift is the same.
    expect(jointLanes(straight, 0, straight, 1, 1)).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(jointShift(c, { piece: 0, port: 1 }, { piece: 1, port: 0 })).toBe(1);
    // The lane left over on each side ends at the joint.
    expect(layoutCourse(c).deadEnds).toEqual([
      { piece: 0, port: 1, lanes: [0], intended: false },
      { piece: 1, port: 0, lanes: [2], intended: false },
    ]);
    const marked = markIntended(c, { piece: 1, port: 0 }, true);
    expect(layoutCourse(marked).deadEnds[1].intended).toBe(true);
  });

  it('leaves no lane ending in the basic oval', () => {
    expect(layoutCourse(basicOval()).deadEnds).toEqual([]);
  });

  it('shifts as far as one lane still meeting, and no further', () => {
    const c = chain(['straight', 'straight']);
    const two = setShift(c, { piece: 0, port: 1 }, { piece: 1, port: 0 }, 2);
    expect(two.pieces[1]).toMatchObject({ shift: 2 });
    expect(pos(layoutCourse(two), 1).x).toBeCloseTo(-240, 9);
    expect(jointLanes(straight, 1, straight, 0, 2)).toEqual([[2, 0]]);
    expect(setShift(c, { piece: 0, port: 1 }, { piece: 1, port: 0 }, -2).pieces[1]).toMatchObject({ shift: -2 });
    expect(setShift(c, { piece: 0, port: 1 }, { piece: 1, port: 0 }, 3)).toBe(c);
    expect(setShift(c, { piece: 0, port: 1 }, { piece: 1, port: 0 }, -3)).toBe(c);
    // The approach's one-lane upper end meets a straight's middle lane, or an edge lane a lane over; two lanes over is off the road.
    expect(compatible(approach, 2, straight, 0)).toBe(true);
    expect(compatible(approach, 2, straight, 0, 1)).toBe(true);
    expect(compatible(approach, 2, straight, 0, 2)).toBe(false);
  });

  it('keeps a shifted piece where it is when the joint is split', () => {
    const c = setShift(chain(['straight', 'straight']), { piece: 0, port: 1 }, { piece: 1, port: 0 }, -1);
    const split = splitJoint(c, { piece: 0, port: 1 }, { piece: 1, port: 0 });
    expect(pos(layoutCourse(split), 1).distanceTo(pos(layoutCourse(c), 1))).toBeLessThan(0.1);
  });

  it('closes a ring that was shifted once, with the other shift at the loop end', () => {
    const c = setShift(chain(Array(8).fill('curve45')), { piece: 3, port: 1 }, { piece: 4, port: 0 }, 1);
    const layout = layoutCourse(c);
    expect(layout.open).toEqual([]);
    expect(Math.abs(layout.closures[0].shift)).toBe(1);
    // Each shift sends one lane off the road, so not every lane comes round.
    const laps = checkLaps(layout)!;
    expect(laps.laps.some((l) => l.broken !== null)).toBe(true);
  });
});

describe('bridge approach on ordinary parts', () => {
  it('runs the lower two lanes on into a straight, which sticks out on the right', () => {
    const c: Course = { v: 1, catalog: 1, pieces: [{ part: 'bridge-approach', at: 'origin' }, { part: 'straight', port: 0, to: [0, 1] }] };
    const layout = layoutCourse(c);
    expect(layout.problems).toEqual([]);
    // The straight carries on along the approach's own centreline.
    expect(pos(layout, 1).x).toBeCloseTo(0, 6);
    expect(jointLanes(approach, 1, straight, 0)).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it('makes a one-lane jump between straights: the right lane breaks off at the top', () => {
    const c: Course = {
      v: 1,
      catalog: 1,
      pieces: [
        { part: 'straight', at: 'origin' },
        { part: 'bridge-approach', port: 0, to: [0, 1] },
        { part: 'straight', port: 0, to: [1, 1] },
      ],
    };
    const laps = checkLaps(layoutCourse(c))!;
    const [left, middle, right] = laps.laps;
    expect(left.broken).toEqual({ piece: 2, port: 1 });
    expect(middle.broken).toEqual({ piece: 2, port: 1 });
    expect(right.broken).toEqual({ piece: 1, port: 2 });
  });
});

describe('under-bridge on its own', () => {
  const under = getPart('under-bridge');

  it('is the lane change centre without its bridge', () => {
    const centre = getPart('lane-change-center');
    expect(under.segments).toEqual(centre.segments);
    expect(under.tracks).toBeUndefined();
    expect(under.ports.map((p) => p.anchor)).toEqual(centre.ports.slice(0, 2).map((p) => p.anchor));
  });

  it('joins ordinary parts and bridge approaches, moving both lanes one over', () => {
    expect(compatible(straight, 1, under, 0)).toBe(true);
    expect(compatible(approach, 1, under, 0)).toBe(true);
    const c: Course = {
      v: 1,
      catalog: 1,
      pieces: [
        { part: 'straight', at: 'origin' },
        { part: 'under-bridge', port: 0, to: [0, 1], shift: -1 },
        { part: 'straight', port: 0, to: [1, 1], shift: -1 },
      ],
    };
    const layout = layoutCourse(c);
    expect(layout.problems).toEqual([]);
    // On the left two lanes it carries them over to the middle and right, so the
    // next straight, shifted back a lane, lines up with the first.
    expect(pos(layout, 2).x).toBeCloseTo(0, 6);
    expect(jointLanes(straight, 1, under, 0, -1)).toEqual([
      [0, 0],
      [1, 1],
    ]);
    expect(jointLanes(under, 1, straight, 0, -1)).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });
});
