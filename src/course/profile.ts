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
  /** Height above the centreline at `s`, for road that also climbs (the lane change bridge). */
  rise?(s: number, length: number): number;
  /** d(rise)/ds at `s`. */
  riseSlope?(s: number, length: number): number;
  /** Longest sampling step that still draws the profile smoothly, mm. */
  maxStep: number;
}

/** Provisional wave amplitude (peak sideways offset), mm. */
export const WAVE_AMPLITUDE = 30;

/** Peak road height of the lane change bridge (unmeasured, provisional). */
export const BRIDGE_HEIGHT = 100;
/** Floor length of each lane change piece; F + centre + F span 1620 (inferred). */
export const LANE_CHANGE_LENGTH = 540;
/**
 * The bridge reaches about a third of a piece into each approach (official
 * top view of 69579).
 */
export const BRIDGE_OVERLAP = LANE_CHANGE_LENGTH / 3;
/** Floor length the upper lane climbs over on the approach, up to the bridge joint. */
export const RAMP_RUN = LANE_CHANGE_LENGTH - BRIDGE_OVERLAP;
/** Floor length of the bridge (both E pieces). */
export const BRIDGE_RUN = LANE_CHANGE_LENGTH + 2 * BRIDGE_OVERLAP;
const LANE_CHANGE_SPAN = 3 * LANE_CHANGE_LENGTH;

/**
 * Height of the upper lane `u` mm from the start of the entry approach: one
 * gentle hump over the whole lane change, level on the floor at both ends
 * and highest over the middle of the centre (official photo of 69579; the
 * curve itself is provisional).
 */
export function bridgeRise(u: number): number {
  return (BRIDGE_HEIGHT / 2) * (1 - Math.cos((2 * Math.PI * u) / LANE_CHANGE_SPAN));
}

export function bridgeRiseSlope(u: number): number {
  return ((BRIDGE_HEIGHT * Math.PI) / LANE_CHANGE_SPAN) * Math.sin((2 * Math.PI * u) / LANE_CHANGE_SPAN);
}

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
  // The upper lane climbing the approach, straight in plan.
  'lc-ramp': {
    offset: () => 0,
    slope: () => 0,
    rise: (s) => bridgeRise(s),
    riseSlope: (s) => bridgeRiseSlope(s),
    maxStep: 10,
  },
  // The bridge: over the top of the hump while crossing to the left edge.
  'lc-over': {
    ...step(240),
    rise: (s) => bridgeRise(s + RAMP_RUN),
    riseSlope: (s) => bridgeRiseSlope(s + RAMP_RUN),
  },
};

export function lateralProfile(id: string): LateralProfile {
  const p = PROFILES[id];
  if (!p) throw new Error(`unknown lateral profile: ${id}`);
  return p;
}
