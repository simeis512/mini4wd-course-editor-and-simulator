import { Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  anchorFrame,
  applyMagnet,
  findMagnet,
  layoutCourse,
  movePiece,
  movingGroup,
  placementOf,
  setPose,
} from './course';
import { facingError } from './geometry';
import { chain } from './presets';

const shift = (x: number, y: number, z: number) => new Matrix4().makeTranslation(x, y, z);

describe('moving a piece', () => {
  it('keeps the pose relative to the port it hung off', () => {
    const c = chain(['straight', 'straight']);
    const layout = layoutCourse(c);
    const moved = movePiece(c, 1, shift(0, 0, 300).multiply(anchorFrame(layout, 1)));
    expect(moved.pieces[1]).toEqual({ part: 'straight', port: 0, free: [0, 1], pose: { pos: [0, 0, 300], rot: [0, 0, 0] } });
    // The gap stays when the piece before it changes length.
    const longer = structuredClone(moved);
    longer.pieces[0].part = 'curve45';
    const a = layoutCourse(longer);
    expect(facingError(a.pieces[0].ports[1], a.pieces[1].ports[0]).distance).toBeCloseTo(300, 6);
  });

  it('carries the pieces hanging off it', () => {
    const c = chain(['straight', 'curve45', 'straight']);
    expect([...movingGroup(c, 1)]).toEqual([1, 2]);
    const before = layoutCourse(c);
    const moved = layoutCourse(movePiece(c, 1, shift(0, 50, 0).multiply(anchorFrame(before, 1))));
    expect(moved.pieces[2].matrix.elements[13] - before.pieces[2].matrix.elements[13]).toBeCloseTo(50, 6);
    expect(moved.connected.has('1:1')).toBe(true);
  });

  it('leaves the pieces hanging off it in place when moved alone', () => {
    const c = chain(['straight', 'curve45', 'straight']);
    const before = layoutCourse(c);
    const next = movePiece(c, 1, shift(0, 50, 0).multiply(anchorFrame(before, 1)), { alone: true });
    expect(next.pieces[2]).toMatchObject({ free: null });
    const after = layoutCourse(next);
    for (let k = 12; k < 15; k++) expect(after.pieces[2].matrix.elements[k]).toBeCloseTo(before.pieces[2].matrix.elements[k], 1);
  });

  it('snaps to 10 mm and 15° from the base port', () => {
    const c = chain(['straight', 'straight']);
    const target = new Matrix4().makeRotationY((22 * Math.PI) / 180).premultiply(shift(13, 0, 296)).premultiply(anchorFrame(layoutCourse(c), 1));
    const { pose } = placementOf(movePiece(c, 1, target, { snap: true }).pieces[1]);
    expect(pose.pos).toEqual([10, 0, 300]);
    expect(pose.rot).toEqual([15, 0, 0]);
  });

  it('frees a connected piece when its pose is set', () => {
    const c = setPose(chain(['straight', 'straight']), 1, { pos: [0, 120, 0], rot: [0, 0, 0] });
    expect(c.pieces[1]).toMatchObject({ free: [0, 1] });
    expect(layoutCourse(c).pieces[1].ports[0].elements[13]).toBeCloseTo(120, 6);
  });
});

describe('magnet', () => {
  it('reconnects a piece dragged close to the port it came from', () => {
    const c = chain(['straight', 'straight']);
    const near = movePiece(c, 1, shift(15, 0, 20).multiply(anchorFrame(layoutCourse(c), 1)));
    const magnet = findMagnet(near, 1);
    expect(magnet).toEqual({ moving: { piece: 1, port: 0 }, fixed: { piece: 0, port: 1 } });
    expect(applyMagnet(near, 1, magnet!).pieces[1]).toEqual({ part: 'straight', port: 0, to: [0, 1] });
  });

  it('connects the dragged piece to an earlier open port', () => {
    const c = chain(['straight']);
    c.pieces.push({ part: 'straight', port: 0, free: null, pose: { pos: [12, 0, -560], rot: [0, 0, 0] } });
    const magnet = findMagnet(c, 1);
    expect(magnet).toEqual({ moving: { piece: 1, port: 1 }, fixed: { piece: 0, port: 0 } });
    expect(applyMagnet(c, 1, magnet!).pieces[1]).toEqual({ part: 'straight', port: 1, to: [0, 0] });
  });

  it('pulls a whole island so a port on it meets exactly', () => {
    // A free island of two straights whose far end comes near the first piece's start.
    const c = chain(['straight']);
    c.pieces.push(
      { part: 'straight', port: 0, free: null, pose: { pos: [12, 0, -1100], rot: [0, 0, 0] } },
      { part: 'straight', port: 0, to: [1, 1] },
    );
    const magnet = findMagnet(c, 1);
    expect(magnet).toEqual({ moving: { piece: 2, port: 1 }, fixed: { piece: 0, port: 0 } });
    const after = layoutCourse(applyMagnet(c, 1, magnet!));
    const err = facingError(after.pieces[2].ports[1], after.pieces[0].ports[0]);
    expect(err.distance).toBeLessThan(0.2);
    expect(err.angle).toBeLessThan(0.2);
    expect(after.closures).toHaveLength(1);
  });

  it('ignores ports too far apart', () => {
    const c = chain(['straight', 'straight']);
    const far = movePiece(c, 1, shift(0, 0, 200).multiply(anchorFrame(layoutCourse(c), 1)));
    expect(findMagnet(far, 1)).toBeNull();
  });
});
