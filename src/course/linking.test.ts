import { describe, expect, it } from 'vitest';
import { closeLoop } from './close-loop';
import { decodeCourse } from './codec';
import { anchorFrame, layoutCourse, type Course, type PieceRec } from './course';
import { freeRec } from './edit';
import { exactPose } from './geometry';
import { splitJoint } from './joining';
import { linkJoined } from './linking';
import { basicOval, chain } from './presets';

/** Piece `i` of `course` placed on its own in the world, exactly where it is. */
const onItsOwn = (course: Course, i: number, rec: PieceRec = course.pieces[i]) =>
  freeRec(rec, null, exactPose(anchorFrame(layoutCourse(course), i)));

const where = (course: Course, i: number) => layoutCourse(course).pieces[i].matrix.elements.slice(12, 15);

describe('linkJoined (#131)', () => {
  it('leaves a course whose meeting ports are already links as it is', () => {
    const oval = basicOval();
    const { course, order } = linkJoined(oval);
    expect(course).toBe(oval);
    expect(order).toEqual(oval.pieces.map((_, i) => i));
  });

  it('links a piece placed on its own in the world where its ports meet others', () => {
    const ring = chain(Array(8).fill('curve45'));
    const loose = { ...ring, pieces: ring.pieces.map((rec, i) => (i === 4 ? onItsOwn(ring, 4) : rec)) };
    expect(layoutCourse(loose).closures).toHaveLength(2);
    const { course, order } = linkJoined(loose);
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(course.pieces[4]).toEqual({ part: 'curve45', port: 0, to: [3, 1] });
    const layout = layoutCourse(course);
    expect(layout.closures).toHaveLength(1);
    expect(layout.open).toEqual([]);
  });

  it('turns stored links round and puts pieces in another order where it has to', () => {
    // Pieces 4-7 of a ring hang off the 6th piece of it, placed on its own and stored before the rest.
    const ring = chain(Array(8).fill('curve45'));
    const pieces: PieceRec[] = [
      ...ring.pieces.slice(0, 4),
      onItsOwn(ring, 6),
      { part: 'curve45', port: 1, to: [4, 0] },
      { part: 'curve45', port: 1, to: [5, 0] },
      { part: 'curve45', port: 0, to: [4, 1] },
    ];
    const loose: Course = { ...ring, pieces };
    expect(layoutCourse(loose).closures).toHaveLength(2);
    const { course, order } = linkJoined(loose);
    // The piece placed on its own now hangs off the one before it in the ring, so it comes after it.
    expect(order).toEqual([0, 1, 2, 3, 6, 5, 4, 7]);
    expect(course.pieces[4]).toEqual({ part: 'curve45', port: 0, to: [3, 1] });
    expect(course.pieces[5]).toEqual({ part: 'curve45', port: 0, to: [4, 1] });
    expect(course.pieces[6]).toEqual({ part: 'curve45', port: 0, to: [5, 1] });
    expect(course.pieces[7]).toEqual({ part: 'curve45', port: 0, to: [6, 1] });
    expect(layoutCourse(course).closures).toHaveLength(1);
    order.forEach((old, k) => where(course, k).forEach((v, a) => expect(v).toBeCloseTo(where(loose, old)[a], 6)));
  });

  it('keeps the bend of a link it turns round', () => {
    // A, B, C in a row with C bent up 2°; then C placed on its own and B hung off it, stored before B.
    const truth = chain(['straight', 'straight', 'straight']);
    (truth.pieces[2] as { bend?: object }).bend = { pitch: 2 };
    const loose = [2, -2]
      .map((pitch): Course => ({ ...truth, pieces: [truth.pieces[0], onItsOwn(truth, 2), { part: 'straight', port: 1, to: [1, 0], bend: { pitch } }] }))
      .find((c) => layoutCourse(c).closures.length === 1)!;
    const { course, order } = linkJoined(loose);
    expect(order).toEqual([0, 2, 1]);
    expect(course.pieces[1]).toEqual({ part: 'straight', port: 0, to: [0, 1] });
    expect(course.pieces[2]).toMatchObject({ part: 'straight', port: 0, to: [1, 1], bend: { pitch: 2 } });
    for (const i of [1, 2]) where(course, i).forEach((v, a) => expect(v).toBeCloseTo(where(truth, i)[a], 4));
  });

  it('moves the start, timer, washboards and marks along with their pieces', () => {
    const ring = chain(Array(8).fill('curve45'));
    const pieces: PieceRec[] = [...ring.pieces.slice(0, 4), onItsOwn(ring, 6), { part: 'curve45', port: 1, to: [4, 0] }, { part: 'curve45', port: 1, to: [5, 0] }, { part: 'curve45', port: 0, to: [4, 1] }];
    const loose: Course = {
      ...ring,
      pieces,
      start: { piece: 4, offset: 10 },
      timer: { piece: 5, offset: 20, side: 'left' },
      attachments: [{ kind: 'washboard', piece: 6, lane: 0, offset: 50, side: 0 }],
      intended: [[7, 1]],
    };
    const { course } = linkJoined(loose);
    expect(course.start).toEqual({ piece: 6, offset: 10 });
    expect(course.timer).toEqual({ piece: 5, offset: 20, side: 'left' });
    expect(course.attachments![0].piece).toBe(4);
    expect(course.intended).toEqual([[7, 1]]);
  });

  it('keeps a split joint apart', () => {
    const ring = chain(Array(8).fill('curve45'));
    const split = splitJoint(ring, { piece: 3, port: 1 }, { piece: 4, port: 0 });
    const { course, order } = linkJoined(split);
    // The ring is now a row from the first piece both ways round, still open at the split.
    expect(order).toEqual([0, 1, 2, 3, 7, 6, 5, 4]);
    const layout = layoutCourse(course);
    expect(layout.closures).toEqual([]);
    expect(layout.split).toEqual([{ piece: 3, port: 1 }, { piece: 7, port: 0 }]);
    order.forEach((old, k) => where(course, k).forEach((v, a) => expect(v).toBeCloseTo(where(split, old)[a], 6)));
  });

  it("leaves one closure per loop on the owner's course built in parts (owner 2026-10-28)", async () => {
    // A spiral up, a raised run and a slope down; the far part is placed in the world and meets the rest at closures.
    const url = '7.JY25DoFhFETPfPZ9X37Lj8IWhYhH8AqeS6cW0ak8AK030Wn1MjQnJ5mZe8UKFAk9Ay8pkthxDIoU2HKyJNhwsSTZcrak2PwlzfofZX4RObJ8AoicEHmjIImiJJVsZSRVbFUkara60XC5aWvZ2kbHs64R-WjPi76DgRR4P8I1HO86DMgoQSy47YGkiP1l6OHY9YnXsW-PjKmDmW3u3sK25As';
    const loose = await decodeCourse(url);
    const before = layoutCourse(loose);
    const { course } = linkJoined(loose);
    const after = layoutCourse(course);
    expect(after.joints).toHaveLength(before.joints.length);
    expect(after.open).toHaveLength(before.open.length);
    // It is open, so as many closures as loops: none, where it had some.
    expect(before.closures.length).toBeGreaterThan(0);
    expect(after.closures).toHaveLength(after.joints.length - after.pieces.length + 1);
    expect(course.pieces.filter((rec) => !('to' in rec))).toHaveLength(1);
    // Closing it by force now bends it through stored links only.
    const closed = closeLoop(course, 0, 0.01);
    if (!closed.ok) throw new Error(`did not close: ${JSON.stringify(closed)}`);
    expect(layoutCourse(closed.course).open).toEqual([]);
  });
});
