import { Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyMagnet,
  findMagnet,
  groupCount,
  joinableNear,
  joinPorts,
  layoutCourse,
  moveGroup,
  movingGroup,
  setPose,
  splitJoint,
  tidyCuts,
  type Course,
} from './course';
import { facingError } from './geometry';
import { basicOval, chain } from './presets';

const shift = (x: number, y: number, z: number) => new Matrix4().makeTranslation(x, y, z);
const pos = (c: Course, i: number) => layoutCourse(c).pieces[i].matrix.elements.slice(12, 15);
const group = (c: Course, i: number, alone = false) => movingGroup(layoutCourse(c), i, alone);

describe('groups', () => {
  it('puts every joined piece in one group, loop closures included', () => {
    const layout = layoutCourse(basicOval());
    expect(groupCount(layout)).toBe(1);
    expect(movingGroup(layout, 3).size).toBe(layout.pieces.length);
  });

  it('splits a chain in two at a split joint', () => {
    const c = splitJoint(chain(['straight', 'curve45', 'straight']), { piece: 0, port: 1 }, { piece: 1, port: 0 });
    expect(c.pieces[1]).toMatchObject({ free: [0, 1], pose: { pos: [0, 0, 0], rot: [0, 0, 0] } });
    const layout = layoutCourse(c);
    expect(groupCount(layout)).toBe(2);
    expect([...movingGroup(layout, 2)]).toEqual([1, 2]);
    // The split ports touch but stay open.
    expect(layout.open).toEqual(expect.arrayContaining([{ piece: 0, port: 1 }, { piece: 1, port: 0 }]));
  });

  it('opens a loop at a split joint without breaking it in two', () => {
    const ring = chain(Array(8).fill('curve45'));
    const c = splitJoint(ring, { piece: 0, port: 0 }, { piece: 7, port: 1 });
    const layout = layoutCourse(c);
    expect(layout.open).toHaveLength(2);
    expect(groupCount(layout)).toBe(1);
  });
});

describe('moving', () => {
  it('moves the whole group and keeps poses relative to their ports', () => {
    const c = splitJoint(chain(['straight', 'straight', 'straight']), { piece: 0, port: 1 }, { piece: 1, port: 0 });
    const moved = moveGroup(c, group(c, 2), shift(0, 0, 300));
    expect(moved.pieces[1]).toMatchObject({ free: [0, 1], pose: { pos: [0, 0, 300] } });
    expect(moved.pieces[2]).toEqual(c.pieces[2]);
    expect(pos(moved, 2)[2] - pos(c, 2)[2]).toBeCloseTo(300, 6);
    // Moved apart, the split mark has nothing left to keep apart.
    expect(tidyCuts(moved).cuts).toBeUndefined();
  });

  it('moves a whole loop when one of its pieces is dragged', () => {
    const ring = chain(Array(8).fill('curve45'));
    const moved = moveGroup(ring, group(ring, 5), shift(100, 0, 0));
    for (let i = 0; i < 8; i++) expect(pos(moved, i)[0] - pos(ring, i)[0]).toBeCloseTo(100, 4);
    expect(layoutCourse(moved).open).toEqual([]);
  });

  it('leaves the pieces joined to it in place when moved alone', () => {
    const c = chain(['straight', 'curve45', 'straight']);
    const next = moveGroup(c, group(c, 1, true), shift(0, 50, 0));
    for (const i of [0, 2]) for (let k = 0; k < 3; k++) expect(pos(next, i)[k]).toBeCloseTo(pos(c, i)[k], 1);
    expect(pos(next, 1)[1] - pos(c, 1)[1]).toBeCloseTo(50, 6);
    expect(next.pieces[2]).toMatchObject({ free: [1, 1] });
  });

  it('frees a connected piece when its pose is set', () => {
    const c = setPose(chain(['straight', 'straight']), 1, { pos: [0, 120, 0], rot: [0, 0, 0] });
    expect(c.pieces[1]).toMatchObject({ free: [0, 1] });
    expect(layoutCourse(c).pieces[1].ports[0].elements[13]).toBeCloseTo(120, 6);
  });
});

describe('magnet and joining', () => {
  const island = (): Course => {
    // A free island of two straights whose far end comes near the first piece's start.
    const c = chain(['straight']);
    c.pieces.push(
      { part: 'straight', port: 0, free: null, pose: { pos: [12, 0, -1100], rot: [0, 0, 0] } },
      { part: 'straight', port: 0, to: [1, 1] },
    );
    return c;
  };

  it('pulls the moving island so a port on it meets exactly', () => {
    const c = island();
    const g = group(c, 1);
    const magnet = findMagnet(c, g);
    expect(magnet).toEqual({ moving: { piece: 2, port: 1 }, fixed: { piece: 0, port: 0 } });
    const after = layoutCourse(applyMagnet(c, g, magnet!));
    const err = facingError(after.pieces[2].ports[1], after.pieces[0].ports[0]);
    expect(err.distance).toBeLessThan(0.2);
    expect(err.angle).toBeLessThan(0.2);
    expect(groupCount(after)).toBe(1);
  });

  it('ignores ports too far apart', () => {
    const c = chain(['straight', 'straight']);
    const split = splitJoint(c, { piece: 0, port: 1 }, { piece: 1, port: 0 });
    const far = moveGroup(split, group(split, 1), shift(0, 0, 200));
    expect(findMagnet(far, group(far, 1))).toBeNull();
  });

  it('joins split ports again', () => {
    const split = splitJoint(chain(['straight', 'straight']), { piece: 0, port: 1 }, { piece: 1, port: 0 });
    const layout = layoutCourse(split);
    expect(joinableNear(layout, { piece: 0, port: 1 })).toEqual({ piece: 1, port: 0 });
    const joined = joinPorts(split, { piece: 0, port: 1 }, { piece: 1, port: 0 });
    expect(joined.cuts).toBeUndefined();
    expect(groupCount(layoutCourse(joined))).toBe(1);
  });

  it('pulls a nearby island in when joining', () => {
    const c = island();
    const joined = layoutCourse(joinPorts(c, { piece: 0, port: 0 }, { piece: 2, port: 1 }));
    expect(facingError(joined.pieces[2].ports[1], joined.pieces[0].ports[0]).distance).toBeLessThan(0.2);
    expect(groupCount(joined)).toBe(1);
  });
});
