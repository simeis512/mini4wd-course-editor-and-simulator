import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { layoutCourse } from './course';
import { checkLaps, jumpLanding } from './laps';
import { basicOval, chain, rampJumpOval } from './presets';

const ring = () => chain(Array(8).fill('curve45'));

describe('checkLaps', () => {
  it('keeps each lane in itself round a ring of curves, the left lane inside', () => {
    const check = checkLaps(layoutCourse(ring()))!;
    expect(check.turn).toBe(1);
    expect(check.laps.map((l) => l.lane)).toEqual([0, 1, 2]);
    expect(check.laps.map((l) => l.next)).toEqual([0, 1, 2]);
    // Lane centres at radii 420, 540 and 660.
    check.laps.forEach((l, i) => expect(l.length).toBeCloseTo(2 * Math.PI * (420 + 120 * i), 0));
    expect(check.cycle).toEqual([0]);
    expect(check.allLanes).toBe(false);
  });

  it('turns right when run the other way, the right lane inside', () => {
    const check = checkLaps(layoutCourse(ring()), -1)!;
    expect(check.start).toEqual({ piece: 0, port: 1 });
    expect(check.turn).toBe(-1);
    // Looking the other way the part's lane 2 is on the left, and outside.
    expect(check.laps.map((l) => l.lane)).toEqual([2, 1, 0]);
    expect(check.laps[0].length).toBeCloseTo(2 * Math.PI * 660, 0);
  });

  it('runs every lane in three laps of the basic oval, about 20 m in all', () => {
    const check = checkLaps(layoutCourse(basicOval()))!;
    expect(check.laps.every((l) => l.broken === null)).toBe(true);
    expect(check.cycle).toHaveLength(3);
    expect(check.allLanes).toBe(true);
    // The official figure for three laps is about 20 m (jcjc-parts baseCourse).
    const total = check.laps.reduce((sum, l) => sum + l.length, 0);
    expect(total).toBeGreaterThan(19500);
    expect(total).toBeLessThan(20500);
  });

  it('follows the lane change over the bridge, not straight across', () => {
    const check = checkLaps(layoutCourse(basicOval()))!;
    // The lap that goes over the bridge climbs to its top.
    const top = Math.max(...check.laps.map((l) => Math.max(...l.points.map((p) => p.y))));
    expect(top).toBeCloseTo(100, 0);
  });

  it('reports where a lane breaks off', () => {
    const check = checkLaps(layoutCourse(chain(['straight', 'straight'])))!;
    expect(check.laps.every((l) => l.next === null)).toBe(true);
    expect(check.laps[0].broken).toEqual({ piece: 1, port: 1 });
    expect(check.laps[0].length).toBeCloseTo(1080, 6);
    expect(check.cycle).toEqual([]);
    expect(check.allLanes).toBe(false);
  });

  it('has nothing to check on an empty course', () => {
    expect(checkLaps(layoutCourse({ v: 1, catalog: 1, pieces: [] }))).toBeNull();
  });
});

describe('jumps (#28)', () => {
  it('leaves a lane broken at the ramp for the editor, and carries it on to the landing for the simulator', () => {
    const layout = layoutCourse(rampJumpOval());
    const right = (jumps: boolean) => checkLaps(layout, 1, jumps)!.laps[2];
    expect(right(false).next).toBeNull();
    expect(right(false).broken).toMatchObject({ piece: 13, port: 2 });
    expect(right(true).next).not.toBeNull();
    expect(right(true).broken).toBeNull();
  });

  it('lands in the lane ahead that faces back, in line with where the lane leaves', () => {
    const layout = layoutCourse(rampJumpOval());
    const from = new Vector3().setFromMatrixPosition(layout.pieces[13].ports[2]);
    // The right lane of the free straight, which only the jump reaches.
    expect(jumpLanding(layout, { piece: 13, port: 2 }, from)).toEqual({ piece: 1, port: 0, lane: 2 });
    // Nothing in line beyond the far end of a plain run of straights.
    const plain = layoutCourse(chain(['straight', 'straight']));
    expect(jumpLanding(plain, { piece: 1, port: 1 }, new Vector3(0, 0, 1080))).toBeNull();
  });
});
