import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { GLOBAL_SPEC } from './catalog';
import { layoutCourse, validateCourse } from './course';
import { pointOnFrame } from './geometry';
import { basicOval, chain } from './presets';
import { endFrames, setTape, wallFrames, TAPE_THICKNESS, tapeNeeds, tapeStrips, WALL_WRAP, type JointTape } from './tape';

const floor = { kind: 'curing', width: 50, friction: 0.5 } as const;
const wall = (dividers = false) => ({ kind: 'opp', width: 48, friction: 0.35, dividers }) as const;
const taped = (tape: JointTape, pieces = ['straight', 'straight']) => layoutCourse(setTape(chain(pieces), tape));
/** Full width of three lanes to the outsides of the outer fences, mm. */
const ROAD = 3 * GLOBAL_SPEC.lanePitch + GLOBAL_SPEC.fenceThickness;

describe('joint tape (#133)', () => {
  it('is off unless set, and an empty setting takes it off', () => {
    expect(tapeStrips(layoutCourse(chain(['straight', 'straight'])))).toEqual([]);
    expect(setTape(setTape(chain(['straight']), { floor }), {}).tape).toBeUndefined();
    expect(() => validateCourse(setTape(chain(['straight']), { floor: { ...floor, width: 0 } }))).toThrow();
  });

  it('lays one floor strip across the whole road, half its width on each piece', () => {
    const strips = tapeStrips(taped({ floor }));
    expect(strips).toHaveLength(2);
    for (const s of strips) {
      expect(s.where).toBe('floor');
      expect(s.x[1] - s.x[0]).toBeCloseTo(ROAD);
      const ends = [s.frames[0], s.frames[s.frames.length - 1]].map((f) => new Vector3().setFromMatrixPosition(f));
      expect(ends[0].distanceTo(ends[1])).toBeCloseTo(25);
    }
    expect(new Set(strips.map((s) => s.piece))).toEqual(new Set([0, 1]));
  });

  it('tapes the outer walls, over the top and down both faces, and the dividers when asked (owner, 2026-10-31)', () => {
    const outer = tapeStrips(taped({ wall: wall() }));
    // Two outer walls on each of the two pieces.
    expect(outer).toHaveLength(4);
    const half = GLOBAL_SPEC.fenceThickness / 2;
    const outerFence = 1.5 * GLOBAL_SPEC.lanePitch;
    for (const s of outer) {
      expect(Math.abs(s.wall!)).toBeCloseTo(outerFence);
      expect(s.x[0]).toBeCloseTo(s.wall! - half - TAPE_THICKNESS);
      expect(s.x[1]).toBeCloseTo(s.wall! + half + TAPE_THICKNESS);
      expect(s.y[1]).toBeCloseTo(GLOBAL_SPEC.fenceHeight + TAPE_THICKNESS);
      expect(s.friction).toBe(0.35);
    }
    const all = tapeStrips(taped({ wall: wall(true) }));
    expect(all).toHaveLength(8);
    expect(new Set(all.map((s) => Math.round(Math.abs(s.wall!))))).toEqual(new Set([GLOBAL_SPEC.lanePitch / 2, outerFence]));
  });

  it('tapes every joint of a course with a lane change, walls only at its outer edges', () => {
    const layout = layoutCourse(setTape(basicOval(), { floor, wall: wall() }));
    const strips = tapeStrips(layout);
    expect(strips.filter((s) => s.where === 'floor').length).toBeGreaterThanOrEqual(2 * layout.joints.length);
    // Two outer walls at each end, even where a lane change's tracks meet at one port.
    const perEnd = new Map<string, number>();
    for (const s of strips.filter((s) => s.where === 'wall')) perEnd.set(`${s.piece}:${s.port}`, (perEnd.get(`${s.piece}:${s.port}`) ?? 0) + 1);
    expect(perEnd.size).toBe(2 * layout.joints.length);
    expect([...perEnd.values()].every((n) => n === 2)).toBe(true);
    // And they are as far apart as the port is wide.
    for (const [key] of perEnd) {
      const [piece, portIndex] = key.split(':').map(Number);
      const pc = layout.pieces[piece];
      const toPort = pc.geometry.ports[portIndex].clone().invert();
      const xs = strips.filter((s) => s.where === 'wall' && s.piece === piece && s.port === portIndex)
        .map((s) => {
          // The strip's frame at the port, whichever end of the track that is.
          const ends = [s.frames[0], s.frames[s.frames.length - 1]].map((f) => pointOnFrame(f, (s.x[0] + s.x[1]) / 2, 0).applyMatrix4(toPort));
          return ends.sort((a, b) => Math.abs(a.z) - Math.abs(b.z))[0].x;
        });
      const lanes = pc.part.ports[portIndex].lanes.length;
      expect(Math.abs(xs[0] - xs[1])).toBeCloseTo(lanes * GLOBAL_SPEC.lanePitch, 0);
    }
  });

  it('tapes each wall once at an end where a lane change\'s tracks meet, dividers and all', () => {
    const layout = layoutCourse(setTape(basicOval(), { wall: wall(true) }));
    const perEnd = new Map<string, number>();
    for (const s of tapeStrips(layout)) perEnd.set(`${s.piece}:${s.port}`, (perEnd.get(`${s.piece}:${s.port}`) ?? 0) + 1);
    for (const [key, n] of perEnd) {
      const [piece, port] = key.split(':').map(Number);
      expect(n).toBe(layout.pieces[piece].part.ports[port].lanes.length + 1);
    }
  });

  it('says how much tape the course takes', () => {
    const needs = tapeNeeds(taped({ floor, wall: wall(true) }, ['straight', 'straight', 'straight']));
    expect(needs.map((n) => [n.where, n.joints, Math.round(n.length)])).toEqual([
      ['floor', 2, Math.round(2 * ROAD)],
      ['wall', 2, 2 * 4 * WALL_WRAP],
    ]);
  });

  it('wraps each wall as wide along it, on the inside of a bend too (owner, 2026-10-31)', () => {
    const layout = layoutCourse(chain(['curve45']));
    const samples = layout.pieces[0].geometry.tracks[0].samples;
    for (const right of [-180, -60, 60, 180]) {
      for (const atStart of [true, false]) {
        const points = wallFrames(samples, atStart, 25, right).map((f) => pointOnFrame(f, right, 0));
        let length = 0;
        for (let i = 1; i < points.length; i++) length += points[i].distanceTo(points[i - 1]);
        expect(length).toBeCloseTo(25, 0);
      }
    }
  });

  it('lays a strip straight on from the joint, as wide all along, on a bend too (owner, 2026-10-31)', () => {
    const layout = layoutCourse(chain(['curve45']));
    const samples = layout.pieces[0].geometry.tracks[0].samples;
    for (const atStart of [true, false]) {
      const frames = endFrames(samples, atStart, 30);
      expect(frames).toHaveLength(2);
      const [a, b] = frames.map((f) => new Vector3().setFromMatrixPosition(f));
      expect(a.distanceTo(b)).toBeCloseTo(30);
      // Straight on from the end, which stays where the track ends.
      const end = new Vector3().setFromMatrixPosition(samples[atStart ? 0 : samples.length - 1]);
      expect((atStart ? a : b).distanceTo(end)).toBeCloseTo(0);
      // Along the track there, into the piece.
      const inward = new Vector3().setFromMatrixPosition(samples[atStart ? 1 : samples.length - 2]).sub(end).normalize();
      expect((atStart ? b.clone().sub(a) : a.clone().sub(b)).normalize().dot(inward)).toBeGreaterThan(0.999);
    }
  });
});
