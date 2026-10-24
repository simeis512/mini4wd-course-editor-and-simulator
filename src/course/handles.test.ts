import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { layoutCourse, movingGroup } from './course';
import { moveGroup, pieceMiddle } from './edit';
import {
  alongScreen, handleFrame, handleMatrix, lowestPort, nearestRingDeg, ringPoint, snapTo, wrapDeg,
} from './handles';
import { chain } from './presets';

/** Looking straight down: world X/Z to screen, 1 px per mm, screen y down = world +Z. */
const fromAbove = (p: Vector3): [number, number] => [p.x, p.z];

describe('handleFrame (#62)', () => {
  it('runs along a straight and across it to the left', () => {
    const pc = layoutCourse(chain(['straight'])).pieces[0];
    const f = handleFrame(pc);
    expect(f.along.z).toBeCloseTo(1);
    expect(f.across.x).toBeCloseTo(1);
    expect(f.centre.distanceTo(pieceMiddle(pc))).toBeLessThan(1e-9);
  });

  it('follows the chord of a curve, which is level', () => {
    const pc = layoutCourse(chain(['straight', 'curve45'])).pieces[1];
    const f = handleFrame(pc);
    expect(f.along.y).toBe(0);
    expect(f.along.length()).toBeCloseTo(1);
    // A 45° curve's chord lies halfway between the lines of its two ends.
    const line = (m: Parameters<Vector3['transformDirection']>[0]) => {
      const a = f.along.angleTo(new Vector3(0, 0, 1).transformDirection(m).setY(0).normalize());
      return Math.min(a, Math.PI - a);
    };
    expect(line(pc.ports[0])).toBeCloseTo(Math.PI / 8);
    expect(line(pc.ports[1])).toBeCloseTo(Math.PI / 8);
  });
});

describe('ring', () => {
  it('finds the angle of the point under the pointer', () => {
    const c = new Vector3(100, 0, 50);
    const p = fromAbove(ringPoint(c, 80, 90));
    expect(nearestRingDeg(fromAbove, c, 80, p)).toBeCloseTo(90);
    expect(nearestRingDeg(fromAbove, c, 80, [100, 50 + 200])).toBeCloseTo(0);
  });

  it('matches the way turnAboutMiddle turns', () => {
    const layout = layoutCourse(chain(['straight']));
    const f = handleFrame(layout.pieces[0]);
    const m = handleMatrix(layout, 0, { kind: 'turn', deg: 30 });
    const moved = ringPoint(f.centre, 80, 10).applyMatrix4(m);
    expect(moved.distanceTo(ringPoint(f.centre, 80, 40))).toBeLessThan(1e-6);
  });

  it('wraps angles to a half turn either way', () => {
    expect(wrapDeg(350)).toBe(-10);
    expect(wrapDeg(-190)).toBe(170);
    expect(wrapDeg(180)).toBe(180);
  });
});

describe('alongScreen', () => {
  it('keeps only the movement along the axis', () => {
    // 100 mm shows as 50 px to the right.
    expect(alongScreen([50, 0], 100, [0, 0], [25, 40])).toBeCloseTo(50);
    expect(alongScreen([0, 0], 100, [0, 0], [25, 40])).toBe(0);
  });

  it('snaps to steps', () => {
    expect(snapTo(14, 10)).toBe(10);
    expect(snapTo(-16, 15)).toBe(-15);
    expect(Object.is(snapTo(-0.2, 10), -0)).toBe(false);
  });
});

describe('handleMatrix', () => {
  it('slides the group along a direction', () => {
    const course = chain(['straight', 'straight']);
    const layout = layoutCourse(course);
    const m = handleMatrix(layout, 0, { kind: 'slide', dir: new Vector3(1, 0, 0), mm: 30 });
    const moved = layoutCourse(moveGroup(course, movingGroup(layout, 0), m));
    expect(moved.pieces[1].ports[1].elements[12] - layout.pieces[1].ports[1].elements[12]).toBeCloseTo(30);
  });

  it('never lifts the group below the floor', () => {
    const course = chain(['straight']);
    const layout = layoutCourse(course);
    const low = lowestPort(layout, [0]);
    expect(low).toBeCloseTo(0);
    expect(handleMatrix(layout, 0, { kind: 'lift', mm: -50 }, low).elements[13]).toBeCloseTo(0);
    const raised = layoutCourse(moveGroup(course, new Set([0]), handleMatrix(layout, 0, { kind: 'lift', mm: 110 }, low)));
    expect(lowestPort(raised, [0])).toBeCloseTo(110);
    expect(handleMatrix(raised, 0, { kind: 'lift', mm: -200 }, lowestPort(raised, [0])).elements[13]).toBeCloseTo(-110);
  });
});
