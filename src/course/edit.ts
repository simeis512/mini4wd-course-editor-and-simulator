import { Matrix4, Vector3 } from 'three';
import { withoutPiece } from './attachments';
import { getPart, GLOBAL_SPEC, lengthWithin, partOf } from './catalog';
import {
  anchorFrame,
  anchorRef,
  compatible,
  emptyCourse,
  layoutCourse,
  placementOf,
  portKey,
  settingsOf,
  type Course,
  type Layout,
  type PieceRec,
  type PlacedPiece,
  type PortRef,
} from './course';
import { isZeroBend, type Bend } from './flex';
import { attach, IDENTITY_POSE, matrixToPose, partGeometry, type Pose } from './geometry';

// Editing. Each operation returns a new course and leaves the input alone.

/** A deep copy to edit. */
export function clone(course: Course): Course {
  return structuredClone(course);
}

/** Place `partId` with its `port` facing the open port `at`, or at the origin. */
export function addPiece(course: Course, partId: string, at: PortRef | null, port = 0, variant?: number): Course {
  const next = clone(course);
  const rec: PieceRec = at ? { part: partId, port, to: [at.piece, at.port] } : course.pieces.length === 0 && port === 0
    ? { part: partId, at: 'origin' }
    : { part: partId, port, free: null, pose: IDENTITY_POSE };
  if (variant !== undefined) rec.variant = variant;
  next.pieces.push(rec);
  return next;
}

/** Room left around a piece's lane centrelines: the outer lane and its fence. */
const FOOTPRINT_MARGIN = GLOBAL_SPEC.lanePitch * 1.5 + GLOBAL_SPEC.fenceThickness;

/** Rough top-view bounds of a placed piece, world X/Z in mm: [x0, x1, z0, z1]. */
export function footprint(pc: PlacedPiece): [number, number, number, number] {
  const p = new Vector3();
  const xs: number[] = [];
  const zs: number[] = [];
  for (const track of pc.geometry.tracks) {
    for (const f of track.samples) {
      p.setFromMatrixPosition(f).applyMatrix4(pc.matrix);
      xs.push(p.x);
      zs.push(p.z);
    }
  }
  const m = FOOTPRINT_MARGIN;
  return [Math.min(...xs) - m, Math.max(...xs) + m, Math.min(...zs) - m, Math.max(...zs) + m];
}

/**
 * Add `partId` on its own, joined by nothing: lying on the floor by its
 * `port`, heading +Z, with the middle of its footprint at (x, z) (spec 8).
 */
export function addFreePiece(course: Course, partId: string, port: number, x: number, z: number, variant?: number): Course {
  const rec: PieceRec = { part: partId, port, free: null, pose: IDENTITY_POSE };
  const part = getPart(partId);
  const geometry = partGeometry(part);
  const [x0, x1, z0, z1] = footprint({ rec, part, geometry, matrix: attach(new Matrix4(), geometry.ports[port]), ports: [] });
  const round = (v: number) => Math.round(v * 10) / 10;
  rec.pose = { pos: [round(x - (x0 + x1) / 2), 0, round(z - (z0 + z1) / 2)], rot: [0, 0, 0] };
  if (variant !== undefined) rec.variant = variant;
  const next = clone(course);
  next.pieces.push(rec);
  return next;
}

/**
 * The nearest spot to (x, z), on a grid of `step` mm, where `partId` added by
 * `addFreePiece` overlaps no piece already placed.
 */
export function freeSpot(course: Course, partId: string, port: number, x: number, z: number, step = 100): [number, number] {
  const taken = layoutCourse(course).pieces.map(footprint);
  // The new piece's bounds when centred on the origin; elsewhere they just shift.
  const [p0, p1, q0, q1] = footprint(layoutCourse(addFreePiece(emptyCourse(), partId, port, 0, 0)).pieces[0]);
  const fits = (cx: number, cz: number) =>
    taken.every(([x0, x1, z0, z1]) => cx + p1 <= x0 || cx + p0 >= x1 || cz + q1 <= z0 || cz + q0 >= z1);
  const x0 = Math.round(x / step) * step;
  const z0 = Math.round(z / step) * step;
  for (let ring = 0; ring <= 60; ring++) {
    const spots: [number, number][] = [];
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) === ring) spots.push([x0 + i * step, z0 + j * step]);
      }
    }
    spots.sort((a, b) => Math.hypot(a[0] - x, a[1] - z) - Math.hypot(b[0] - x, b[1] - z));
    const spot = spots.find(([cx, cz]) => fits(cx, cz));
    if (spot) return spot;
  }
  return [x0, z0];
}

/** `rec` re-anchored as a free piece at `pose` from the port `base` (null: the world). */
export function freeRec(rec: PieceRec, base: PortRef | null, pose: Pose): PieceRec {
  return { part: rec.part, port: 'port' in rec ? rec.port : 0, free: base && [base.piece, base.port], pose, ...settingsOf(rec) };
}

/**
 * Remove a piece. Pieces anchored to it stay where they are as free pieces
 * (spec 8), and later references are renumbered.
 */
export function deletePiece(course: Course, index: number): Course {
  const layout = layoutCourse(course);
  const pieces: PieceRec[] = [];
  course.pieces.forEach((rec, i) => {
    if (i === index) return;
    const ref = anchorRef(rec);
    if (ref && ref[0] === index) {
      pieces.push(freeRec(rec, null, matrixToPose(anchorFrame(layout, i))));
      return;
    }
    const out = structuredClone(rec);
    const outRef = anchorRef(out);
    if (outRef && outRef[0] > index) outRef[0]--;
    pieces.push(out);
  });
  const next: Course = { ...clone(course), pieces };
  const renumber = (marks: [number, number][]) =>
    marks.filter(([p]) => p !== index).map(([p, port]): [number, number] => [p > index ? p - 1 : p, port]);
  if (course.cuts) next.cuts = renumber(course.cuts);
  if (course.intended) {
    next.intended = renumber(course.intended);
    if (!next.intended.length) delete next.intended;
  }
  if (course.attachments) {
    next.attachments = withoutPiece(course.attachments, index);
    if (!next.attachments.length) delete next.attachments;
  }
  return tidyCuts(next);
}

/**
 * Turn a piece round so it joins by its other port (spec 8: flip; also how a
 * curve becomes a right-hander). Pieces hanging off it keep their port.
 */
export function flipPiece(course: Course, index: number): Course {
  const next = clone(course);
  const rec = next.pieces[index];
  const part = partOf(rec);
  if (part.ports.length !== 2) return next;
  const oldPort = 'port' in rec ? rec.port : 0;
  const newPort = 1 - oldPort;
  if ('at' in rec) {
    next.pieces[index] = freeRec({ ...rec, port: newPort, free: null, pose: IDENTITY_POSE }, null, IDENTITY_POSE);
  } else {
    rec.port = newPort;
  }
  // The port that used to be free is now the anchoring one and vice versa.
  next.pieces.forEach((other, i) => {
    if (i <= index) return;
    const ref = anchorRef(other);
    if (ref && ref[0] === index) ref[1] = ref[1] === oldPort ? newPort : oldPort;
  });
  // The piece has turned round, so its old joints are gone, and its open ends are new.
  if (next.cuts) next.cuts = next.cuts.filter(([p]) => p !== index);
  if (next.intended) {
    next.intended = next.intended.filter(([p]) => p !== index);
    if (!next.intended.length) delete next.intended;
  }
  return tidyCuts(next);
}

export function setVariant(course: Course, index: number, variant: number): Course {
  const next = clone(course);
  const rec = next.pieces[index];
  if (variant === partOf(rec).defaultVariant) delete rec.variant;
  else rec.variant = variant;
  return next;
}

/**
 * Set the length of a piece whose part takes one (#69), in whole mm within
 * its range. Pieces beyond its far port follow it.
 */
export function setLength(course: Course, index: number, length: number): Course {
  const part = getPart(course.pieces[index].part);
  if (!part.lengths) return course;
  const next = clone(course);
  const rec = next.pieces[index];
  const mm = lengthWithin(part, length);
  if (mm === part.lengths.default) delete rec.length;
  else rec.length = mm;
  return withFarSide(course, next, index);
}

/**
 * `next`, a change to piece `index` that moves its far end, with the pieces
 * that only meet that end (a loop closed by placing them there, not a stored
 * link) moved along with it, as the pieces hanging off it are. Everything
 * reached from the far end goes, except the pieces the changed one hangs
 * off: where the far side comes round to them, the loop opens there.
 */
function withFarSide(course: Course, next: Course, index: number): Course {
  const before = layoutCourse(course);
  const after = layoutCourse(next);
  const rec = course.pieces[index];
  const near = 'port' in rec ? rec.port : 0;
  const far = before.pieces[index].ports.map((_, p) => p).filter((p) => p !== near);
  if (far.length !== 1) return next;
  const delta = after.pieces[index].ports[far[0]].clone().multiply(before.pieces[index].ports[far[0]].clone().invert());
  // Pieces it hangs off stay; pieces hanging off it already follow.
  const stay = new Set([index]);
  for (let ref = anchorRef(rec); ref; ref = anchorRef(course.pieces[ref[0]])) stay.add(ref[0]);
  const hangsOff = (i: number): boolean => {
    for (let ref = anchorRef(course.pieces[i]); ref; ref = anchorRef(course.pieces[ref[0]])) if (ref[0] === index) return true;
    return false;
  };
  const reached = new Set<number>();
  const queue = before.joints.flatMap((j) => [[j.a, j.b], [j.b, j.a]]).filter(([x]) => x.piece === index && x.port === far[0]).map(([, y]) => y.piece);
  while (queue.length) {
    const i = queue.pop()!;
    if (stay.has(i) || reached.has(i)) continue;
    reached.add(i);
    for (const j of before.joints) {
      if (j.a.piece === i) queue.push(j.b.piece);
      if (j.b.piece === i) queue.push(j.a.piece);
    }
  }
  const moving = new Set([...reached].filter((i) => !hangsOff(i)));
  return moving.size ? tidyCuts(moveGroup(next, moving, delta)) : next;
}

/** Round an angle to the 0.1° kept in URLs. */
const tenth = (deg: number) => Math.round(deg * 10) / 10;

/**
 * Set a piece's twist (spec 16.2), deg, + lowers the right side. Pieces
 * beyond its far ports follow it.
 */
export function setTwist(course: Course, index: number, twist: number): Course {
  const next = clone(course);
  const rec = next.pieces[index];
  if (tenth(twist)) rec.twist = tenth(twist);
  else delete rec.twist;
  return next;
}

/** The piece that holds the stored link between two ports, if they are linked (spec 5.1). */
export function linkHolder(course: Course, a: PortRef, b: PortRef): number | null {
  for (const [x, y] of [[a, b], [b, a]]) {
    const rec = course.pieces[y.piece];
    if (rec && 'to' in rec && rec.to[0] === x.piece && rec.to[1] === x.port && rec.port === y.port) return y.piece;
  }
  return null;
}

/** The bend of the joint between two linked ports (spec 16.1); none when they are not linked. */
export function jointBend(course: Course, a: PortRef, b: PortRef): Bend {
  const holder = linkHolder(course, a, b);
  const rec = holder === null ? null : course.pieces[holder];
  return (rec && 'to' in rec && rec.bend) || {};
}

/**
 * Bend the joint between two linked ports (spec 16.1). The piece placed
 * from the joint turns about it, with everything beyond. Only stored links
 * bend: two ports that just meet are left as they are.
 */
export function setBend(course: Course, a: PortRef, b: PortRef, bend: Bend): Course {
  const holder = linkHolder(course, a, b);
  if (holder === null) return course;
  const next = clone(course);
  const rec = next.pieces[holder];
  if (!('to' in rec)) return course;
  const out: Bend = {};
  if (tenth(bend.pitch ?? 0)) out.pitch = tenth(bend.pitch!);
  if (tenth(bend.yaw ?? 0)) out.yaw = tenth(bend.yaw!);
  if (isZeroBend(out)) delete rec.bend;
  else rec.bend = out;
  return tidyCuts(next);
}

function baseFrame(layout: Layout, base: PortRef | null): Matrix4 {
  return base ? layout.pieces[base.piece].ports[base.port] : new Matrix4();
}

/**
 * Move the pieces in `group` by the world transform `delta`. Pieces outside
 * it stay where they are: any that hung off a moving piece keep their pose
 * from the same port, recomputed so they do not move (spec 5.2).
 */
export function moveGroup(course: Course, group: Set<number>, delta: Matrix4): Course {
  const layout = layoutCourse(course);
  const next = clone(course);
  course.pieces.forEach((rec, i) => {
    const ref = anchorRef(rec);
    const hungOffMoving = ref !== null && group.has(ref[0]);
    if (group.has(i) === hungOffMoving) return; // moves with its anchor, or nothing moves
    const { base } = placementOf(rec);
    const anchor = anchorFrame(layout, i);
    const target = group.has(i) ? delta.clone().multiply(anchor) : anchor;
    const from = base && group.has(base.piece) ? delta.clone().multiply(baseFrame(layout, base)) : baseFrame(layout, base);
    next.pieces[i] = freeRec(rec, base, matrixToPose(from.clone().invert().multiply(target)));
  });
  return next;
}

/** The middle of a placed piece's main centreline, world mm. */
export function pieceMiddle(pc: PlacedPiece): Vector3 {
  const samples = pc.geometry.samples;
  return samples
    .reduce((sum, f) => sum.add(new Vector3().setFromMatrixPosition(f)), new Vector3())
    .divideScalar(samples.length)
    .applyMatrix4(pc.matrix);
}

/** The world transform that turns a piece about its middle, `deg` + to the left (anticlockwise from above). */
export function turnAboutMiddle(pc: PlacedPiece, deg: number): Matrix4 {
  const c = pieceMiddle(pc);
  return new Matrix4()
    .makeTranslation(c.x, c.y, c.z)
    .multiply(new Matrix4().makeRotationY((deg * Math.PI) / 180))
    .multiply(new Matrix4().makeTranslation(-c.x, -c.y, -c.z));
}

/** Set a piece's pose from its base port, freeing it if it was connected. */
export function setPose(course: Course, index: number, pose: Pose): Course {
  const next = clone(course);
  next.pieces[index] = freeRec(course.pieces[index], placementOf(course.pieces[index]).base, pose);
  return tidyCuts(next);
}

/** `course` without split marks on these ports. */
export function uncut(course: Course, refs: PortRef[]): Course {
  if (!course.cuts) return course;
  const keys = new Set(refs.map(portKey));
  return withCuts(course, course.cuts.filter(([piece, port]) => !keys.has(portKey({ piece, port }))));
}

/** `course` with these split marks, leaving the field out when there are none. */
function withCuts(course: Course, cuts: [number, number][]): Course {
  const next = { ...course };
  if (cuts.length) next.cuts = cuts;
  else delete next.cuts;
  return next;
}

/** Drop split marks on ports that no longer touch anything they could join. */
export function tidyCuts(course: Course): Course {
  if (!course.cuts) return course;
  const loose = { ...course };
  delete loose.cuts;
  const meeting = new Set(layoutCourse(loose).closures.flatMap((c) => [portKey(c.a), portKey(c.b)]));
  const seen = new Set<string>();
  const cuts = course.cuts.filter(([piece, port]) => {
    const key = portKey({ piece, port });
    if (!meeting.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return withCuts(course, cuts);
}

/** Mark an open port as left open on purpose, or clear the mark (spec 7, #13). */
export function markIntended(course: Course, ref: PortRef, on: boolean): Course {
  const key = portKey(ref);
  const marks = (course.intended ?? []).filter(([piece, port]) => portKey({ piece, port }) !== key);
  if (on) marks.push([ref.piece, ref.port]);
  const next = clone(course);
  if (marks.length) next.intended = marks;
  else delete next.intended;
  return next;
}

/** Run the course the other way round (spec 5.1 `dir`): laps then start by the first piece's other port. */
export function reverseDirection(course: Course): Course {
  const next = clone(course);
  if (course.dir === -1) delete next.dir;
  else next.dir = -1;
  return next;
}

/** The sideways shift of the joint between two linked ports, in lanes (#60); 0 when they are not linked. */
export function jointShift(course: Course, a: PortRef, b: PortRef): number {
  const holder = linkHolder(course, a, b);
  const rec = holder === null ? null : course.pieces[holder];
  return (rec && 'to' in rec && rec.shift) || 0;
}

/**
 * Shift the joint between two linked ports sideways by whole lanes (#60),
 * + to the right looking out of the port the piece hangs off. The piece
 * placed from the joint moves, with everything beyond. It goes as far as
 * one lane still meeting (user, 2026-10-21); a shift at which no lane
 * would meet is not made.
 */
export function setShift(course: Course, a: PortRef, b: PortRef, shift: number): Course {
  const holder = linkHolder(course, a, b);
  if (holder === null || !Number.isInteger(shift)) return course;
  const rec = course.pieces[holder];
  if (!('to' in rec)) return course;
  const [j, p] = rec.to;
  if (!compatible(partOf(course.pieces[j]), p, partOf(rec), rec.port, shift)) return course;
  const next = clone(course);
  const out = next.pieces[holder] as typeof rec;
  if (shift) out.shift = shift;
  else delete out.shift;
  return tidyCuts(next);
}
