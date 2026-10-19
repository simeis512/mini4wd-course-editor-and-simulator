/**
 * Road-surface profiles (spec 3.1 `heightProfile`): how far the road
 * surface rises above the centreline frame along a segment.
 *
 * The wave's bumps have not been measured yet (jcjc-parts.json leaves
 * bumpCount and bumpHeight unknown), so its shape is provisional.
 */

export interface HeightProfile {
  /** Height of the road surface above the centreline at `s` mm into a segment of `length` mm. */
  height(s: number, length: number): number;
  /** Longest sampling step that still draws the profile smoothly, mm. */
  maxStep: number;
}

/** Provisional wave: number of bumps and their height, mm. */
export const WAVE_BUMPS = 3;
export const WAVE_HEIGHT = 8;

const PROFILES: Record<string, HeightProfile> = {
  // Raised-cosine bumps: level and at zero height at both ends, so the
  // joints line up with a straight.
  wave: {
    height: (s, length) => {
      const t = Math.min(Math.max(s / length, 0), 1);
      return (WAVE_HEIGHT / 2) * (1 - Math.cos(2 * Math.PI * WAVE_BUMPS * t));
    },
    maxStep: 5,
  },
};

export function heightProfile(id: string): HeightProfile {
  const p = PROFILES[id];
  if (!p) throw new Error(`unknown height profile: ${id}`);
  return p;
}
