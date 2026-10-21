import type { Pose } from './geometry';

// The shape of a part definition (spec 3). The parts themselves are in catalog.ts.

export type Confidence = 'official' | 'community' | 'inferred' | 'unknown';

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
  /** Id of a sideways swing of the lanes (profile.ts), e.g. the wave's bump. */
  lateralProfile?: string;
}

/**
 * Where a port sits (spec 3.3). 'start' and 'end' put it at that end of the
 * centreline, moved sideways to the middle of the lanes it carries. A pose
 * gives the port frame itself in part-local coordinates: forward points out
 * of the part and the origin is the middle of the port's lanes on the road.
 */
export type PortAnchor = 'start' | 'end' | Pose;

export interface PortDef {
  id: string;
  anchor: PortAnchor;
  /**
   * Lane positions this port carries (0 = left looking along the
   * centreline). On a port placed by a pose they are listed left to right
   * looking out of the port.
   */
  lanes: number[];
  /** Connection kind; only ports of the same kind and lane count connect. */
  kind?: string;
  /** This end sits on the floor, so its frame must be level (bank approach). */
  floor?: boolean;
  /** The only parts this port joins, when it is limited (the lane change's own ports). */
  partners?: string[];
}

/**
 * A stretch of road swept along its own centreline, for parts whose lanes
 * part ways (the lane change's ramp and bridges). Lane positions are
 * measured from this track's centreline.
 */
/**
 * A stand that comes with the part (spec 3.4, #11), as under the lane
 * change bridge: a leg under each end and a crossbar between, standing
 * square to the part's main centreline where it stands.
 */
export interface PartSupport {
  /** Where along the main centreline, as a fraction of its length. */
  at: number;
  /** Middle of the stand from the centreline, mm, + right. */
  offset: number;
  /** Half its width, to the outside of the legs, mm. */
  halfWidth: number;
  /** Height of its top above the centreline, mm. */
  top: number;
  /** How deep it is along the centreline, mm. */
  depth: number;
}

export interface Track {
  /** Where the track's centreline starts, in part-local coordinates. */
  start: Pose;
  segments: Segment[];
  lanes: number[];
}

/**
 * A lane running through a part from one port to another (spec 3.2), e.g.
 * lane 2 of port 0 comes out as lane 0 of port 1.
 */
export interface LaneLink {
  from: [port: number, lane: number];
  to: [port: number, lane: number];
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
  /** Lane positions the cross-section covers: any 1 to 3 of 0, 1, 2. */
  lanes: number[];
  /** Further road swept along centrelines of its own, beside the main one. */
  tracks?: Track[];
  /**
   * Which port lane runs to which (spec 3.2). Left out on a two-ended part,
   * where each lane runs straight through (see `laneLinks`).
   */
  laneLinks?: LaneLink[];
  variants: Variant[];
  /** Index into `variants` used when a piece does not choose one. */
  defaultVariant: number;
  confidence: Confidence;
  /**
   * Turning the part round makes a different shape (a curve turns the other
   * way, a slope goes down), so the parts list offers it both ways round,
   * named here: the first joins by port 0, the second by port 1.
   */
  ways?: [string, string];
  /** Parts this part cannot be joined to directly (e.g. two ramps in a row). */
  cannotJoin?: string[];
  /**
   * Stands that are part of the part. A part that has them gets automatic
   * supports only under its main road, and only when it is raised (#11).
   */
  supports?: PartSupport[];
  /**
   * Each piece sets its own length within this range (a home-made
   * straight, #69). The part is then one straight segment; `segments`
   * holds it at the default length. See `partOf`.
   */
  lengths?: { min: number; max: number; default: number };
  /** Shown in the editor when the geometry is a placeholder. */
  note?: string;
  /**
   * Measured model that replaces the procedural geometry (spec 15). When
   * absent the part is swept from `segments`. Loading is not implemented
   * yet; the field only reserves the switch.
   */
  model?: string;
}
