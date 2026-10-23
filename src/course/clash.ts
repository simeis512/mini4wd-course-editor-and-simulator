import { Box3, Matrix4, Vector3 } from 'three';
import { GLOBAL_SPEC } from './catalog';
import type { Layout } from './course';
import { pointOnFrame } from './geometry';
import { worldTracks, type WorldTrack } from './mesh';
import type { StopperContact } from './stopper-contact';

// Pieces that run into each other, and road too low over a lane below
// (spec 7, #14, #15).

const { fenceHeight, roadThickness } = GLOBAL_SPEC;

/**
 * Room a machine needs under road that crosses over its lane: its height
 * and a margin, mm, from the lane's road up to the underside of the road
 * above (spec 7, provisional).
 */
export const MACHINE_CLEARANCE = 80;
/** Road edges that only touch do not clash: points this far in from an edge are tested, mm. */
const EDGE_MARGIN = 3;
/** Nor do road ends that meet: points must be this far into a track past its ends, mm. */
const END_MARGIN = 2;
/** Overlap allowed between the sample steps of a track, so no point slips between two, mm. */
const STEP_SLACK = 0.5;

/**
 * Two pieces in each other's way. `interference`: they overlap (their road
 * and fences, as a solid up to the fence tops). `clearance`: the road of
 * `upper` crosses over a lane of `lower` with less than the room a machine
 * needs under it. `stopper`: a hose or box on the floor runs into
 * something (stopper-contact.ts, #53).
 */
export type Clash =
  | { kind: 'interference'; pieces: [number, number]; at: Vector3 }
  | { kind: 'clearance'; lower: number; upper: number; at: Vector3; gap: number }
  | StopperContact;

/** A track ready for testing points against: its frames turned round, and its bounds. */
interface Solid {
  track: WorldTrack;
  pos: Vector3[];
  inverse: Matrix4[];
  /** Length of each step to the next sample. */
  steps: number[];
  /** Bounds with room for everything tested against it. */
  box: Box3;
  points: Vector3[];
  pointBox: Box3;
  lanePoints: Vector3[];
  laneBox: Box3;
  volume: Box3;
  clearance: Box3;
}

function solid(track: WorldTrack): Solid {
  const pos = track.samples.map((f) => new Vector3().setFromMatrixPosition(f));
  const reach = Math.max(-track.section.left, track.section.right) + fenceHeight + MACHINE_CLEARANCE;
  const points = solidPoints(track);
  const lanePoints = track.samples.flatMap((f) => lanes(track).map((x) => pointOnFrame(f, x, 0)));
  const steps = pos.slice(1).map((p, i) => p.distanceTo(pos[i]));
  return {
    track,
    pos,
    inverse: track.samples.map((f) => f.clone().invert()),
    steps,
    box: new Box3().setFromPoints(pos).expandByScalar(reach),
    points,
    pointBox: new Box3().setFromPoints(points),
    lanePoints,
    laneBox: new Box3().setFromPoints(lanePoints),
    volume: testBounds(track, steps, -roadThickness, fenceHeight),
    clearance: testBounds(track, steps, -roadThickness - MACHINE_CLEARANCE, -roadThickness),
  };
}

/** Conservative world bounds of all local cells accepted by localTo, at these heights (#87). */
function testBounds(track: WorldTrack, steps: number[], bottom: number, top: number): Box3 {
  const box = new Box3();
  const p = new Vector3();
  const last = track.samples.length - 1;
  track.samples.forEach((frame, i) => {
    const lo = i > 0 ? -steps[i - 1] / 2 - STEP_SLACK : END_MARGIN;
    const hi = i < last ? steps[i] / 2 + STEP_SLACK : -END_MARGIN;
    for (const x of [-track.section.right, -track.section.left]) {
      for (const y of [bottom, top]) {
        for (const z of [lo, hi]) box.expandByPoint(p.set(x, y, z).applyMatrix4(frame));
      }
    }
  });
  // Cover floating-point roundoff in the inverse transform, not physical clearance.
  return box.expandByScalar(Number.EPSILON * Math.max(1, box.min.length(), box.max.length()) * 16);
}

/**
 * Where a world point is, seen from the track: across its road (+ right),
 * up from its road surface, and along it; null when it is beyond the
 * track's ends. Uses the nearest sample's frame, or one beside it.
 */
function localTo(s: Solid, p: Vector3): { right: number; up: number } | null {
  if (!s.box.containsPoint(p)) return null;
  let k = 0;
  let best = Infinity;
  s.pos.forEach((q, i) => {
    const d = q.distanceToSquared(p);
    if (d < best) [best, k] = [d, i];
  });
  const last = s.pos.length - 1;
  const local = new Vector3();
  for (const i of [k, k - 1, k + 1]) {
    if (i < 0 || i > last) continue;
    local.copy(p).applyMatrix4(s.inverse[i]);
    const lo = i > 0 ? -s.steps[i - 1] / 2 - STEP_SLACK : END_MARGIN;
    const hi = i < last ? s.steps[i] / 2 + STEP_SLACK : -END_MARGIN;
    if (local.z >= lo && local.z <= hi) return { right: -local.x, up: local.y };
  }
  return null;
}

/** Points of a track's solid to test against others: its road top and underside, and its fence tops. */
function solidPoints(t: WorldTrack): Vector3[] {
  const { left, right, fences } = t.section;
  const inside = (x: number) => Math.min(right - EDGE_MARGIN, Math.max(left + EDGE_MARGIN, x));
  const across = [left + EDGE_MARGIN, ...fences.slice(1, -1), ...lanes(t), right - EDGE_MARGIN];
  return t.samples.flatMap((f) => [
    ...across.flatMap((x) => [pointOnFrame(f, x, 0), pointOnFrame(f, x, -roadThickness)]),
    ...fences.map((x) => pointOnFrame(f, inside(x), fenceHeight)),
  ]);
}

/** Lane centres of a track, across its centreline (+ right). */
function lanes(t: WorldTrack): number[] {
  const { fences } = t.section;
  // A lane lies between each pair of neighbouring fences.
  return fences.slice(1).map((x, i) => (x + fences[i]) / 2);
}

/** Whether a point lies in a track's solid: its road and the space up to its fence tops. */
function inSolid(s: Solid, p: Vector3): boolean {
  const at = localTo(s, p);
  return !!at && at.right >= s.track.section.left && at.right <= s.track.section.right && at.up >= -roadThickness && at.up <= fenceHeight;
}

/**
 * Room under `upper` over each lane centre of `lower`, mm: the smallest
 * and where it is; null when `upper` does not cross over a lane of it.
 */
function lowestGap(lower: Solid, upper: Solid): { gap: number; at: Vector3 } | null {
  if (!lower.laneBox.intersectsBox(upper.clearance)) return null;
  let out: { gap: number; at: Vector3 } | null = null;
  for (const p of lower.lanePoints) {
    const at = localTo(upper, p);
    if (!at || at.right < upper.track.section.left || at.right > upper.track.section.right || at.up > -roadThickness) continue;
    const gap = -at.up - roadThickness;
    if (!out || gap < out.gap) out = { gap, at: p };
  }
  return out;
}

/**
 * Pieces in each other's way (spec 7): overlapping (#14), or road crossing
 * over a lane with too little room under it (#15). Each pair of pieces is
 * reported once per kind. A piece's own tracks (the lane change bridge
 * over its lower lanes) are made that way; pieces joined to each other
 * only touch at the joint, so they are not tested for overlapping.
 */
export function findClashes(layout: Layout): Clash[] {
  const tracks = worldTracks(layout);
  const solids = tracks.map(solid);
  const joined = new Set(layout.joints.map((j) => pairKey(j.a.piece, j.b.piece)));
  const clashes: Clash[] = [];
  const found = new Set<string>();
  for (let a = 0; a < solids.length; a++) {
    for (let b = a + 1; b < solids.length; b++) {
      const [pa, pb] = [tracks[a].piece, tracks[b].piece];
      if (pa === pb || !solids[a].box.intersectsBox(solids[b].box)) continue;
      const key = pairKey(pa, pb);
      if (!joined.has(key) && !found.has(`i${key}`)) {
        const hit = (solids[a].pointBox.intersectsBox(solids[b].volume) ? solids[a].points.find((p) => inSolid(solids[b], p)) : undefined) ??
          (solids[b].pointBox.intersectsBox(solids[a].volume) ? solids[b].points.find((p) => inSolid(solids[a], p)) : undefined);
        if (hit) {
          found.add(`i${key}`);
          clashes.push({ kind: 'interference', pieces: [Math.min(pa, pb), Math.max(pa, pb)], at: hit });
        }
      }
      if (found.has(`i${key}`)) continue;
      for (const [lower, upper] of [
        [a, b],
        [b, a],
      ]) {
        const low = lowestGap(solids[lower], solids[upper]);
        if (!low || low.gap >= MACHINE_CLEARANCE) continue;
        const ckey = `c${tracks[lower].piece}>${tracks[upper].piece}`;
        const prev = clashes.findIndex((c) => c.kind === 'clearance' && `c${c.lower}>${c.upper}` === ckey);
        const clash: Clash = { kind: 'clearance', lower: tracks[lower].piece, upper: tracks[upper].piece, at: low.at, gap: low.gap };
        if (prev < 0) clashes.push(clash);
        else if (low.gap < (clashes[prev] as { gap: number }).gap) clashes[prev] = clash;
        found.add(ckey);
      }
    }
  }
  // A pair that overlaps somewhere is reported as that alone.
  return clashes.filter((c) => c.kind !== 'clearance' || !found.has(`i${pairKey(c.lower, c.upper)}`));
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}
