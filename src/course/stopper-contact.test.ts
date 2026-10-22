import { Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';
import { emptyCourse, layoutCourse, type CatchBox, type Course, type Hose, type Stopper } from './course';
import { addPiece, moveGroup } from './edit';
import { stopperContacts } from './stopper-contact';
import { placeTimer, timerBlocks } from './timing';

/** A straight along + Z from the origin, 540mm long and about 365mm wide, raised `y` mm. */
function straight(y = 0): Course {
  const c = addPiece(emptyCourse(), 'straight', null);
  return y ? moveGroup(c, new Set([0]), new Matrix4().makeTranslation(0, y, 0)) : c;
}

/** A small box (300 wide, 180 along when on its side, 220 high) at (x, z). */
const box = (x: number, z: number, upright = false): CatchBox => ({ kind: 'box', size: 0, x, z, yaw: 0, ...(upright ? { upright } : {}) });
const hose = (...points: [number, number][]): Hose => ({ kind: 'hose', points, color: 0 });

const contacts = (c: Course, ...stoppers: Stopper[]) => stopperContacts(layoutCourse({ ...c, stoppers })).map((k) => ({ stopper: k.stopper, other: k.other }));

describe('stopperContacts (#53)', () => {
  it('finds nothing without stoppers, or with them clear of everything', () => {
    expect(stopperContacts(layoutCourse(straight()))).toEqual([]);
    expect(contacts(straight(), box(600, 270), hose([-300, -100], [-300, 600]))).toEqual([]);
  });

  it('finds a box or a hose on the course', () => {
    expect(contacts(straight(), box(300, 270))).toEqual([{ stopper: 0, other: { kind: 'piece', piece: 0 } }]);
    expect(contacts(straight(), hose([-400, 270], [400, 270]))).toEqual([{ stopper: 0, other: { kind: 'piece', piece: 0 } }]);
  });

  it('counts the hose as thick as it is', () => {
    // The outer fence's outside face is about 182mm from the middle; the hose is 15mm across.
    expect(contacts(straight(), hose([-200, -100], [-200, 600]))).toEqual([]);
    expect(contacts(straight(), hose([-188, -100], [-188, 600]))).toHaveLength(1);
  });

  it('lets a box under raised road be, as long as it is lower', () => {
    expect(contacts(straight(400), box(0, 270))).toEqual([]);
    expect(contacts(straight(200), box(0, 270))).toEqual([{ stopper: 0, other: { kind: 'piece', piece: 0 } }]);
  });

  it('finds a hose across the legs of a support', () => {
    // A 540mm straight raised 400mm stands on two supports, a quarter of the way in from each end.
    expect(contacts(straight(400), hose([-400, 135], [400, 135]))).toEqual([{ stopper: 0, other: { kind: 'support', piece: 0 } }]);
  });

  it('finds a box against the lap timer', () => {
    const c = placeTimer(straight(), { piece: 0, offset: 270, side: 'left' });
    const body = timerBlocks(layoutCourse(c), c.timer!)[0].frame.elements;
    // Outside the left fence (+ X), where the timer's body stands.
    const found = contacts(c, box(body[12] + 140, body[14]));
    expect(found).toEqual([{ stopper: 0, other: { kind: 'timer' } }]);
  });

  it('finds stoppers on each other, but not ones only touching', () => {
    expect(contacts(emptyCourse(), box(0, 1000), box(200, 1000))).toEqual([{ stopper: 0, other: { kind: 'stopper', index: 1 } }]);
    expect(contacts(emptyCourse(), box(0, 1000), box(300, 1000))).toEqual([]);
    expect(contacts(emptyCourse(), box(0, 1000), hose([-500, 1000], [500, 1000]))).toEqual([{ stopper: 0, other: { kind: 'stopper', index: 1 } }]);
  });
});
