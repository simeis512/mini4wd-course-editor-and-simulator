import { Vector3, type Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';
import { layoutCourse } from './course';
import { BEND_LIMIT, TWIST_LIMIT } from './flex';
import { chain } from './presets';
import { raiseRun, runFrom } from './raise';

const up = (m: Matrix4) => new Vector3(0, 1, 0).transformDirection(m);
const height = (m: Matrix4) => m.elements[13];
const joint = (piece: number) => [{ piece, port: 1 }, { piece: piece + 1, port: 0 }] as const;
/** A straight, a full ring of eight curves, then a straight on. */
const spiral = () => chain(['straight', ...Array(8).fill('curve45'), 'straight']);

describe('runFrom', () => {
  it('follows the links on from a joint', () => {
    const run = runFrom(spiral(), ...joint(0), 8)!;
    expect(run.pieces).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(run.joints).toHaveLength(9);
    expect(run.joints[8]).toEqual([{ piece: 8, port: 1 }, { piece: 9, port: 0 }]);
  });

  it('stops at the end of the chain', () => {
    const run = runFrom(chain(['straight', 'straight', 'straight']), ...joint(0), 5)!;
    expect(run.pieces).toEqual([1, 2]);
    expect(run.joints).toHaveLength(2);
  });
});

describe('raiseRun (spec 16.3)', () => {
  it('climbs a straight run and levels out', () => {
    const c = raiseRun(chain(['straight', 'straight', 'straight', 'straight', 'straight']), ...joint(0), 3, 60);
    const layout = layoutCourse(c);
    // Within the step that 0.1° of gradient makes over the run.
    expect(Math.abs(height(layout.pieces[3].ports[1]) - 60)).toBeLessThan(1.5);
    expect(height(layout.pieces[4].ports[1])).toBeCloseTo(height(layout.pieces[3].ports[1]), 0);
    expect(up(layout.pieces[4].ports[1]).y).toBeGreaterThan(Math.cos((0.2 * Math.PI) / 180));
  });

  it('turns a ring of curves into a spiral that passes over itself', () => {
    const c = raiseRun(spiral(), ...joint(0), 8, 100);
    const layout = layoutCourse(c);
    const start = layout.pieces[0].ports[1];
    const end = layout.pieces[8].ports[1];
    // One lap on, right above where it began.
    expect(Math.abs(height(end) - height(start) - 100)).toBeLessThan(1.5);
    expect(Math.hypot(end.elements[12] - start.elements[12], end.elements[14] - start.elements[14])).toBeLessThan(5);
    // Every curve climbs the same and stays level from side to side.
    const heights = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => height(layout.pieces[i].ports[1]));
    heights.forEach((h, i) => expect(Math.abs(h - (100 * (i + 1)) / 8)).toBeLessThan(2));
    for (const i of [1, 4, 8]) expect(Math.abs(new Vector3(1, 0, 0).transformDirection(layout.pieces[i].ports[1]).y)).toBeLessThan(0.002);
    // Small enough for real joints, and level again after the spiral.
    expect(layout.problems).toEqual([]);
    for (const rec of c.pieces) {
      expect(Math.abs(rec.twist ?? 0)).toBeLessThanOrEqual(TWIST_LIMIT);
      if ('bend' in rec) expect(Math.abs(rec.bend?.pitch ?? 0)).toBeLessThanOrEqual(BEND_LIMIT);
    }
    expect(up(layout.pieces[9].ports[1]).y).toBeGreaterThan(Math.cos((0.2 * Math.PI) / 180));
  });

  it('lowers with a negative rise', () => {
    const layout = layoutCourse(raiseRun(spiral(), ...joint(0), 8, -40));
    expect(Math.abs(height(layout.pieces[8].ports[1]) + 40)).toBeLessThan(1.5);
  });
});
