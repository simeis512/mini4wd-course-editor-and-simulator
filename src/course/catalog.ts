/**
 * JCJC (Japan Cup Junior Circuit) part catalog.
 *
 * Units are millimetres and degrees. Values come from
 * jcjc-parts.json in the project research; many are inferred from official
 * totals and still need measuring against real parts (see `confidence`).
 */

import type { LaneLink, PartDef, PortDef, Variant } from './part';
import {
  BRIDGE_HEIGHT,
  BRIDGE_OVERLAP,
  BRIDGE_RUN,
  bridgeRise,
  bridgeRiseSlope,
  LANE_CHANGE_LENGTH,
  RAMP_RUN,
  WAVE_AMPLITUDE,
} from './profile';

/** Track-wide dimensions shared by every part. */
export const GLOBAL_SPEC = {
  laneCount: 3,
  /** Centre-to-centre distance between adjacent lanes (inferred). */
  lanePitch: 120,
  /** Driving surface width of one lane (official). */
  laneWidth: 115,
  /** Fence height above the road surface (official). */
  fenceHeight: 50,
  /** Fence / divider thickness (inferred from lanePitch − laneWidth). */
  fenceThickness: 5,
  /** Thickness of the road slab drawn under the surface (cosmetic). */
  roadThickness: 3,
} as const;

const PALETTE = {
  gray: { id: 'gray', name: 'グレー（旧）', color: '#9a9ca0', material: 'old-gray' },
  white: { id: 'white', name: 'ホワイト', color: '#f2f2ef', material: 'current' },
  black: { id: 'black', name: 'ブラック', color: '#2a2a2d', material: 'current' },
  red: { id: 'red', name: 'レッド', color: '#d8323a', material: 'current' },
  blue: { id: 'blue', name: 'ブルー', color: '#2f6fd6', material: 'current' },
  green: { id: 'green', name: 'グリーン', color: '#2f9a4a', material: 'current' },
  yellow: { id: 'yellow', name: 'イエロー', color: '#f0c419', material: 'current' },
  orange: { id: 'orange', name: 'オレンジ', color: '#ee7d22', material: 'current' },
} as const satisfies Record<string, Variant>;

const ALL_LANES = [0, 1, 2];

/** Plain two-ended part carrying all three lanes. */
function twoEnded(): PortDef[] {
  return [
    { id: 'a', anchor: 'start', lanes: ALL_LANES },
    { id: 'b', anchor: 'end', lanes: ALL_LANES },
  ];
}

const STRAIGHT_LENGTH = 540;
const CURVE_RADIUS = 540;
const CURVE_ANGLE = 45;
/** Short ramp; roughly a third of a straight judging by product photos (inferred). */
const BANK_APPROACH_LENGTH = 180;
/** Height the slope climbs (official). */
const SLOPE_DROP = 110;
/** One level of a raised course: the height a slope climbs (user, 2026-10-20). */
export const LEVEL_HEIGHT = SLOPE_DROP;
/** Floor length of the slope: the same as a straight (per the user; unmeasured). */
const SLOPE_RUN = STRAIGHT_LENGTH;
/**
 * Provisional S shape: a concave arc into the climb and a convex arc back to
 * level, meeting halfway up. Two equal arcs that each rise half the drop over
 * half the run turn through 2·atan(rise / run).
 */
const SLOPE_PITCH = (2 * Math.atan(SLOPE_DROP / SLOPE_RUN) * 180) / Math.PI;
const SLOPE_ARC_LENGTH = ((SLOPE_RUN / 2) * ((SLOPE_PITCH * Math.PI) / 180)) / Math.sin((SLOPE_PITCH * Math.PI) / 180);

/** Height and gradient (deg) of the upper lane at the bridge joints, a third into each approach. */
const JOINT_HEIGHT = bridgeRise(RAMP_RUN);
const JOINT_PITCH = (Math.atan(bridgeRiseSlope(RAMP_RUN)) * 180) / Math.PI;
/** Lateral offset of the right-hand lane, as a part-local X (+ X is left). */
const RIGHT_LANE_X = -laneOffset(2);
/**
 * Size of the lane change's own bridge support, mm: wider than the two lower
 * lanes with room beside their fences, and about one lane deep (user, from
 * the real part, 2026-10-20; the exact sizes are provisional, #1).
 */
const LANE_CHANGE_SUPPORT_HALF = (2 * GLOBAL_SPEC.lanePitch + GLOBAL_SPEC.fenceThickness) / 2 + 25;
const LANE_CHANGE_SUPPORT_DEPTH = GLOBAL_SPEC.lanePitch;
/**
 * Top of that support, mm: a little under the top of the bridge, whose
 * underside curves down away from the top (user, 2026-10-20; provisional).
 */
const LANE_CHANGE_SUPPORT_TOP = BRIDGE_HEIGHT - GLOBAL_SPEC.roadThickness - 15;
const LANE_CHANGE_NOTE = `橋がアプローチ側へ約1/3入り込み、全体で1つのなだらかな山になる形は公式の図・写真どおり。寸法は未計測のため仮（橋の最高点${BRIDGE_HEIGHT}、各ピースの床の長さ${LANE_CHANGE_LENGTH}）`;

export const PARTS: readonly PartDef[] = [
  {
    id: 'straight',
    name: 'ストレート',
    setCode: 'A',
    segments: [{ length: STRAIGHT_LENGTH }],
    ports: twoEnded(),
    lanes: ALL_LANES,
    // Variant order is part of the URL format: append only.
    variants: [PALETTE.white, PALETTE.gray, PALETTE.black],
    defaultVariant: 0,
    confidence: 'community',
  },
  {
    id: 'curve45',
    name: '45°カーブ',
    setCode: 'B',
    segments: [{ length: (Math.PI * CURVE_RADIUS * CURVE_ANGLE) / 180, yaw: CURVE_ANGLE }],
    ports: twoEnded(),
    lanes: ALL_LANES,
    ways: ['左', '右'],
    variants: [PALETTE.red, PALETTE.blue, PALETTE.gray, PALETTE.green, PALETTE.black, PALETTE.yellow],
    defaultVariant: 0,
    confidence: 'inferred',
  },
  {
    id: 'wave',
    name: 'ウェーブ',
    setCode: 'C',
    segments: [{ length: STRAIGHT_LENGTH, lateralProfile: 'wave' }],
    ports: twoEnded(),
    lanes: ALL_LANES,
    ways: ['左', '右'],
    variants: [PALETTE.white, PALETTE.gray, PALETTE.black],
    defaultVariant: 0,
    confidence: 'inferred',
    note: `横に1回うねる形。振幅は未計測のため仮の値（${WAVE_AMPLITUDE}）`,
  },
  {
    // A ramp up to a 20° incline (spec 14). Curves joined after it lie in
    // the inclined plane, so a U-turn rises to a 20° bank at its middle and
    // comes back down; the exit is the same part placed the other way round.
    id: 'bank-approach-20',
    name: 'バンクアプローチ20',
    segments: [{ length: BANK_APPROACH_LENGTH, pitch: 20 }],
    // The low end goes on the floor; the high end only takes the inclined course.
    ports: [
      { id: 'a', anchor: 'start', lanes: ALL_LANES, floor: true },
      { id: 'b', anchor: 'end', lanes: ALL_LANES },
    ],
    cannotJoin: ['bank-approach-20'],
    lanes: ALL_LANES,
    variants: [PALETTE.red, PALETTE.orange, PALETTE.black],
    defaultVariant: 0,
    confidence: 'inferred',
    note: '長さと坂の曲がり方は未計測のため仮形状（長さ180、0°→20°へ一定に上る）',
  },
  {
    // Slope section: level at both ends, climbing 110 mm in an S between them
    // (spec 3.4). Going down is the same part turned round; the official
    // photo puts two face to face to make a hill.
    id: 'slope',
    name: 'スロープ',
    segments: [
      { length: SLOPE_ARC_LENGTH, pitch: SLOPE_PITCH },
      { length: SLOPE_ARC_LENGTH, pitch: -SLOPE_PITCH },
    ],
    ports: twoEnded(),
    lanes: ALL_LANES,
    ways: ['上り', '下り'],
    variants: [PALETTE.red, PALETTE.orange],
    defaultVariant: 0,
    confidence: 'inferred',
    note: `落差110のみ確定。曲がり方は未計測のため仮形状（床の長さ540、最大${SLOPE_PITCH.toFixed(1)}°のS字）`,
  },
  {
    // Lane change entry (F, spec 3.5): three lanes come in, the right-hand
    // lane climbs towards the bridge and the other two carry on underneath.
    // The climb and the bridge make one smooth hump, so the upper port is on
    // the slope. The
    // exit is the same part the other way round. On its own, with the upper
    // and lower ports left open, it works as a jump ramp.
    id: 'bridge-approach',
    name: 'ブリッジアプローチ',
    setCode: 'F',
    segments: [{ length: LANE_CHANGE_LENGTH }],
    lanes: [0, 1],
    tracks: [
      {
        start: { pos: [RIGHT_LANE_X, 0, 0], rot: [0, 0, 0] },
        segments: [{ length: RAMP_RUN, lateralProfile: 'lc-ramp' }],
        lanes: [1],
      },
    ],
    ports: [
      { id: 'a', anchor: 'start', lanes: ALL_LANES },
      // Its lower and upper ends also join ordinary parts, for home-made
      // lane changes and one-lane jumps (#60).
      { id: 'lower', anchor: 'end', lanes: [0, 1], kind: 'lc-lower' },
      {
        id: 'upper',
        anchor: { pos: [RIGHT_LANE_X, JOINT_HEIGHT, RAMP_RUN], rot: [0, JOINT_PITCH, 0] },
        lanes: [2],
        kind: 'lc-upper',
      },
    ],
    laneLinks: [
      { from: [0, 0], to: [1, 0] },
      { from: [0, 1], to: [1, 1] },
      { from: [0, 2], to: [2, 2] },
    ],
    variants: [PALETTE.white, PALETTE.gray, PALETTE.black],
    defaultVariant: 0,
    confidence: 'inferred',
    note: LANE_CHANGE_NOTE,
  },
  {
    // Lane change centre (E+E+D as one set, spec 3.5): the bridge carries
    // the upper lane from the right edge across to the left edge while the
    // two lanes underneath move one lane to the right. The bridge sticks out
    // a third of a piece over each approach, so its upper ports sit there.
    // It only joins bridge approaches, upper and lower ports together.
    id: 'lane-change-center',
    name: 'レーンチェンジ中央部',
    setCode: 'D+E',
    segments: [{ length: LANE_CHANGE_LENGTH, lateralProfile: 'lc-under' }],
    lanes: [0, 1],
    tracks: [
      {
        start: { pos: [RIGHT_LANE_X, 0, -BRIDGE_OVERLAP], rot: [0, 0, 0] },
        segments: [{ length: BRIDGE_RUN, lateralProfile: 'lc-over' }],
        lanes: [1],
      },
    ],
    ports: [
      { id: 'lower-a', anchor: 'start', lanes: [0, 1], kind: 'lc-lower', partners: ['bridge-approach'] },
      {
        id: 'lower-b',
        anchor: { pos: [-laneOffset(1) - GLOBAL_SPEC.lanePitch / 2, 0, LANE_CHANGE_LENGTH], rot: [0, 0, 0] },
        lanes: [1, 2],
        kind: 'lc-lower',
        partners: ['bridge-approach'],
      },
      {
        id: 'upper-a',
        anchor: { pos: [RIGHT_LANE_X, JOINT_HEIGHT, -BRIDGE_OVERLAP], rot: [180, -JOINT_PITCH, 0] },
        lanes: [2],
        kind: 'lc-upper',
        partners: ['bridge-approach'],
      },
      {
        id: 'upper-b',
        anchor: { pos: [-laneOffset(0), JOINT_HEIGHT, LANE_CHANGE_LENGTH + BRIDGE_OVERLAP], rot: [0, -JOINT_PITCH, 0] },
        lanes: [0],
        kind: 'lc-upper',
        partners: ['bridge-approach'],
      },
    ],
    laneLinks: [
      { from: [0, 0], to: [1, 1] },
      { from: [0, 1], to: [1, 2] },
      { from: [2, 2], to: [3, 0] },
    ],
    // The set's own support stands across the middle, under the top of the
    // bridge, square to the two lower lanes and centred on them, in the
    // part's colour (user, from the real part, 2026-10-20).
    supports: [
      {
        at: 0.5,
        offset: (laneOffset(0) + laneOffset(1)) / 2,
        halfWidth: LANE_CHANGE_SUPPORT_HALF,
        top: LANE_CHANGE_SUPPORT_TOP,
        depth: LANE_CHANGE_SUPPORT_DEPTH,
      },
    ],
    variants: [PALETTE.white, PALETTE.gray, PALETTE.black],
    defaultVariant: 0,
    confidence: 'inferred',
    note: LANE_CHANGE_NOTE,
  },
  {
    // The lane change's under-bridge (D) on its own: the two lower lanes
    // move one lane over in an S, with no bridge above. Used as a two-lane
    // piece, e.g. after a bridge approach (user, 2026-10-21).
    id: 'under-bridge',
    name: 'アンダーブリッジ',
    setCode: 'D',
    segments: [{ length: LANE_CHANGE_LENGTH, lateralProfile: 'lc-under' }],
    lanes: [0, 1],
    ports: [
      { id: 'a', anchor: 'start', lanes: [0, 1] },
      { id: 'b', anchor: { pos: [-laneOffset(1) - GLOBAL_SPEC.lanePitch / 2, 0, LANE_CHANGE_LENGTH], rot: [0, 0, 0] }, lanes: [1, 2] },
    ],
    laneLinks: [
      { from: [0, 0], to: [1, 1] },
      { from: [0, 1], to: [1, 2] },
    ],
    variants: [PALETTE.white, PALETTE.gray, PALETTE.black],
    defaultVariant: 0,
    confidence: 'inferred',
    note: LANE_CHANGE_NOTE,
  },
];

const PART_BY_ID = new Map(PARTS.map((p) => [p.id, p]));

export function getPart(id: string): PartDef {
  const part = PART_BY_ID.get(id);
  if (!part) throw new Error(`unknown part: ${id}`);
  return part;
}

export function hasPart(id: string): boolean {
  return PART_BY_ID.has(id);
}

/**
 * Catalog version 1: part number used in shared URLs. Append only; never
 * reuse or renumber an entry, or old URLs will open the wrong parts.
 */
export const CATALOG_VERSION = 1;
export const PART_CODES: readonly string[] = [
  'straight',
  'curve45',
  'wave',
  'bank-approach-20',
  'slope',
  'bridge-approach',
  'lane-change-center',
  'under-bridge',
];

export function variantOf(part: PartDef, index: number | undefined): Variant {
  return part.variants[index ?? part.defaultVariant] ?? part.variants[part.defaultVariant];
}

/** Lateral offset of a lane centre from the centreline, + is right. */
export function laneOffset(lane: number): number {
  return (lane - (GLOBAL_SPEC.laneCount - 1) / 2) * GLOBAL_SPEC.lanePitch;
}

/**
 * Lanes running through a part. A two-ended part without a table links each
 * lane both ports carry to itself.
 */
export function laneLinks(part: PartDef): LaneLink[] {
  if (part.laneLinks) return part.laneLinks;
  if (part.ports.length !== 2) return [];
  const [a, b] = part.ports;
  return a.lanes.filter((l) => b.lanes.includes(l)).map((l) => ({ from: [0, l], to: [1, l] }));
}

/** Lateral offset (+ right, looking out of the port) of each lane the port carries from the port's origin. */
export function portLaneOffsets(port: PortDef): { lane: number; right: number }[] {
  const { lanes, anchor } = port;
  if (typeof anchor !== 'string') {
    return lanes.map((lane, i) => ({ lane, right: (i - (lanes.length - 1) / 2) * GLOBAL_SPEC.lanePitch }));
  }
  const mid = portLaneCentre(port);
  // Looking out of the start port is looking back along the centreline.
  const sign = anchor === 'start' ? -1 : 1;
  return lanes.map((lane) => ({ lane, right: sign * (laneOffset(lane) - mid) }));
}

/** Lateral offset (+ right) from the centreline of the middle of the lanes an end port carries. */
export function portLaneCentre(port: PortDef): number {
  if (port.lanes.length === 0) return 0;
  return port.lanes.reduce((sum, l) => sum + laneOffset(l), 0) / port.lanes.length;
}
