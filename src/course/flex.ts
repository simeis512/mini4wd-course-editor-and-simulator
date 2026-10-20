import { Matrix4, Vector3, type BufferAttribute } from 'three';
import type { PartDef } from './catalog';
import { partGeometry, poseToMatrix, type PartGeometry, type Pose } from './geometry';

// Joint bend and piece twist (spec 16): the pieces stay rigid, a joint may
// bend a little and a piece may twist a little about its centreline.

/**
 * How far a joint bends (spec 16.1), deg in 0.1° steps. The joined piece
 * sits on its partner's port turned by this much, about the joint.
 */
export interface Bend {
  /** About the joint's left-right axis, + climbs. */
  pitch?: number;
  /** About the joint's up axis, + to the left. Not edited in the UI yet (spec 16.1). */
  yaw?: number;
}

/** Largest bend of one joint before a warning (spec 16.4, provisional: not measured, #1). */
export const BEND_LIMIT = 3;
/** Largest twist of one piece before a warning (spec 16.4, provisional: not measured, #1). */
export const TWIST_LIMIT = 3;

const DEG = Math.PI / 180;

export function isZeroBend(bend: Bend | undefined): boolean {
  return !bend || (!bend.pitch && !bend.yaw);
}

/** A bend as a pose from the port it bends: a turn about the joint (the port's origin). */
export function bendPose(bend: Bend | undefined): Pose {
  return { pos: [0, 0, 0], rot: [bend?.yaw ?? 0, bend?.pitch ?? 0, 0] };
}

export function bendMatrix(bend: Bend | undefined): Matrix4 {
  return isZeroBend(bend) ? new Matrix4() : poseToMatrix(bendPose(bend));
}

/** The larger of a bend's two angles, deg. */
export function bendAngle(bend: Bend | undefined): number {
  return Math.max(Math.abs(bend?.pitch ?? 0), Math.abs(bend?.yaw ?? 0));
}

/** Distance along the main centreline to each sample, as a fraction of the whole. */
function sampleFractions(samples: readonly Matrix4[]): number[] {
  const a = new Vector3();
  const b = new Vector3();
  const along = [0];
  for (let i = 1; i < samples.length; i++) {
    a.setFromMatrixPosition(samples[i - 1]);
    b.setFromMatrixPosition(samples[i]);
    along.push(along[i - 1] + a.distanceTo(b));
  }
  const total = along[along.length - 1] || 1;
  return along.map((d) => d / total);
}

/**
 * The twist of a piece (spec 16.2) as one rigid turn per sample of its main
 * centreline: about the centreline there, by `twist` times the fraction of
 * the way along. + lowers the right side, as roll does.
 */
export class Twist {
  private readonly turns: Matrix4[];
  private readonly points: Vector3[];

  constructor(
    readonly samples: readonly Matrix4[],
    readonly twist: number,
  ) {
    const fractions = sampleFractions(samples);
    this.turns = samples.map((s, i) =>
      s.clone().multiply(new Matrix4().makeRotationZ(twist * fractions[i] * DEG)).multiply(s.clone().invert()),
    );
    this.points = samples.map((s) => new Vector3().setFromMatrixPosition(s));
  }

  /** Index of the centreline sample nearest a point. */
  private nearest(p: Vector3): number {
    let best = 0;
    let bestD = Infinity;
    this.points.forEach((q, i) => {
      const d = q.distanceToSquared(p);
      if (d < bestD) [best, bestD] = [i, d];
    });
    return best;
  }

  /** The turn at main centreline sample `i`. */
  turnAt(i: number): Matrix4 {
    return this.turns[i];
  }

  /** A frame anywhere on the part, turned as the centreline beside it turns. */
  frame(f: Matrix4): Matrix4 {
    return this.turns[this.nearest(new Vector3().setFromMatrixPosition(f))].clone().multiply(f);
  }

  /**
   * Turn vertices in place, e.g. a measured model's (spec 16.2), each with
   * the centreline nearest it. Positions are part-local millimetres.
   */
  deform(positions: BufferAttribute): void {
    const p = new Vector3();
    for (let i = 0; i < positions.count; i++) {
      p.set(positions.getX(i), positions.getY(i), positions.getZ(i));
      p.applyMatrix4(this.turns[this.nearest(p)]);
      positions.setXYZ(i, p.x, p.y, p.z);
    }
  }
}

/** Twisted geometry of each part's geometry, by twist; it goes when the part's geometry is rebuilt. */
const twistedCache = new WeakMap<PartGeometry, Map<number, PartGeometry>>();

/**
 * A part's geometry with a piece's twist (spec 16.2): the main centreline
 * turns evenly along its length; other road and the ports turn with the
 * centreline beside them, so the twist reaches the next piece by the far
 * port. Untwisted pieces share the part's own geometry.
 */
export function pieceGeometry(part: PartDef, twist = 0): PartGeometry {
  const geo = partGeometry(part);
  if (!twist) return geo;
  let byTwist = twistedCache.get(geo);
  if (!byTwist) twistedCache.set(geo, (byTwist = new Map()));
  let out = byTwist.get(twist);
  if (!out) {
    const t = new Twist(geo.samples, twist);
    const samples = geo.samples.map((s, i) => t.turnAt(i).clone().multiply(s));
    out = {
      ...geo,
      samples,
      tracks: geo.tracks.map((track, k) => ({ lanes: track.lanes, samples: k === 0 ? samples : track.samples.map((f) => t.frame(f)) })),
      ports: geo.ports.map((f) => t.frame(f)),
    };
    byTwist.set(twist, out);
  }
  return out;
}
