/**
 * JCJC (Japan Cup Junior Circuit) part catalog.
 *
 * Units are millimetres and degrees. Values come from
 * jcjc-parts.json in the project research; many are inferred from official
 * totals and still need measuring against real parts (see `confidence`).
 */

export type Confidence = 'official' | 'community' | 'inferred' | 'unknown';

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

/**
 * One section of a part's centreline (spec 3.1). The angles are the total
 * change over the section and are applied smoothly along its length.
 */
export interface Segment {
  length: number;
  /** Turn to the left, + is left. */
  yaw?: number;
  /** Change of gradient, + climbs. */
  pitch?: number;
  /** Change of bank angle, + lowers the right side. */
  roll?: number;
  /** Id of a road-surface profile (wave, washboard...). Not rendered yet. */
  heightProfile?: string;
}

/**
 * Where a port sits on the part's centreline. Phase 1 parts only have
 * ports at the two ends of the centreline; later parts (lane change) will
 * add explicit frames.
 */
export type PortAnchor = 'start' | 'end';

export interface PortDef {
  id: string;
  anchor: PortAnchor;
  /** Lane positions this port carries (0 = left looking along the centreline). */
  lanes: number[];
  /** Connection kind; only ports of the same kind and lane count connect. */
  kind?: string;
}

export type Material = 'current' | 'old-gray';

export interface Variant {
  id: string;
  name: string;
  /** Display colour. */
  color: string;
  /** Key into the (future) physics material table. */
  material: Material;
}

export interface PartDef {
  id: string;
  name: string;
  /** Code in the basic set (A, B, C...). */
  setCode?: string;
  segments: Segment[];
  ports: PortDef[];
  /** Lane positions the cross-section covers. */
  lanes: number[];
  variants: Variant[];
  /** Index into `variants` used when a piece does not choose one. */
  defaultVariant: number;
  confidence: Confidence;
  /** Shown in the editor when the geometry is a placeholder. */
  note?: string;
  /**
   * Measured model that replaces the procedural geometry (spec 15). When
   * absent the part is swept from `segments`. Loading is not implemented
   * yet; the field only reserves the switch.
   */
  model?: string;
}

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
    variants: [PALETTE.red, PALETTE.blue, PALETTE.gray, PALETTE.green, PALETTE.black, PALETTE.yellow],
    defaultVariant: 0,
    confidence: 'inferred',
  },
  {
    id: 'wave',
    name: 'ウェーブ',
    setCode: 'C',
    segments: [{ length: STRAIGHT_LENGTH, heightProfile: 'wave' }],
    ports: twoEnded(),
    lanes: ALL_LANES,
    variants: [PALETTE.white, PALETTE.gray, PALETTE.black],
    defaultVariant: 0,
    confidence: 'inferred',
    note: '凹凸は未計測のため平らに表示',
  },
  {
    // Twists the track from flat to a 20° bank (spec 14). The exit of a bank
    // is the same part placed the other way round.
    id: 'bank-approach-20',
    name: 'バンクアプローチ20',
    segments: [{ length: STRAIGHT_LENGTH, roll: 20 }],
    ports: twoEnded(),
    lanes: ALL_LANES,
    variants: [PALETTE.white],
    defaultVariant: 0,
    confidence: 'inferred',
    note: '長さとひねりの中心は未計測のため仮形状（長さ540、中心線まわりにひねる）',
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
export const PART_CODES: readonly string[] = ['straight', 'curve45', 'wave', 'bank-approach-20'];

export function variantOf(part: PartDef, index: number | undefined): Variant {
  return part.variants[index ?? part.defaultVariant] ?? part.variants[part.defaultVariant];
}

/** Lateral offset of a lane centre from the centreline, + is right. */
export function laneOffset(lane: number): number {
  return (lane - (GLOBAL_SPEC.laneCount - 1) / 2) * GLOBAL_SPEC.lanePitch;
}
