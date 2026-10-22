import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { blockCorners } from './blocks';
import { GLOBAL_SPEC, laneOffset } from './catalog';
import { emptyCourse, layoutCourse, validateCourse } from './course';
import { addPiece, deletePiece, moveGroup } from './edit';
import { moveStart, nearestRoad, placeStart, placeTimer, removeStart, removeTimer, startStickers, TIMER, TIMER_GAP, timerBlocks, timerLane } from './timing';

/** Two straights in a row along + Z, 540mm each. */
function straights() {
  const c = addPiece(emptyCourse(), 'straight', null);
  return addPiece(c, 'straight', { piece: 0, port: 1 });
}

const centre = (corners: Vector3[]) => corners.reduce((s, p) => s.add(p), new Vector3()).divideScalar(corners.length);

describe('start line (#56)', () => {
  it('puts the timer just past the start the first time', () => {
    const c = placeStart(straights(), 1, 100);
    expect(c.start).toEqual({ piece: 1, offset: 100 });
    expect(c.timer).toEqual({ piece: 1, offset: 100 + TIMER_GAP, side: 'left' });
    // The timer then moves on its own (#56 決定事項).
    const moved = placeStart(placeTimer(c, { offset: 500 }), 0, 30);
    expect(moved.start).toEqual({ piece: 0, offset: 30 });
    expect(moved.timer?.offset).toBe(500);
    expect(layoutCourse(moved).start).toEqual(moved.start);
  });

  it('keeps to the road and the way machines set off', () => {
    const c = moveStart(placeStart(straights(), 0, 9999), { reverse: true });
    expect(c.start).toEqual({ piece: 0, offset: 540, reverse: true });
    expect(placeStart(removeTimer(c), 0, 300).timer?.offset).toBe(300 - TIMER_GAP);
    expect(moveStart(c, { reverse: false, offset: -5 }).start).toEqual({ piece: 0, offset: 0 });
    expect(removeStart(c).start).toBeUndefined();
    expect(removeStart(c).timer).toEqual(c.timer);
  });

  it('lays a START sticker on every lane, the arrow pointing the way machines go', () => {
    const c = placeStart(straights(), 1, 100);
    const stickers = startStickers(layoutCourse(c), c.start!);
    expect(stickers.map((s) => s.lane)).toEqual([0, 1, 2]);
    stickers.forEach((s) => {
      const mid = centre(s.corners);
      // + X is left; the piece starts 540mm along.
      expect(mid.x).toBeCloseTo(-laneOffset(s.lane));
      expect(mid.z).toBeCloseTo(640);
      expect(s.arrow[0].z).toBeGreaterThan(640);
    });
    const back = startStickers(layoutCourse(moveStart(c, { reverse: true })), { ...c.start!, reverse: true });
    expect(back[0].arrow[0].z).toBeLessThan(640);
  });

  it('follows its piece when the piece moves', () => {
    const c = placeStart(straights(), 1, 100);
    const moved = moveGroup(c, new Set([0, 1]), new Matrix4().makeTranslation(1000, 0, 0));
    expect(centre(startStickers(layoutCourse(moved), moved.start!)[1].corners).x).toBeCloseTo(1000);
  });
});

describe('lap timer (#56)', () => {
  it('stands outside the fence on its side and reaches over the lane there', () => {
    const c = placeTimer(straights(), { piece: 0, offset: 200, side: 'left' });
    const layout = layoutCourse(c);
    expect(timerLane(layout.pieces[0], c.timer!)).toBe(0);
    const [body, top, tape] = timerBlocks(layout, c.timer!);
    // The left fence's outer face, + X being left.
    const fence = -(laneOffset(0) - GLOBAL_SPEC.lanePitch / 2) + GLOBAL_SPEC.fenceThickness / 2;
    expect(Math.min(...blockCorners(body).map((p) => p.x))).toBeCloseTo(fence);
    expect(Math.max(...blockCorners(body).map((p) => p.y))).toBeCloseTo(TIMER.bodyHeight);
    expect(Math.min(...blockCorners(top).map((p) => p.x))).toBeCloseTo(fence - GLOBAL_SPEC.fenceThickness / 2 - TIMER.reach);
    expect(Math.min(...blockCorners(top).map((p) => p.y))).toBeCloseTo(TIMER.bodyHeight - TIMER.topThickness);
    expect(new Vector3().setFromMatrixPosition(tape.frame).x).toBeCloseTo(-laneOffset(0));
    expect(new Vector3().setFromMatrixPosition(tape.frame).z).toBeCloseTo(200);
  });

  it('covers the right lane from the right fence, and can time every lane', () => {
    const c = placeTimer(placeTimer(straights(), { piece: 1, offset: 10 }), { side: 'right', everyLane: true });
    expect(c.timer).toEqual({ piece: 1, offset: 10, side: 'right', everyLane: true });
    const layout = layoutCourse(c);
    expect(timerLane(layout.pieces[1], c.timer!)).toBe(2);
    expect(new Vector3().setFromMatrixPosition(timerBlocks(layout, c.timer!)[2].frame).x).toBeCloseTo(-laneOffset(2));
    expect(placeTimer(c, { everyLane: false }).timer?.everyLane).toBeUndefined();
  });

  it('goes with its piece when that is deleted, and is renumbered otherwise', () => {
    const c = placeTimer(placeStart(straights(), 1, 50), { piece: 0, offset: 20 });
    const gone = deletePiece(c, 1);
    expect(gone.start).toBeUndefined();
    expect(gone.timer).toEqual(c.timer);
    const shifted = deletePiece(c, 0);
    expect(shifted.start).toEqual({ piece: 0, offset: 50 });
    expect(shifted.timer).toBeUndefined();
  });

  it('is checked when read', () => {
    const c = placeStart(straights(), 1, 50);
    expect(() => validateCourse({ ...c, start: { piece: 5, offset: 0 } })).toThrow('start on missing road');
    expect(() => validateCourse({ ...c, timer: { piece: 0, offset: 0, side: 'up' as 'left' } })).toThrow('timer by up');
  });
});

describe('nearestRoad', () => {
  it('finds the piece and how far along it a floor point is', () => {
    const layout = layoutCourse(straights());
    const spot = nearestRoad(layout, 80, 700)!;
    expect(spot.piece).toBe(1);
    expect(spot.offset).toBeCloseTo(160);
    expect(spot.point.z).toBeCloseTo(700);
    expect(nearestRoad(layoutCourse(emptyCourse()), 0, 0)).toBeNull();
  });

  it('keeps to the road at the height given, and else takes the higher', () => {
    let c = straights();
    c = addPiece(c, 'straight', null);
    c = moveGroup(c, new Set([2]), new Matrix4().makeTranslation(0, 200, 0));
    const layout = layoutCourse(c);
    expect(nearestRoad(layout, 0, 100)!.piece).toBe(2);
    expect(nearestRoad(layout, 0, 100, 0)!.piece).toBe(0);
  });
});
