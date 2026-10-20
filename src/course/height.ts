import { Vector3 } from 'three';
import { GLOBAL_SPEC } from './catalog';
import type { Layout } from './course';
import { pointOnFrame } from './geometry';
import { insidePolygon, worldTracks, type WorldTrack } from './mesh';

const { roadThickness, fenceThickness } = GLOBAL_SPEC;

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

/**
 * A stand under raised road (spec 3.4, 14): a slab across the road from the
 * floor up to the road's underside, which it follows when the road leans.
 */
export interface Support {
  piece: number;
  /** Underside of the road at its left and right edges, world mm. */
  left: Vector3;
  right: Vector3;
  /** Level direction along the road, unit. */
  along: Vector3;
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

/** Whether some other road lies under the point (x, z) lower than `y`. */
function roadBelow(footprints: readonly Footprint[], own: WorldTrack, x: number, z: number, y: number): boolean {
  return footprints.some(
    ({ track, quads, box }) =>
      track !== own &&
      x >= box[0] && x <= box[1] && z >= box[2] && z <= box[3] &&
      quads.some((q) => q.surface < y && insidePolygon(x, z, q.poly)),
  );
}

/**
 * Supports under raised road (#11): a part's own stands, and on other
 * parts, stands under every stretch of raised road, evenly spaced along
 * each track, at most `SUPPORT_SPACING` apart and none at the joints, so
 * neighbouring pieces never stand two in one place. Where other road runs
 * underneath (a bridge, a stacked level) the stand would block it, so the
 * road is left to span the gap instead.
 */
export function supports(layout: Layout, tracks: readonly WorldTrack[] = worldTracks(layout)): Support[] {
  const footprints = tracks.map(footprintOf);
  const out: Support[] = [];
  // Parts that come with their own stands get only those.
  layout.pieces.forEach((pc, piece) => {
    for (const s of pc.part.supports ?? []) {
      const along = new Vector3(0, 0, 1).transformDirection(pc.matrix).setY(0).normalize();
      const [left, right] = [s.left, s.right].map((p) => new Vector3(...p).applyMatrix4(pc.matrix));
      out.push({ piece, left, right, along });
    }
  });
  for (const track of tracks) {
    if (layout.pieces[track.piece].part.supports) continue;
    const { samples, section } = track;
    const length = samples.reduce(
      (sum, f, i) => (i === 0 ? 0 : sum + new Vector3().setFromMatrixPosition(f).distanceTo(new Vector3().setFromMatrixPosition(samples[i - 1]))),
      0,
    );
    const count = Math.max(1, Math.ceil(length / SUPPORT_SPACING));
    for (let k = 0; k < count; k++) {
      const f = samples[Math.round(((k + 0.5) / count) * (samples.length - 1))];
      const left = pointOnFrame(f, section.left, -roadThickness);
      const right = pointOnFrame(f, section.right, -roadThickness);
      if (Math.max(left.y, right.y) <= SUPPORT_MIN_GAP) continue;
      // Look under both sides and the middle, inside the outer fences, which
      // side-by-side tracks share.
      const inset = fenceThickness + 1;
      const probes = [section.left + inset, (section.left + section.right) / 2, section.right - inset].map((x) => pointOnFrame(f, x, 0));
      const top = Math.min(left.y, right.y);
      if (probes.some((p) => roadBelow(footprints, track, p.x, p.z, top))) continue;
      const along = new Vector3(0, 0, 1).transformDirection(f).setY(0);
      if (along.lengthSq() < 1e-9) continue;
      out.push({ piece: track.piece, left, right, along: along.normalize() });
    }
  }
  return out;
}
