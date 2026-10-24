import type { Vector3 } from 'three';
import { roadOutline, trackEdge, type WorldTrack } from '../course/mesh';

/** One stretch of road of a piece, as seen from above. */
export interface Outline {
  piece: number;
  /** Left edge then right edge reversed: a closed polygon in world X/Z. */
  polygon: [number, number][];
  fences: [number, number][][];
  /** Mean road height, mm; higher pieces are drawn over lower ones. */
  height: number;
  /** The road cut at each sample step, with its mean height, for colouring by height. */
  steps: { polygon: [number, number][]; height: number }[];
}

const outlineCache = new WeakMap<WorldTrack, Outline>();

/** The road of every track as seen from above, shared for unchanged world tracks (#92). */
export function outlinesOf(tracks: readonly WorldTrack[]): Outline[] {
  return tracks.map((track) => {
    const cached = outlineCache.get(track);
    if (cached) return cached;
    const { piece, samples, section } = track;
    const left = trackEdge(samples, section.left).map(xz);
    const right = trackEdge(samples, section.right).map(xz);
    const outline: Outline = {
      piece,
      polygon: roadOutline(samples, section).map(xz),
      fences: section.fences.map((x) => trackEdge(samples, x).map(xz)),
      height: samples.reduce((sum, f) => sum + f.elements[13], 0) / samples.length,
      steps: samples.slice(1).map((f, i) => ({
        polygon: [left[i], left[i + 1], right[i + 1], right[i]],
        height: (f.elements[13] + samples[i].elements[13]) / 2,
      })),
    };
    outlineCache.set(track, outline);
    return outline;
  });
}

/** Outline indices from the lowest road to the highest; pieces at the same height keep their order. */
export function lowestFirst(outlines: readonly Outline[]): number[] {
  return outlines.map((_, i) => i).sort((a, b) => outlines[a].height - outlines[b].height);
}

export function xz(v: Vector3): [number, number] {
  return [v.x, v.z];
}

