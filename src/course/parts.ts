/**
 * JCJC (Japan Cup Junior Circuit) part definitions.
 *
 * Units are millimetres. The dimensions below are provisional and must be
 * checked against measured parts before they are relied on.
 */

/** Number of lanes on a JCJC course. */
export const LANE_COUNT = 3;

/** Width of a single lane (provisional). */
export const LANE_WIDTH_MM = 114;

/** Height of the outer and divider walls (provisional). */
export const WALL_HEIGHT_MM = 50;

/** Thickness of the walls (provisional). */
export const WALL_THICKNESS_MM = 4;

/** Total track width including the outer walls. */
export const TRACK_WIDTH_MM = LANE_COUNT * LANE_WIDTH_MM + (LANE_COUNT + 1) * WALL_THICKNESS_MM;

export type PartKind = 'straight';

export interface StraightPart {
  kind: 'straight';
  id: string;
  name: string;
  lengthMm: number;
}

export type PartDefinition = StraightPart;

export const PARTS: readonly PartDefinition[] = [
  { kind: 'straight', id: 'straight-full', name: 'ストレート', lengthMm: 900 },
  { kind: 'straight', id: 'straight-half', name: 'ハーフストレート', lengthMm: 450 },
];

/** Lateral centre offset (from the track centreline) of lane `index` (0 = left). */
export function laneCenterOffsetMm(index: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= LANE_COUNT) {
    throw new RangeError(`lane index out of range: ${index}`);
  }
  const pitch = LANE_WIDTH_MM + WALL_THICKNESS_MM;
  return (index - (LANE_COUNT - 1) / 2) * pitch;
}
