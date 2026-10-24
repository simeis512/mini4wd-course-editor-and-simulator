import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { layoutCourse } from './course';
import { crossing, lapMarks, startDirection, timedLane } from './lap-marks';
import { basicOval } from './presets';
import { laneStart, simCourse } from './sim-course';
import { moveStart, placeStart, placeTimer } from './timing';

const withStart = () => placeStart(basicOval(), 0, 270);

describe('crossing', () => {
  const lane = (y: number) => ({ points: [new Vector3(0, y, -100), new Vector3(0, y, 100)], distances: [0, 200] });
  const line = { frame: new Matrix4(), from: -60, to: 60 };

  it('finds where a lane runs through a line across the road', () => {
    expect(crossing(lane(0), line)).toBeCloseTo(100);
    expect(crossing(lane(0), { ...line, frame: new Matrix4().makeTranslation(0, 0, 50) })).toBeCloseTo(150);
  });

  it('leaves out a lane that passes beside the line, or over it on a bridge', () => {
    expect(crossing(lane(0), { ...line, from: 70, to: 190 })).toBeNull();
    expect(crossing(lane(41), line)).toBeNull();
  });
});

describe('lapMarks (#28)', () => {
  it('puts the start line on every lane, where the machines set off', () => {
    const layout = layoutCourse(withStart());
    const { lanes } = simCourse(layout);
    const marks = lapMarks(layout, lanes);
    expect(marks.start).toHaveLength(3);
    marks.start.forEach((at, i) => expect(at).toBeCloseTo(laneStart(layout, lanes[i]).along, 0));
  });

  it('times only the lane the timer reaches over, or every lane when set to', () => {
    const course = withStart();
    const layout = layoutCourse(course);
    const { lanes } = simCourse(layout);
    expect(lapMarks(layout, lanes).timer.filter((at) => at !== null)).toHaveLength(1);
    const every = layoutCourse(placeTimer(course, { everyLane: true }));
    const timed = lapMarks(every, lanes).timer;
    expect(timed.every((at) => at !== null)).toBe(true);
    // Just past the start line.
    timed.forEach((at, i) => expect(at! - lapMarks(every, lanes).start[i]!).toBeCloseTo(150, 0));
  });

  it('has nothing to mark on a course with no start or timer', () => {
    const layout = layoutCourse(basicOval());
    const marks = lapMarks(layout, simCourse(layout).lanes);
    expect([...marks.start, ...marks.timer].every((at) => at === null)).toBe(true);
  });
});

describe('startDirection (#28)', () => {
  it('runs the way the start arrows point, whichever way round the course is set', () => {
    const layout = layoutCourse(withStart());
    expect(startDirection(layout, 1)).toBe(1);
    expect(startDirection(layout, -1)).toBe(1);
    const back = layoutCourse(moveStart(withStart(), { reverse: true }));
    expect(startDirection(back, 1)).toBe(-1);
  });

  it('keeps the course direction with no start line', () => {
    expect(startDirection(layoutCourse(basicOval()), -1)).toBe(-1);
  });
});

describe('timedLane (#28)', () => {
  it('is the lane the timer reaches over, counted from the left at the start', () => {
    const course = withStart();
    expect(timedLane(layoutCourse(course), 1)).toBe(0);
    expect(timedLane(layoutCourse(placeTimer(course, { side: 'right' })), 1)).toBe(2);
  });

  it('is none with no timer, or one that times every lane', () => {
    expect(timedLane(layoutCourse(basicOval()), 1)).toBeNull();
    expect(timedLane(layoutCourse(placeTimer(withStart(), { everyLane: true })), 1)).toBeNull();
  });
});
