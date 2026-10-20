import { Vector3 } from 'three';
import { GLOBAL_SPEC } from './catalog';
import type { Layout } from './course';
import { pointOnFrame, STAND_BEAM, STAND_DEPTH, STAND_LEG, type Stand } from './geometry';
import { insidePolygon, worldTracks, type WorldTrack } from './mesh';

const { roadThickness, fenceThickness, fenceHeight } = GLOBAL_SPEC;

/** Road surface heights of a piece, mm: [lowest, highest] along its centrelines. */
export type HeightRange = [number, number];

/** Range of road heights of each piece (spec 8). */
export function pieceHeights(layout: Layout, tracks: readonly WorldTrack[] = worldTracks(layout)): HeightRange[] {
  const ranges: HeightRange[] = layout.pieces.map(() => [Infinity, -Infinity]);
  for (const t of tracks) {
    const r = ranges[t.piece];
    for (const f of t.samples) {
      const y = f.elements[13];
      r[0] = Math.min(r[0], y);
      r[1] = Math.max(r[1], y);
    }
  }
  return ranges.map((r) => (r[0] > r[1] ? [0, 0] : r));
}

/** A piece reaching this little under the filter height still counts as on that level. */
const LEVEL_MARGIN = 1;

/** Whether a piece shows under the level filter "only `level` mm and up" (spec 8). */
export function atLevel(range: HeightRange, level: number): boolean {
  return range[1] >= level - LEVEL_MARGIN;
}

/** Road whose underside is this close to what is below needs no support (#11, provisional). */
export const SUPPORT_MIN_GAP = 10;
/** Longest stretch of raised road one support carries, mm (#11, provisional). */
export const SUPPORT_SPACING = 270;
/** How far a support reaches out past the road on each side, mm (#11, provisional). */
export const SUPPORT_OVERHANG = 20;
/** How far a support may reach out to stand clear of road below it, mm (#11, provisional). */
export const SUPPORT_REACH = 400;
/** Room kept between a support and road below it, mm (#11, provisional). */
const SUPPORT_CLEARANCE = 5;
/** Step when looking across for room to stand, mm. */
const SCAN_STEP = 5;

/**
 * A stand under raised road (spec 3.4, 14): a frame across the road from the
 * floor up to the road's underside, which it follows when the road leans.
 */
export interface Support extends Stand {
  piece: number;
}

/** A track's road seen from above, cut into one quad per sample step, with the highest road surface of each. */
interface Footprint {
  track: WorldTrack;
  quads: { poly: [number, number][]; surface: number }[];
  box: [number, number, number, number];
}

function footprintOf(track: WorldTrack): Footprint {
  const { samples, section } = track;
  const p = new Vector3();
  const edge = (x: number) => samples.map((f) => pointOnFrame(f, x, 0, p).clone());
  const left = edge(section.left);
  const right = edge(section.right);
  const quads = [];
  for (let i = 0; i + 1 < samples.length; i++) {
    const corners = [left[i], left[i + 1], right[i + 1], right[i]];
    quads.push({ poly: corners.map((c): [number, number] => [c.x, c.z]), surface: Math.max(...corners.map((c) => c.y)) });
  }
  const all = [...left, ...right];
  const xs = all.map((v) => v.x);
  const zs = all.map((v) => v.z);
  return { track, quads, box: [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)] };
}

/** Highest surface of other road under the point (x, z) and lower than `y`, or -Infinity when there is none. */
function roadBelow(footprints: readonly Footprint[], own: WorldTrack, x: number, z: number, y: number): number {
  let top = -Infinity;
  for (const { track, quads, box } of footprints) {
    if (track === own || x < box[0] || x > box[1] || z < box[2] || z > box[3]) continue;
    for (const q of quads) if (q.surface < y && q.surface > top && insidePolygon(x, z, q.poly)) top = q.surface;
  }
  return top;
}

/**
 * Supports under every stretch of raised road (#11), evenly spaced along
 * each track, at most `SUPPORT_SPACING` apart and none at the joints, so
 * neighbouring pieces never stand two in one place. A support reaches a
 * little past the road on both sides. Where other road runs underneath (a
 * stacked level, a crossing) it reaches further, up to `SUPPORT_REACH`, so
 * its legs stand clear and its crossbar passes over that road's fences,
 * as at races (user, 2026-10-20); beside road on the floor (a ramp next to
 * its own lower lanes) its leg tucks in under the road instead, and where
 * there is no room outside it looks further in, as far as the middle of the
 * road. Where there is no room at all, the road is left to span the gap.
 */
export function supports(layout: Layout, tracks: readonly WorldTrack[] = worldTracks(layout)): Support[] {
  const footprints = tracks.map(footprintOf);
  const out: Support[] = [];
  // Lowest road first, so stands under a stacked level are in place before
  // the stands that straddle that level are fitted round them.
  const heights = new Map(tracks.map((t) => [t, Math.min(...t.samples.map((f) => f.elements[13]))]));
  for (const track of [...tracks].sort((p, q) => heights.get(p)! - heights.get(q)!)) {
    // Parts that come with their own stands (`partStands`) stand on them;
    // only their main road is held up when the whole piece is raised.
    if (layout.pieces[track.piece].part.supports && track.index !== 0) continue;
    const { samples, section } = track;
    const length = samples.reduce(
      (sum, f, i) => (i === 0 ? 0 : sum + new Vector3().setFromMatrixPosition(f).distanceTo(new Vector3().setFromMatrixPosition(samples[i - 1]))),
      0,
    );
    const count = Math.max(1, Math.ceil(length / SUPPORT_SPACING));
    for (let k = 0; k < count; k++) {
      const f = samples[Math.round(((k + 0.5) / count) * (samples.length - 1))];
      // The top is level along the road, so on a slope it sits low enough
      // for its uphill side to stay under the road too.
      const forward = new Vector3(0, 0, 1).transformDirection(f);
      const drop = ((STAND_DEPTH / 2) * Math.abs(forward.y)) / (Math.hypot(forward.x, forward.z) || 1);
      const edgeTop = (x: number) => pointOnFrame(f, x, -roadThickness).setY(pointOnFrame(f, x, -roadThickness).y - drop);
      const top = Math.min(edgeTop(section.left).y, edgeTop(section.right).y);
      if (Math.max(edgeTop(section.left).y, edgeTop(section.right).y) <= SUPPORT_MIN_GAP) continue;
      const along = new Vector3(0, 0, 1).transformDirection(f).setY(0);
      if (along.lengthSq() < 1e-9) continue;
      along.normalize();
      // Look across the whole depth of the stand: where it meets road below
      // at an angle, its corners reach further than its middle.
      const below = (x: number) => {
        const p = pointOnFrame(f, x, 0);
        let y = -Infinity;
        for (const d of [-STAND_DEPTH / 2, 0, STAND_DEPTH / 2]) {
          y = Math.max(y, roadBelow(footprints, track, p.x + along.x * d, p.z + along.z * d, top));
        }
        return y;
      };
      // Whether a stand already placed stands at `x` across the road, anywhere along the stand's depth.
      const onStand = (x: number) => {
        const p = pointOnFrame(f, x, 0);
        return [-STAND_DEPTH / 2, 0, STAND_DEPTH / 2].some((d) => out.some((o) => standContains(o, p.x + along.x * d, p.z + along.z * d)));
      };
      // A leg from `outer` inwards (side −1 left, +1 right) needs clear floor around it.
      const clear = (outer: number, side: -1 | 1) => {
        for (let d = -SUPPORT_CLEARANCE; d <= STAND_LEG + SUPPORT_CLEARANCE; d += SCAN_STEP) {
          if (below(outer - side * d) > -Infinity || onStand(outer - side * d)) return false;
        }
        return true;
      };
      const legAt = (edge: number, side: -1 | 1): number | null => {
        const wide = edge + side * SUPPORT_OVERHANG;
        if (clear(wide, side)) return wide;
        const tucked = edge - side * (fenceThickness + 2 * SUPPORT_CLEARANCE);
        if (clear(tucked, side)) return tucked;
        for (let x = wide; Math.abs(x - edge) <= SUPPORT_REACH; x += side * SCAN_STEP) if (clear(x, side)) return x;
        // No room outside: look further in under the road, as far as its middle (user, 2026-10-20).
        const middle = (section.left + section.right) / 2;
        for (let x = tucked; side * (middle - x) <= -STAND_LEG; x -= side * SCAN_STEP) if (clear(x, side)) return x;
        return null;
      };
      const a = legAt(section.left, -1);
      const b = legAt(section.right, 1);
      if (a === null || b === null) continue;
      // Past the road's edge the stand is no higher than the edge itself, so
      // on a tilted road (a bank) its high end does not rise beside the fence.
      const cornerTop = (x: number) => {
        const p = edgeTop(x);
        return p.setY(Math.min(p.y, edgeTop(Math.min(section.right, Math.max(section.left, x))).y));
      };
      const left = cornerTop(a);
      const right = cornerTop(b);
      // The crossbar must pass over any road between the legs.
      let under = -Infinity;
      for (let x = a; x <= b; x += SCAN_STEP) under = Math.max(under, below(x));
      if (under > -Infinity && Math.min(left.y, right.y) - STAND_BEAM < under + fenceHeight + SUPPORT_CLEARANCE) continue;
      const stand = { piece: track.piece, left, right, along };
      // Tracks side by side (a ramp beside its lower lanes) can ask for
      // stands in the same place: keep the first.
      if (out.some((o) => overlaps(o, stand))) continue;
      out.push(stand);
    }
  }
  return out.sort((p, q) => p.piece - q.piece);
}

/** The corners of a stand seen from above, X/Z. */
function standCorners(s: Stand): [number, number][] {
  const d = s.along.clone().multiplyScalar((s.depth ?? STAND_DEPTH) / 2);
  return [s.left.clone().sub(d), s.right.clone().sub(d), s.right.clone().add(d), s.left.clone().add(d)].map((v): [number, number] => [v.x, v.z]);
}

function standContains(s: Stand, x: number, z: number): boolean {
  return insidePolygon(x, z, standCorners(s));
}

/** Whether two stands' footprints overlap, seen from above. */
function overlaps(a: Stand, b: Stand): boolean {
  const mid = (s: Stand) => s.left.clone().add(s.right).multiplyScalar(0.5).setY(0);
  const across = b.right.clone().sub(b.left).setY(0).normalize();
  const offset = mid(a).sub(mid(b));
  if (Math.abs(offset.dot(b.along)) >= ((a.depth ?? STAND_DEPTH) + (b.depth ?? STAND_DEPTH)) / 2) return false;
  const span = (s: Stand) => {
    const [l, r] = [s.left, s.right].map((p) => p.clone().sub(mid(b)).setY(0).dot(across));
    return [Math.min(l, r), Math.max(l, r)];
  };
  const [a0, a1] = span(a);
  const [b0, b1] = span(b);
  // A stand under a stacked level fits between the legs of the stand over
  // it, below its crossbar.
  const nested = (inner: Stand, [i0, i1]: number[], outer: Stand, [o0, o1]: number[]) =>
    i0 >= o0 + STAND_LEG && i1 <= o1 - STAND_LEG && Math.max(inner.left.y, inner.right.y) < Math.min(outer.left.y, outer.right.y) - STAND_BEAM;
  if (nested(a, [a0, a1], b, [b0, b1]) || nested(b, [b0, b1], a, [a0, a1])) return false;
  return a0 < b1 && b0 < a1;
}
