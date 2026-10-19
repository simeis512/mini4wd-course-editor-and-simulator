import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { PartDef, PortDef, Segment } from './catalog';
import { lateralProfile } from './profile';

/**
 * Frames are rigid transforms (Matrix4) in millimetres. In a frame's local
 * axes forward is +Z, up is +Y, and so right (F × U) is −X.
 */

const DEG = Math.PI / 180;

/** Longest step along the centreline when sampling, mm. */
const MAX_STEP_LENGTH = 20;
/** Largest rotation per sample step, degrees. */
const MAX_STEP_ANGLE = 3;

/** 180° turn about up: turns a port frame round to face its partner. */
export const FACE = new Matrix4().makeRotationY(Math.PI);

/** sin(x)/x, stable near 0. */
function sinc(x: number): number {
  return Math.abs(x) < 1e-6 ? 1 - (x * x) / 6 : Math.sin(x) / x;
}

/**
 * Sample a part's centreline as frames, starting at the identity. Each step
 * turns half its rotation, moves along the chord, then turns the other
 * half, which is exact for constant-curvature arcs. A segment with a
 * `lateralProfile` swings its frames sideways off that path and turns them
 * to follow the swing.
 */
export function sampleCenterline(segments: readonly Segment[]): Matrix4[] {
  const frame = new Matrix4();
  const frames = [frame.clone()];
  const half = new Matrix4();
  const move = new Matrix4();
  const axis = new Vector3();
  const swing = new Matrix4();
  const turn = new Matrix4();
  for (const seg of segments) {
    const yaw = (seg.yaw ?? 0) * DEG;
    const pitch = (seg.pitch ?? 0) * DEG;
    const roll = (seg.roll ?? 0) * DEG;
    const profile = seg.lateralProfile ? lateralProfile(seg.lateralProfile) : undefined;
    // Local rotation vector: + pitch climbs (about −X), + roll lowers the right side (about +Z).
    const rot = new Vector3(-pitch, yaw, roll);
    const totalAngle = rot.length();
    const maxStep = Math.min(MAX_STEP_LENGTH, profile?.maxStep ?? Infinity);
    const steps = Math.max(1, Math.ceil(seg.length / maxStep), Math.ceil(totalAngle / (MAX_STEP_ANGLE * DEG)));
    const stepAngle = totalAngle / steps;
    const ds = seg.length / steps;
    if (stepAngle > 0) {
      axis.copy(rot).normalize();
      half.makeRotationAxis(axis, stepAngle / 2);
    } else {
      half.identity();
    }
    move.makeTranslation(0, 0, ds * sinc(stepAngle / 2));
    for (let i = 0; i < steps; i++) {
      frame.multiply(half).multiply(move).multiply(half);
      const f = frame.clone();
      if (profile) {
        // + X is left; turning about + Y by θ swings forward towards the left.
        const s = (i + 1) * ds;
        swing.makeTranslation(profile.offset(s, seg.length), 0, 0);
        f.multiply(swing).multiply(turn.makeRotationY(Math.atan(profile.slope(s, seg.length))));
      }
      frames.push(f);
    }
  }
  return frames;
}

export interface PartGeometry {
  /** Centreline samples in part-local coordinates. */
  samples: Matrix4[];
  /** Port frames in part-local coordinates; forward points out of the part. */
  ports: Matrix4[];
  /** Centreline length, mm. */
  length: number;
}

const geometryCache = new Map<string, PartGeometry>();

function portFrame(port: PortDef, samples: Matrix4[]): Matrix4 {
  switch (port.anchor) {
    case 'start':
      return FACE.clone();
    case 'end':
      return samples[samples.length - 1].clone();
  }
}

export function partGeometry(part: PartDef): PartGeometry {
  let geo = geometryCache.get(part.id);
  if (!geo) {
    const samples = sampleCenterline(part.segments);
    geo = {
      samples,
      ports: part.ports.map((p) => portFrame(p, samples)),
      length: part.segments.reduce((sum, s) => sum + s.length, 0),
    };
    geometryCache.set(part.id, geo);
  }
  return geo;
}

/** Position (mm) and rotation (deg) of a frame. Rotation is yaw, pitch, roll. */
export interface Pose {
  pos: [number, number, number];
  rot: [number, number, number];
}

export const IDENTITY_POSE: Pose = { pos: [0, 0, 0], rot: [0, 0, 0] };

export function poseToMatrix(pose: Pose): Matrix4 {
  const [yaw, pitch, roll] = pose.rot;
  const q = new Quaternion().setFromEuler(new Euler(-pitch * DEG, yaw * DEG, roll * DEG, 'YXZ'));
  return new Matrix4().compose(new Vector3(...pose.pos), q, new Vector3(1, 1, 1));
}

/** Round to the precision stored in URLs: 0.1 mm and 0.1°. */
function round1(x: number): number {
  const r = Math.round(x * 10) / 10;
  return r === 0 ? 0 : r;
}

export function matrixToPose(m: Matrix4): Pose {
  const pos = new Vector3();
  const q = new Quaternion();
  m.decompose(pos, q, new Vector3());
  const e = new Euler().setFromQuaternion(q, 'YXZ');
  return {
    pos: [round1(pos.x), round1(pos.y), round1(pos.z)],
    rot: [round1(e.y / DEG), round1(-e.x / DEG), round1(e.z / DEG)],
  };
}

/**
 * World matrix of a piece whose port `portFrameLocal` faces the frame
 * `target` (the partner port's world frame).
 */
export function attach(target: Matrix4, portFrameLocal: Matrix4): Matrix4 {
  return target.clone().multiply(FACE).multiply(portFrameLocal.clone().invert());
}

export interface FrameError {
  distance: number;
  /** Angle between the two frames once one is turned to face the other, deg. */
  angle: number;
}

/** How far two port frames are from facing each other exactly. */
export function facingError(a: Matrix4, b: Matrix4): FrameError {
  const pa = new Vector3().setFromMatrixPosition(a);
  const pb = new Vector3().setFromMatrixPosition(b);
  const qa = new Quaternion().setFromRotationMatrix(a.clone().multiply(FACE));
  const qb = new Quaternion().setFromRotationMatrix(b);
  return { distance: pa.distanceTo(pb), angle: qa.angleTo(qb) / DEG };
}

/** Point on a frame at lateral offset `right` (+ right) and height `up`. */
export function pointOnFrame(frame: Matrix4, right: number, up: number, out = new Vector3()): Vector3 {
  return out.set(-right, up, 0).applyMatrix4(frame);
}
