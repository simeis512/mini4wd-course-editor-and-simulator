import { Matrix4, Vector3 } from 'three';
import type { Layout } from './course';
import { tapeStrips } from './tape';

// Where the joint tape's friction acts on a running machine (#133, owner
// 2026-10-31): the tyres on a floor strip, the rollers by a wall strip
// (which wraps the wall, so on either face).

/**
 * Friction of the bare road against the tyres and of the bare fences
 * against the rollers, as the tape's friction is (#133, provisional: not
 * measured, as #1). On tape the tyres' grip and the rollers' drag go by
 * the tape's friction over these.
 */
export const ROAD_FRICTION = 0.6;
export const WALL_FRICTION = 0.3;

/** One strip as the simulator looks it up, world mm. */
export interface TapeZone {
  where: 'floor' | 'wall';
  friction: number;
  /** World to each of the strip's frames, in the track's order. */
  inverses: Matrix4[];
  /** Across the road, as the frames' own x (the frames' x points left), and up, mm. */
  x: [number, number];
  y: [number, number];
  /** A ball round the strip, for passing over it quickly. */
  centre: Vector3;
  radius: number;
}

const zonesCache = new WeakMap<Layout, TapeZone[]>();

/** The strips of the course's joint tape that touch the machine; shared read-only for this layout. */
export function tapeZones(layout: Layout): TapeZone[] {
  let zones = zonesCache.get(layout);
  if (zones) return zones;
  zones = [];
  for (const s of tapeStrips(layout)) {
    if (s.frames.length < 2) continue;
    const m = layout.pieces[s.piece].matrix;
    const frames = s.frames.map((f) => m.clone().multiply(f));
    const points = frames.map((f) => new Vector3().setFromMatrixPosition(f));
    const centre = points.reduce((c, p) => c.add(p), new Vector3()).divideScalar(points.length);
    const reach = Math.max(...points.map((p) => p.distanceTo(centre)));
    const across = Math.max(...s.x.map(Math.abs));
    zones.push({
      where: s.where,
      friction: s.friction,
      inverses: frames.map((f) => f.clone().invert()),
      // The strip's x is to the right; the frames' own x is to the left.
      x: [-s.x[1], -s.x[0]],
      y: s.y,
      centre,
      radius: Math.hypot(reach + across, s.y[1]),
    });
  }
  zonesCache.set(layout, zones);
  return zones;
}

const local = new Vector3();
const next = new Vector3();

/**
 * The friction of the tape `where` at a world point (mm), or null off the
 * tape: within `reach` of the strip across and up, between its two ends.
 * The tyres look it up where they touch the road, the rollers at their
 * middles (their radius as the reach).
 */
export function tapeFrictionAt(zones: readonly TapeZone[], where: TapeZone['where'], point: Vector3, reach = 0): number | null {
  for (const z of zones) {
    if (z.where !== where || point.distanceTo(z.centre) > z.radius + reach) continue;
    for (let i = 0; i + 1 < z.inverses.length; i++) {
      local.copy(point).applyMatrix4(z.inverses[i]);
      if (local.z < 0) continue;
      // Past the next frame is the next stretch's.
      if (next.copy(point).applyMatrix4(z.inverses[i + 1]).z > 0 && i + 2 < z.inverses.length) continue;
      if (next.z > 0) break;
      // On a bend's inside two stretches may both hold it: look at the next too.
      if (local.x < z.x[0] - reach || local.x > z.x[1] + reach) continue;
      if (local.y < z.y[0] - reach || local.y > z.y[1] + reach) continue;
      return z.friction;
    }
  }
  return null;
}
