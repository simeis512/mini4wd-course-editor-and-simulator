import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { addAttachment, attachmentHeight, attachmentShape, moveAttachment, offsetWithin, removeAttachment, sideLimit } from './attachments';
import { getAttachment, laneOffset } from './catalog';
import { emptyCourse, layoutCourse, validateCourse } from './course';
import { addPiece, deletePiece, setLength } from './edit';

/** Two straights in a row. */
function straights() {
  const c = addPiece(emptyCourse(), 'straight', null);
  return addPiece(c, 'straight', { piece: 0, port: 1 });
}

describe('washboards (spec 4, #17)', () => {
  it('goes on the middle lane halfway along by default', () => {
    const c = addAttachment(straights(), 'washboard-5', 1);
    // Along the left fence of the lane, as the manual lays it.
    expect(c.attachments).toEqual([{ kind: 'washboard-5', piece: 1, lane: 1, offset: 270, side: -33 }]);
    expect(layoutCourse(c).attachments).toEqual(c.attachments);
  });

  it('lies on its lane against the fence, its top climbing to the thick end', () => {
    const c = addAttachment(straights(), 'washboard-10', 0, 0, 100);
    const shape = attachmentShape(layoutCourse(c).pieces[0], c.attachments![0]);
    const first = new Vector3().setFromMatrixPosition(shape.frames[0]);
    const last = new Vector3().setFromMatrixPosition(shape.frames[shape.frames.length - 1]);
    // Lane 0 is on the left (+X) looking along the centreline; the board 30mm further left.
    expect(first.x).toBeCloseTo(-laneOffset(0) + 30);
    expect(first.z).toBeCloseTo(40);
    expect(last.z).toBeCloseTo(160);
    expect(shape.half).toBe(27.5);
    // Thin at the start end, thickest just before the far tab.
    expect(shape.tops[0]).toBe(1);
    expect(shape.tops[shape.edges[2]]).toBeCloseTo(10);
    expect(shape.tops[shape.tops.length - 1]).toBe(1);
    const def = getAttachment('washboard-10');
    expect(attachmentHeight(def, 5)).toBe(1);
    expect(attachmentHeight(def, 20)).toBeCloseTo(5);
    expect(attachmentHeight(def, 65)).toBeCloseTo(7.5);
    expect(attachmentHeight(def, 110)).toBeCloseTo(10);
    expect(attachmentHeight(def, 115)).toBe(1);
  });

  it('turns round', () => {
    const c = moveAttachment(addAttachment(straights(), 'washboard-5', 0), 0, { reverse: true });
    expect(c.attachments![0].reverse).toBe(true);
    const shape = attachmentShape(layoutCourse(c).pieces[0], c.attachments![0]);
    // The thick end now faces the start of the centreline.
    expect(shape.edges[2]).toBeLessThan(shape.edges[0]);
    expect(shape.tops[shape.edges[2]]).toBeCloseTo(5);
    expect(moveAttachment(c, 0, { reverse: false }).attachments![0]).not.toHaveProperty('reverse');
  });

  it('stays between the fences', () => {
    let c = addAttachment(straights(), 'washboard-5', 0);
    c = moveAttachment(c, 0, { side: 999 });
    expect(c.attachments![0].side).toBe(sideLimit('washboard-5'));
    expect(moveAttachment(c, 0, { side: 0.4 }).attachments![0].side).toBe(0);
  });

  it('stays on the road when placed past its end or the piece gets shorter', () => {
    let c = addPiece(emptyCourse(), 'free-straight', null);
    c = setLength(c, 0, 540);
    c = addAttachment(c, 'washboard-5', 0, 1, 500);
    expect(offsetWithin(layoutCourse(c).pieces[0], c.attachments![0])).toBe(480);
    c = setLength(c, 0, 100);
    expect(offsetWithin(layoutCourse(c).pieces[0], c.attachments![0])).toBe(50);
  });

  it('moves and goes', () => {
    let c = addAttachment(straights(), 'washboard-5', 1);
    c = moveAttachment(c, 0, { lane: 2, offset: 99.6 });
    expect(c.attachments![0]).toMatchObject({ lane: 2, offset: 100 });
    // Not a lane of the piece.
    expect(moveAttachment(c, 0, { lane: 5 }).attachments![0].lane).toBe(2);
    expect(removeAttachment(c, 0)).not.toHaveProperty('attachments');
  });

  it('goes with its piece and follows the renumbering', () => {
    let c = addAttachment(straights(), 'washboard-5', 0);
    c = addAttachment(c, 'washboard-10', 1);
    const next = deletePiece(c, 0);
    expect(next.attachments).toEqual([{ kind: 'washboard-10', piece: 0, lane: 1, offset: 270, side: -30 }]);
    expect(deletePiece(next, 0)).not.toHaveProperty('attachments');
  });

  it('is checked against the pieces', () => {
    const c = straights();
    expect(() => validateCourse({ ...c, attachments: [{ kind: 'washboard-5', piece: 5, lane: 0, offset: 0, side: 0 }] })).toThrow();
    expect(() => validateCourse({ ...c, attachments: [{ kind: 'washboard-5', piece: 0, lane: 3, offset: 0, side: 0 }] })).toThrow();
    expect(() => validateCourse({ ...c, attachments: [{ kind: 'no-such', piece: 0, lane: 0, offset: 0, side: 0 }] })).toThrow();
  });
});
