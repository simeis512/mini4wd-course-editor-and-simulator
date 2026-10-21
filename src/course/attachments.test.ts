import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { addAttachment, attachmentShape, moveAttachment, offsetWithin, removeAttachment } from './attachments';
import { laneOffset } from './catalog';
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
    expect(c.attachments).toEqual([{ kind: 'washboard-5', piece: 1, lane: 1, offset: 270 }]);
    expect(layoutCourse(c).attachments).toEqual(c.attachments);
  });

  it('lies on its lane, with bumps as high as the board', () => {
    const c = addAttachment(straights(), 'washboard-10', 0, 0, 100);
    const layout = layoutCourse(c);
    const shape = attachmentShape(layout.pieces[0], c.attachments![0]);
    const first = new Vector3().setFromMatrixPosition(shape.frames[0]);
    const last = new Vector3().setFromMatrixPosition(shape.frames[shape.frames.length - 1]);
    // Lane 0 is on the left (+X) looking along the centreline.
    expect(first.x).toBeCloseTo(-laneOffset(0));
    expect(first.z).toBeCloseTo(40);
    expect(last.z).toBeCloseTo(160);
    expect(Math.max(...shape.tops)).toBeCloseTo(10, 0);
    expect(shape.tops[0]).toBeCloseTo(0);
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
    expect(next.attachments).toEqual([{ kind: 'washboard-10', piece: 0, lane: 1, offset: 270 }]);
    expect(deletePiece(next, 0)).not.toHaveProperty('attachments');
  });

  it('is checked against the pieces', () => {
    const c = straights();
    expect(() => validateCourse({ ...c, attachments: [{ kind: 'washboard-5', piece: 5, lane: 0, offset: 0 }] })).toThrow();
    expect(() => validateCourse({ ...c, attachments: [{ kind: 'washboard-5', piece: 0, lane: 3, offset: 0 }] })).toThrow();
    expect(() => validateCourse({ ...c, attachments: [{ kind: 'no-such', piece: 0, lane: 0, offset: 0 }] })).toThrow();
  });
});
