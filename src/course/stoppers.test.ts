import { describe, expect, it } from 'vitest';
import { blockCorners } from './blocks';
import { emptyCourse, validateCourse, type CatchBox, type Hose } from './course';
import {
  addStopper,
  BOX_SIZES,
  boxBlocks,
  boxOutline,
  hoseCurve,
  hoseLength,
  hosePointAt,
  insertHosePoint,
  moveStopper,
  newStopper,
  removeHosePoint,
  removeStopper,
  setStopper,
  stopperAt,
  stopperBounds,
  turnStopper,
} from './stoppers';

const line: Hose = { kind: 'hose', points: [[0, 0], [100, 0], [200, 100]], color: 0 };
const box = (over: Partial<CatchBox> = {}): CatchBox => ({ kind: 'box', size: 0, x: 0, z: 0, yaw: 0, ...over });
const span = (pts: [number, number][], j: 0 | 1) => Math.max(...pts.map((p) => p[j])) - Math.min(...pts.map((p) => p[j]));

describe('hoses (#53)', () => {
  it('runs smoothly through its points', () => {
    const c = hoseCurve(line);
    expect(c[0]).toEqual([0, 0]);
    expect(c[c.length - 1]).toEqual([200, 100]);
    for (const p of line.points) expect(c.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-9)).toBe(true);
    for (let i = 1; i < c.length; i++) expect(Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1])).toBeLessThan(15);
  });

  it('starts as a loop about as long as the circle through its points', () => {
    const loop = newStopper('hose', 1000, -500) as Hose;
    expect(loop.closed).toBe(true);
    const c = hoseCurve(loop);
    expect(c[c.length - 1]).toEqual(c[0]);
    expect(hoseLength(loop)).toBeGreaterThan(2 * Math.PI * 200 * 0.97);
    expect(hoseLength(loop)).toBeLessThan(2 * Math.PI * 200 * 1.03);
  });

  it('is picked along its length, and by its points', () => {
    const straight: Hose = { ...line, points: [[0, 0], [100, 0]] };
    expect(stopperAt([straight], 50, 7)).toBe(0);
    expect(stopperAt([straight], 50, 20)).toBeNull();
    expect(stopperAt([straight], 50, 20, 15)).toBe(0);
    expect(hosePointAt(line, 96, 3, 10)).toBe(1);
    expect(hosePointAt(line, 50, 0, 10)).toBeNull();
  });

  it('moves whole or by one point, and turns about its middle', () => {
    const c = addStopper(emptyCourse(), line);
    expect((moveStopper(c, 0, 10.4, -5)!.stoppers![0] as Hose).points).toEqual([[10, -5], [110, -5], [210, 95]]);
    expect((moveStopper(c, 0, 10, 10, 2).stoppers![0] as Hose).points).toEqual([[0, 0], [100, 0], [210, 110]]);
    const turned = (turnStopper(addStopper(emptyCourse(), { ...line, points: [[-100, 0], [100, 0]] }), 0, 90).stoppers![0] as Hose).points;
    // A quarter turn to the left about + Y takes + X to − Z.
    expect(turned).toEqual([[0, 100], [0, -100]]);
  });

  it('gains points along its curve and keeps enough of them', () => {
    let c = addStopper(emptyCourse(), line);
    c = insertHosePoint(c, 0, 0);
    const h = c.stoppers![0] as Hose;
    expect(h.points).toHaveLength(4);
    // On the curve as it was, so the hose keeps its shape.
    const [x, z] = h.points[1];
    expect(Math.min(...hoseCurve(line, 1).map((q) => Math.hypot(q[0] - x, q[1] - z)))).toBeLessThan(1);
    expect(x).toBeGreaterThan(30);
    expect(x).toBeLessThan(70);
    // Down to two points for a line; a loop needs three.
    c = removeHosePoint(removeHosePoint(c, 0, 1), 0, 1);
    expect((c.stoppers![0] as Hose).points).toEqual([[0, 0], [200, 100]]);
    expect(removeHosePoint(c, 0, 0)).toBe(c);
    expect((setStopper(c, 0, { closed: true }).stoppers![0] as Hose).closed).toBe(false);
    expect((setStopper(c, 0, { color: 3 }).stoppers![0] as Hose).color).toBe(3);
  });
});

describe('cardboard boxes (#53)', () => {
  it('lies on its side by default, open towards + Z', () => {
    const { width, height } = BOX_SIZES[0];
    const { outline, open } = boxOutline(box());
    expect(span(outline, 0)).toBeCloseTo(width);
    expect(span(outline, 1)).toBeCloseTo(height);
    expect(open!.every((p) => Math.abs(p[1] - height / 2) < 1e-9)).toBe(true);
    // No panel closes the open side.
    const front = Math.max(...boxBlocks(box()).flatMap((b) => blockCorners(b).map((p) => p.z)));
    expect(front).toBeCloseTo(height / 2);
    const back = boxBlocks(box()).filter((b) => blockCorners(b).every((p) => p.z < -height / 2 + 6));
    expect(back).toHaveLength(1);
  });

  it('stands open side up when asked, and turns', () => {
    const { width, depth, height } = BOX_SIZES[0];
    const up = box({ upright: true });
    expect(boxOutline(up).open).toBeNull();
    expect(span(boxOutline(up).outline, 1)).toBeCloseTo(depth);
    expect(Math.max(...boxBlocks(up).flatMap((b) => blockCorners(b).map((p) => p.y)))).toBeCloseTo(height);
    const turned = turnStopper(addStopper(emptyCourse(), box({ yaw: 170 })), 0, 15).stoppers![0] as CatchBox;
    expect(turned.yaw).toBe(-175);
    expect(span(boxOutline({ ...turned, yaw: 90 }).outline, 0)).toBeCloseTo(height);
    expect(span(boxOutline({ ...turned, yaw: 90 }).outline, 1)).toBeCloseTo(width);
  });

  it('is picked inside its outline and changes size and way up', () => {
    const c = addStopper(addStopper(emptyCourse(), line), box({ x: 1000 }));
    expect(stopperAt(c.stoppers!, 1100, 50)).toBe(1);
    expect(stopperAt(c.stoppers!, 1200, 50)).toBeNull();
    expect(setStopper(c, 1, { size: 2, upright: true }).stoppers![1]).toEqual(box({ x: 1000, size: 2, upright: true }));
    expect(removeStopper(removeStopper(c, 1), 0).stoppers).toBeUndefined();
    expect(() => validateCourse(c)).not.toThrow();
    expect(() => validateCourse({ ...c, stoppers: [{ ...line, points: [[0, 0]] }] })).toThrow('bad stopper');
  });

  it('reaches as far as its outline, a hose its thickness further', () => {
    const [x0, x1, z0, z1] = stopperBounds([box(), line])!;
    expect([x0, x1, z1]).toEqual([-150, 200 + 7.5, 100 + 7.5]);
    expect(z0).toBeCloseTo(-90);
    expect(stopperBounds([])).toBeNull();
  });
});
