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

const supportCache = new WeakMap<Layout, SupportState>();
type Box = [number, number, number, number];
interface PlacedStand {
  support: Support;
  frame: StandFrame;
  poly: [number, number][];
  box: Box;
}
interface SupportStep {
  cells: Map<string, RoadQuad[] | undefined>;
  regions: Box[];
  probes: StandFrame[];
  dependencies: PlacedStand[];
  stands: PlacedStand[];
}
interface SupportState {
  tracks: readonly WorldTrack[];
  road: RoadIndex;
  steps: Map<WorldTrack, SupportStep>;
  result: Support[];
}
const intersects = (a: Box, b: Box) => a[0] <= b[1] && a[1] >= b[0] && a[2] <= b[3] && a[3] >= b[2];
const sameItems = <T>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Include the legacy duplicate-frame test even outside the leg-probe regions (#92). */
function dependencies(step: SupportStep, stands: PlacedStand[]): PlacedStand[] {
  return stands.filter((s) => step.regions.some((r) => intersects(r, s.box)) || step.probes.some((p) => overlaps(s.frame, p)));
}

/** An invalidated probe can still choose the same stand: stop propagation there (#92). */
function sameStand(a: Support, b: Support): boolean {
  return a.piece === b.piece && a.depth === b.depth && a.left.equals(b.left) && a.right.equals(b.right) && a.along.equals(b.along);
}

/** One road sample step, with its conservative highest surface. */
interface RoadQuad {
  track: WorldTrack;
  poly: [number, number][];
  surface: number;
  box: Box;
}

/** Grid granularity only; polygon/height tests still decide contacts exactly (#87). */
const ROAD_CELL = SUPPORT_SPACING;
type RoadIndex = Map<string, RoadQuad[]>;
const cellKey = (x: number, z: number) => `${Math.floor(x / ROAD_CELL)}:${Math.floor(z / ROAD_CELL)}`;

function indexRoad(index: RoadIndex, track: WorldTrack): void {
  const { samples, section } = track;
  const p = new Vector3();
  const edge = (x: number) => samples.map((f) => pointOnFrame(f, x, 0, p).clone());
  const left = edge(section.left);
  const right = edge(section.right);
  for (let i = 0; i + 1 < samples.length; i++) {
    const corners = [left[i], left[i + 1], right[i + 1], right[i]];
    const quad: RoadQuad = {
      track, poly: corners.map((c): [number, number] => [c.x, c.z]), surface: Math.max(...corners.map((c) => c.y)),
      box: [Math.min(...corners.map((c) => c.x)), Math.max(...corners.map((c) => c.x)), Math.min(...corners.map((c) => c.z)), Math.max(...corners.map((c) => c.z))],
    };
    const xs = corners.map((c) => c.x / ROAD_CELL);
    const zs = corners.map((c) => c.z / ROAD_CELL);
    for (let x = Math.floor(Math.min(...xs)); x <= Math.floor(Math.max(...xs)); x++) {
      for (let z = Math.floor(Math.min(...zs)); z <= Math.floor(Math.max(...zs)); z++) {
        const key = `${x}:${z}`;
        const cell = index.get(key);
        if (cell) cell.push(quad);
        else index.set(key, [quad]);
      }
    }
  }
}

/** Highest surface of other road under the point (x, z) and lower than `y`, or -Infinity when there is none. */
function roadBelow(index: RoadIndex, cells: SupportStep['cells'], own: WorldTrack, x: number, z: number, y: number): number {
  let top = -Infinity;
  const key = cellKey(x, z);
  const cell = index.get(key);
  cells.set(key, cell);
  for (const q of cell ?? []) {
    if (q.track !== own && q.surface < y && q.surface > top && x >= q.box[0] && x <= q.box[1] && z >= q.box[2] && z <= q.box[3] && insidePolygon(x, z, q.poly)) top = q.surface;
  }
  return top;
}

/** Copy only edited grid cells; old layouts and their dependency records remain valid (#92). */
function updateRoad(tracks: readonly WorldTrack[], previous?: SupportState): RoadIndex {
  const road: RoadIndex = new Map(previous?.road);
  const current = new Set(tracks);
  for (const [key, cell] of road) {
    if (cell.some((q) => !current.has(q.track))) {
      const kept = cell.filter((q) => current.has(q.track));
      if (kept.length) road.set(key, kept);
      else road.delete(key);
    }
  }
  const old = new Set(previous?.tracks);
  const added: RoadIndex = new Map();
  for (const track of tracks) if (!old.has(track)) indexRoad(added, track);
  for (const [key, cell] of added) road.set(key, [...(road.get(key) ?? []), ...cell]);
  return road;
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
export function supports(layout: Layout, tracks: readonly WorldTrack[] = worldTracks(layout), previous?: Layout | null): Support[] {
  const cached = supportCache.get(layout);
  if (cached?.tracks === tracks) return cached.result;
  const state = computeSupports(layout, tracks, previous ? supportCache.get(previous) : undefined);
  supportCache.set(layout, state);
  return state.result;
}

/** Shared read-only per layout; a new edit always produces a new layout (#87). */
function computeSupports(layout: Layout, tracks: readonly WorldTrack[], previous?: SupportState): SupportState {
  const road = updateRoad(tracks, previous);
  const stands: PlacedStand[] = [];
  const steps = new Map<WorldTrack, SupportStep>();
  // Lowest road first, so stands under a stacked level are in place before
  // the stands that straddle that level are fitted round them.
  const heights = new Map(tracks.map((t) => [t, Math.min(...t.samples.map((f) => f.elements[13]))]));
  for (const track of [...tracks].sort((p, q) => heights.get(p)! - heights.get(q)!)) {
    // Parts that come with their own stands (`partStands`) stand on them;
    // only their main road is held up when the whole piece is raised.
    if (layout.pieces[track.piece].part.supports && track.index !== 0) continue;
    const old = previous?.steps.get(track);
    if (old && [...old.cells].every(([key, cell]) => road.get(key) === cell) && sameItems(old.dependencies, dependencies(old, stands))) {
      steps.set(track, old);
      stands.push(...old.stands);
      continue;
    }
    const step: SupportStep = { cells: new Map(), regions: [], probes: [], dependencies: [], stands: [] };
    const prior = stands.slice();
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
      // Every leg/crossbar probe is within this conservative radius of the frame.
      // Keep the original order and exact polygon tests, excluding only distant stands (#87).
      const radius = Math.max(Math.abs(section.left), Math.abs(section.right)) + SUPPORT_OVERHANG + SUPPORT_REACH +
        STAND_LEG + 2 * SUPPORT_CLEARANCE + STAND_DEPTH;
      const [cx, cz] = [f.elements[12], f.elements[14]];
      step.regions.push([cx - radius, cx + radius, cz - radius, cz + radius]);
      const near = (box: readonly number[]) => box[0] <= cx + radius && box[1] >= cx - radius && box[2] <= cz + radius && box[3] >= cz - radius;
      const nearbyStands = stands.filter((s) => near(s.box));
      // Adjacent candidate legs test the same across-road positions repeatedly (#87).
      const belowCache = new Map<number, number>();
      const standCache = new Map<number, boolean>();
      // Look across the whole depth of the stand: where it meets road below
      // at an angle, its corners reach further than its middle.
      const below = (x: number) => {
        const cached = belowCache.get(x);
        if (cached !== undefined) return cached;
        const p = pointOnFrame(f, x, 0);
        let y = -Infinity;
        for (const d of [-STAND_DEPTH / 2, 0, STAND_DEPTH / 2]) {
          y = Math.max(y, roadBelow(road, step.cells, track, p.x + along.x * d, p.z + along.z * d, top));
        }
        belowCache.set(x, y);
        return y;
      };
      // Whether a stand already placed stands at `x` across the road, anywhere along the stand's depth.
      const onStand = (x: number) => {
        const cached = standCache.get(x);
        if (cached !== undefined) return cached;
        const p = pointOnFrame(f, x, 0);
        const hit = [-STAND_DEPTH / 2, 0, STAND_DEPTH / 2].some((d) => {
          const [x, z] = [p.x + along.x * d, p.z + along.z * d];
          return nearbyStands.some(({ poly, box }) => x >= box[0] && x <= box[1] && z >= box[2] && z <= box[3] && insidePolygon(x, z, poly));
        });
        standCache.set(x, hit);
        return hit;
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
      // A leg is as wide as STAND_LEG seen from above; on a steep bank the
      // road over its inner side is lower than over its outer side, so its
      // top goes no higher than either (#113).
      const level = Math.hypot(f.elements[0], f.elements[2]) || 1;
      const legTop = (x: number, side: -1 | 1) => {
        const outer = cornerTop(x);
        return outer.setY(Math.min(outer.y, cornerTop(x - (side * STAND_LEG) / level).y));
      };
      const left = legTop(a, -1);
      const right = legTop(b, 1);
      // The crossbar must pass over any road between the legs.
      let under = -Infinity;
      for (let x = a; x <= b; x += SCAN_STEP) under = Math.max(under, below(x));
      if (under > -Infinity && Math.min(left.y, right.y) - STAND_BEAM < under + fenceHeight + SUPPORT_CLEARANCE) continue;
      const stand = { piece: track.piece, left, right, along };
      // Tracks side by side (a ramp beside its lower lanes) can ask for
      // stands in the same place: keep the first.
      const frame = standFrame(stand);
      step.probes.push(frame);
      if (stands.some((o) => overlaps(o.frame, frame))) continue;
      const poly = standCorners(stand);
      const xs = poly.map((p) => p[0]);
      const zs = poly.map((p) => p[1]);
      const placed: PlacedStand = { support: stand, frame, poly, box: [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)] };
      stands.push(placed);
      step.stands.push(placed);
    }
    if (old && old.stands.length === step.stands.length && step.stands.every((s, i) => sameStand(s.support, old.stands[i].support))) {
      stands.splice(stands.length - step.stands.length, step.stands.length, ...old.stands);
      step.stands = old.stands;
    }
    step.dependencies = dependencies(step, prior);
    steps.set(track, step);
  }
  return { tracks, road, steps, result: stands.map((s) => s.support).sort((p, q) => p.piece - q.piece) };
}

/** The corners of a stand seen from above, X/Z. */
function standCorners(s: Stand): [number, number][] {
  const d = s.along.clone().multiplyScalar((s.depth ?? STAND_DEPTH) / 2);
  return [s.left.clone().sub(d), s.right.clone().sub(d), s.right.clone().add(d), s.left.clone().add(d)].map((v): [number, number] => [v.x, v.z]);
}

interface StandFrame {
  stand: Stand;
  middle: Vector3;
  across: Vector3;
}

function standFrame(stand: Stand): StandFrame {
  return {
    stand,
    middle: stand.left.clone().add(stand.right).multiplyScalar(0.5).setY(0),
    across: stand.right.clone().sub(stand.left).setY(0).normalize(),
  };
}

/** Whether two stands' footprints overlap, seen from above. */
function overlaps(af: StandFrame, bf: StandFrame): boolean {
  const [a, b] = [af.stand, bf.stand];
  // The along test rejects most pairs; avoid allocating vectors for those (#87).
  const dx = af.middle.x - bf.middle.x;
  const dz = af.middle.z - bf.middle.z;
  if (Math.abs(dx * b.along.x + dz * b.along.z) >= ((a.depth ?? STAND_DEPTH) + (b.depth ?? STAND_DEPTH)) / 2) return false;
  const span = (s: Stand) => {
    const [l, r] = [s.left, s.right].map((p) => (p.x - bf.middle.x) * bf.across.x + (p.z - bf.middle.z) * bf.across.z);
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
