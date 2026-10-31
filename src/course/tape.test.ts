import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { GLOBAL_SPEC } from './catalog';
import { layoutCourse, validateCourse } from './course';
import { pointOnFrame } from './geometry';
import { basicOval, chain } from './presets';
import { endFrames, setTape, tapeNeeds, tapeStrips, type JointTape } from './tape';

const floor = { kind: 'curing', width: 50, friction: 0.5 } as const;
const wall = (face: 'inner' | 'outer' | 'both') => ({ kind: 'opp', width: 48, friction: 0.35, face }) as const;
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

  it('tapes only the outer walls, on the face asked for', () => {
    const inner = tapeStrips(taped({ wall: wall('inner') }));
    // Two outer walls on each of the two pieces.
    expect(inner).toHaveLength(4);
    const half = GLOBAL_SPEC.fenceThickness / 2;
    const outerFence = 1.5 * GLOBAL_SPEC.lanePitch;
    for (const s of inner) {
      const mid = (s.x[0] + s.x[1]) / 2;
      // On the road side of the outer fence.
      expect(Math.abs(mid)).toBeLessThan(outerFence - half);
      expect(Math.abs(mid)).toBeGreaterThan(outerFence - half - 1);
      expect(s.friction).toBe(0.35);
    }
    const outer = tapeStrips(taped({ wall: wall('outer') }));
    for (const s of outer) {
      expect(Math.abs((s.x[0] + s.x[1]) / 2)).toBeGreaterThan(outerFence + half);
      expect(s.friction).toBeNull();
    }
    expect(tapeStrips(taped({ wall: wall('both') }))).toHaveLength(8);
  });

  it('tapes every joint of a course with a lane change, walls only at its outer edges', () => {
    const layout = layoutCourse(setTape(basicOval(), { floor, wall: wall('inner') }));
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
      expect(Math.abs(xs[0] - xs[1])).toBeCloseTo(lanes * GLOBAL_SPEC.lanePitch - GLOBAL_SPEC.fenceThickness, 0);
    }
  });

  it('says how much tape the course takes', () => {
    const needs = tapeNeeds(taped({ floor, wall: wall('both') }, ['straight', 'straight', 'straight']));
    expect(needs.map((n) => [n.where, n.joints, Math.round(n.length)])).toEqual([
      ['floor', 2, Math.round(2 * ROAD)],
      ['wall', 2, 2 * 4 * GLOBAL_SPEC.fenceHeight],
    ]);
  });

  it('cuts a track end to length between samples', () => {
    const layout = layoutCourse(chain(['curve45']));
    const frames = endFrames(layout.pieces[0].geometry.tracks[0].samples, false, 30);
    let length = 0;
    for (let i = 1; i < frames.length; i++) length += new Vector3().setFromMatrixPosition(frames[i]).distanceTo(new Vector3().setFromMatrixPosition(frames[i - 1]));
    expect(length).toBeCloseTo(30, 0);
  });
});
