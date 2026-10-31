import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { GLOBAL_SPEC } from './catalog';
import { layoutCourse, type Layout } from './course';
import { pointOnFrame } from './geometry';
import { basicOval, chain } from './presets';
import { setTape, type JointTape } from './tape';
import { tapeFrictionAt, tapeZones } from './tape-zones';

const floor = { kind: 'curing', width: 50, friction: 0.5 } as const;
const wall = (dividers = false) => ({ kind: 'cloth', width: 50, friction: 0.6, dividers }) as const;
const taped = (tape: JointTape, course = chain(['straight', 'straight'])) => layoutCourse(setTape(course, tape));

/** A point by the joint of piece `piece`'s port `port`: `right` across, `up`, `ahead` into the piece, world mm. */
function nearPort(layout: Layout, piece: number, port: number, right: number, up: number, ahead = 0): Vector3 {
  const pc = layout.pieces[piece];
  // Ports face out of the piece.
  const f = pc.matrix.clone().multiply(pc.geometry.ports[port]);
  const p = pointOnFrame(f, right, up);
  const out = new Vector3(0, 0, 1).transformDirection(f);
  return p.addScaledVector(out, -ahead);
}

describe('joint tape friction zones (#133)', () => {
  it('finds the floor strip under a point near a joint, either side of it, and not away from it', () => {
    const layout = taped({ floor });
    for (const ahead of [3, 20]) expect(tapeFrictionAt(tapeZones(layout), 'floor', nearPort(layout, 1, 0, 30, 0, ahead))).toBe(0.5);
    expect(tapeFrictionAt(tapeZones(layout), 'floor', nearPort(layout, 0, 1, -50, 0, 10))).toBe(0.5);
    // Past the strip's half width on the piece.
    expect(tapeFrictionAt(tapeZones(layout), 'floor', nearPort(layout, 1, 0, 0, 0, 40))).toBeNull();
    // Well above the road.
    expect(tapeFrictionAt(tapeZones(layout), 'floor', nearPort(layout, 1, 0, 0, 30, 10))).toBeNull();
    expect(tapeFrictionAt(tapeZones(layout), 'wall', nearPort(layout, 1, 0, 0, 0, 10))).toBeNull();
  });

  it('finds the wall strip by the walls taped, within the reach given', () => {
    const layout = taped({ wall: wall() });
    const face = 1.5 * GLOBAL_SPEC.lanePitch - GLOBAL_SPEC.fenceThickness / 2;
    const zones = tapeZones(layout);
    for (const side of [1, -1]) {
      const by = nearPort(layout, 1, 0, side * (face - 6.5), 12, 10);
      expect(tapeFrictionAt(zones, 'wall', by, 7)).toBe(0.6);
      expect(tapeFrictionAt(zones, 'wall', by, 2)).toBeNull();
    }
    // In the middle of the road, and along past the strip.
    expect(tapeFrictionAt(zones, 'wall', nearPort(layout, 1, 0, 0, 12, 10), 7)).toBeNull();
    expect(tapeFrictionAt(zones, 'wall', nearPort(layout, 1, 0, face - 6.5, 12, 60), 7)).toBeNull();
    // By a divider only when the dividers are taped too.
    const divider = GLOBAL_SPEC.lanePitch / 2 - GLOBAL_SPEC.fenceThickness / 2 - 6.5;
    expect(tapeFrictionAt(zones, 'wall', nearPort(layout, 1, 0, divider, 12, 10), 7)).toBeNull();
    const all = taped({ wall: wall(true) });
    expect(tapeFrictionAt(tapeZones(all), 'wall', nearPort(all, 1, 0, divider, 12, 10), 7)).toBe(0.6);
    expect(tapeFrictionAt(tapeZones(all), 'wall', nearPort(all, 1, 0, -divider, 12, 10), 7)).toBe(0.6);
  });

  it('covers the strips at bends and at the narrow ends of a lane change as well', () => {
    const layout = taped({ floor }, basicOval());
    const zones = tapeZones(layout);
    expect(zones.length).toBeGreaterThan(0);
    for (const j of layout.joints) {
      for (const right of [-20, 0, 20]) expect(tapeFrictionAt(zones, 'floor', nearPort(layout, j.b.piece, j.b.port, right, 0, 5), 1)).toBe(0.5);
    }
  });
});
