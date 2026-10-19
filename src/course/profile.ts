/**
 * Lateral profiles (spec 3.1): how far a segment's lanes swing sideways
 * from its straight centreline, as with the wave section.
 *
 * The wave has one bump per piece, so chained waves repeat the same swing
 * (user, 2026-10-19). Its amplitude has not been measured yet, so the
 * value below is provisional.
 */

export interface LateralProfile {
  /** Offset to the left (+) at `s` mm into a segment of `length` mm. */
  offset(s: number, length: number): number;
  /** d(offset)/ds at `s`. */
  slope(s: number, length: number): number;
  /** Longest sampling step that still draws the profile smoothly, mm. */
  maxStep: number;
}

/** Provisional wave amplitude (peak sideways offset), mm. */
export const WAVE_AMPLITUDE = 30;

/**
 * A smooth sideways step of `shift` mm (+ left) over the whole segment, level
 * at both ends: the lane change's bridges and the road under them.
 */
function step(shift: number): LateralProfile {
  return {
    offset: (s, length) => (shift / 2) * (1 - Math.cos((Math.PI * s) / length)),
    slope: (s, length) => ((shift * Math.PI) / (2 * length)) * Math.sin((Math.PI * s) / length),
    maxStep: 10,
  };
}

const PROFILES: Record<string, LateralProfile> = {
  // One raised-cosine bump: on the straight line and parallel to it at both
  // ends, so the joints line up with a straight.
  wave: {
    offset: (s, length) => (WAVE_AMPLITUDE / 2) * (1 - Math.cos((2 * Math.PI * s) / length)),
    slope: (s, length) => ((WAVE_AMPLITUDE * Math.PI) / length) * Math.sin((2 * Math.PI * s) / length),
    maxStep: 10,
  },
  // Lane change centre (spec 3.5): the two lower lanes move one lane to the
  // right under the bridge while the upper lane crosses from the right edge
  // to the left edge.
  'lc-under': step(-120),
  'lc-over': step(240),
};

export function lateralProfile(id: string): LateralProfile {
  const p = PROFILES[id];
  if (!p) throw new Error(`unknown lateral profile: ${id}`);
  return p;
}
