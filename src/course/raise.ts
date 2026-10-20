import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { getPart } from './catalog';
import { anchorFrame, anchorRef, layoutCourse, placementOf, type Course, type Layout, type PieceRec, type PortRef } from './course';
import { clone, freeRec, jointBend, linkHolder, setBend, setTwist } from './edit';
import { FACE, matrixToPose, type Pose } from './geometry';

// Raising a run of pieces by bending its joints and twisting its pieces
// (spec 16.3, #54), e.g. a spiral of curves that passes over itself.

/** A run of pieces joined end to end by stored links, from a joint onwards. */
export interface Run {
  /** The pieces, in order along the run. */
  pieces: number[];
  /** The joint into each piece, then the joint out of the last one if a piece is linked there. */
  joints: [PortRef, PortRef][];
}

/** The way a run goes from a joint: which pieces, and where it ends (for the editor to show). */
export interface RunPreview {
  /** The pieces, going away from the joint. */
  pieces: number[];
  /** The far port of the last piece. */
  end: PortRef | null;
}

/** The piece hanging by a stored link off a port, with the port it hangs by. */
function childAt(course: Course, ref: PortRef): PortRef | null {
  const piece = course.pieces.findIndex((r) => 'to' in r && r.to[0] === ref.piece && r.to[1] === ref.port);
  return piece < 0 ? null : { piece, port: (course.pieces[piece] as { port: number }).port };
}

const twoEnded = (course: Course, piece: number) => getPart(course.pieces[piece].part).ports.length === 2;

/**
 * Up to `count` pieces from the joint between `from` and `into`, going into
 * `into`'s piece, the way the stored links go: each piece hangs off the far
 * port of the one before. Stops early at a piece with more than two ports.
 * Null when the joint is not a stored link the right way round.
 */
export function runFrom(course: Course, from: PortRef, into: PortRef, count: number): Run | null {
  if (linkHolder(course, from, into) !== into.piece) return null;
  const run: Run = { pieces: [], joints: [[from, into]] };
  let piece = into.piece;
  for (;;) {
    run.pieces.push(piece);
    if (!twoEnded(course, piece)) break;
    const out = { piece, port: 1 - (course.pieces[piece] as { port: number }).port };
    const next = childAt(course, out);
    if (!next) break;
    run.joints.push([out, next]);
    if (run.pieces.length >= count || !twoEnded(course, next.piece)) break;
    piece = next.piece;
  }
  return run;
}

/** The pieces put in another order so each comes after the one it is placed from (spec 5.1); `order[k]` is where piece `k` came from. */
function reorder(course: Course): { course: Course; order: number[] } {
  const order: number[] = [];
  const at = new Map<number, number>();
  while (order.length < course.pieces.length) {
    course.pieces.forEach((rec, i) => {
      const ref = anchorRef(rec);
      if (at.has(i) || (ref && !at.has(ref[0]))) return;
      at.set(i, order.length);
      order.push(i);
    });
  }
  const pieces = order.map((i): PieceRec => {
    const rec = { ...course.pieces[i] };
    if ('to' in rec) rec.to = [at.get(rec.to[0])!, rec.to[1]];
    if ('free' in rec && rec.free) rec.free = [at.get(rec.free[0])!, rec.free[1]];
    return rec;
  });
  return { course: { ...course, pieces, cuts: undefined }, order };
}

const DEG = 180 / Math.PI;

/** A frame as a pose, unrounded: for working courses that are never stored. */
function exactPose(m: Matrix4): Pose {
  const pos = new Vector3();
  const q = new Quaternion();
  m.decompose(pos, q, new Vector3());
  const e = new Euler().setFromQuaternion(q, 'YXZ');
  return { pos: [pos.x, pos.y, pos.z], rot: [e.y * DEG, -e.x * DEG, e.z * DEG] };
}

/** Where the piece on `child` sits, as the frame its port faces seen from the port `base` (null: the world). */
function poseOn(layout: Layout, base: PortRef | null, child: PortRef): Matrix4 {
  const from = base ? layout.pieces[base.piece].ports[base.port] : new Matrix4();
  return from.clone().invert().multiply(layout.pieces[child.piece].ports[child.port].clone().multiply(FACE));
}

/**
 * The course with `piece` placed where it is, and the stored links from it
 * up to the first piece of its chain turned round so they hang off `piece`,
 * each joint bent as before. Also the pieces whose records changed.
 */
function rootAt(course: Course, piece: number): { course: Course; turned: Set<number> } {
  const layout = layoutCourse(course);
  const next = clone(course);
  const turned = new Set([piece]);
  let rec = course.pieces[piece];
  next.pieces[piece] = freeRec(rec, null, exactPose(anchorFrame(layout, piece)));
  let child = piece;
  while ('to' in rec) {
    const [parent, port] = rec.to;
    const turn = exactPose(poseOn(layout, { piece: child, port: rec.port }, { piece: parent, port }));
    const up = course.pieces[parent];
    const out: PieceRec = { part: up.part, port, to: [child, rec.port], bend: { pitch: turn.rot[1], yaw: turn.rot[0] } };
    if (up.variant !== undefined) out.variant = up.variant;
    if (up.twist) out.twist = up.twist;
    next.pieces[parent] = out;
    turned.add(parent);
    rec = up;
    child = parent;
  }
  return { course: next, turned };
}

/**
 * The run from the joint between `from` and `into`, in a working course
 * where it follows the stored links. Going against them, the course is
 * re-rooted at `from`, so the run can take in the first piece and go on
 * past it. `order[k]` is the piece `k` of the working course.
 */
function workingRun(course: Course, from: PortRef, into: PortRef, count: number) {
  if (linkHolder(course, from, into) !== from.piece) {
    return { work: course, order: course.pieces.map((_, i) => i), turned: new Set<number>(), run: runFrom(course, from, into, count) };
  }
  const rooted = rootAt(course, from.piece);
  const { course: work, order } = reorder(rooted.course);
  const at = new Map(order.map((old, k) => [old, k]));
  const map = (r: PortRef) => ({ piece: at.get(r.piece)!, port: r.port });
  return { work, order, turned: rooted.turned, run: runFrom(work, map(from), map(into), count) };
}

/** Which pieces raising from the joint between `from` and `into` would move, going into `into` (spec 16.3). */
export function previewRun(course: Course, from: PortRef, into: PortRef, count: number): RunPreview {
  const { work, order, run } = workingRun(course, from, into, count);
  if (!run) return { pieces: [], end: null };
  const end = farPort(work, run.pieces[run.pieces.length - 1]);
  return { pieces: run.pieces.map((k) => order[k]), end: end && { piece: order[end.piece], port: end.port } };
}

/** The port of a two-ended piece away from the one it hangs by. */
function farPort(course: Course, piece: number): PortRef | null {
  const rec = course.pieces[piece];
  return 'port' in rec && twoEnded(course, piece) ? { piece, port: 1 - rec.port } : null;
}

/** Gradient of a port frame's forward, deg, + climbs. */
function pitchOf(frame: Matrix4): number {
  return Math.asin(Math.max(-1, Math.min(1, new Vector3(0, 0, 1).transformDirection(frame).y))) * DEG;
}

/** How far a port frame leans about its forward, deg, + lowers the right side. */
function rollOf(frame: Matrix4): number {
  const left = new Vector3(1, 0, 0).transformDirection(frame);
  const level = Math.cos(pitchOf(frame) / DEG);
  return Math.asin(Math.max(-1, Math.min(1, left.y / level))) * DEG;
}

/**
 * The run climbing at `grade` deg: each joint bends to bring the road to
 * that gradient, each piece twists so it leaves the piece level from side
 * to side, and the joint after the run bends back to level.
 */
function climb(course: Course, run: Run, grade: number): Course {
  let c = course;
  run.joints.forEach(([from, to], k) => {
    const into = run.pieces[k];
    const base = layoutCourse(c).pieces[from.piece].ports[from.port];
    const bend = jointBend(c, from, to);
    c = setBend(c, from, to, { ...bend, pitch: (into === undefined ? 0 : grade) - pitchOf(base) });
    if (into === undefined) return;
    // The far end leans as a bent curve turns; twist the piece to undo it.
    c = setTwist(c, into, 0);
    const far = layoutCourse(c).pieces[into].ports[1 - (c.pieces[into] as { port: number }).port];
    c = setTwist(c, into, -rollOf(far));
  });
  return c;
}

/** Height gained from the start of the run to the far end of its last piece, mm. */
function gain(course: Course, run: Run): number {
  const layout = layoutCourse(course);
  const [start] = run.joints[0];
  const last = run.pieces[run.pieces.length - 1];
  const rec = course.pieces[last] as { port: number };
  return layout.pieces[last].ports[1 - rec.port].elements[13] - layout.pieces[start.piece].ports[start.port].elements[13];
}

/** Steepest gradient tried, deg. */
const MAX_GRADE = 20;

/**
 * Raise `count` pieces from the joint between `from` and `into`, going into
 * `into`, so the far end is `rise` mm higher than the joint (spec 16.3).
 * The gradient is found so the far end ends up `rise` higher, and the road
 * leaves the run level again. The joint stays where it is and everything
 * joined on the far side follows. Going against the stored links, the run
 * may take in the first piece and go on past it. Returns the course
 * unchanged when the joint is not a stored link.
 */
export function raiseRun(course: Course, from: PortRef, into: PortRef, count: number, rise: number): Course {
  const { work, order, turned, run } = workingRun(course, from, into, count);
  if (!run) return course;
  const raised = climbBy(work, run, rise);
  return turned.size === 0 ? raised : restore(course, raised, order, turned);
}

/**
 * The raised working course stored the way `course` was: pieces in the
 * same order, on the same links. The turned links get the bend that puts
 * each piece where it was raised to; the rest keep the working bends.
 */
function restore(course: Course, raised: Course, order: number[], turned: Set<number>): Course {
  const layout = layoutCourse(raised);
  const at = new Map(order.map((old, k) => [old, k]));
  const frames: Layout = { ...layout, pieces: course.pieces.map((_, i) => layout.pieces[at.get(i)!]) };
  let next = clone(course);
  course.pieces.forEach((rec, i) => {
    const done = raised.pieces[at.get(i)!];
    const self = { piece: i, port: 'port' in rec ? rec.port : 0 };
    if ('to' in rec) {
      const base = { piece: rec.to[0], port: rec.to[1] };
      const turn = matrixToPose(poseOn(frames, base, self));
      const bend = turned.has(i) ? { pitch: turn.rot[1], yaw: turn.rot[0] } : 'to' in done ? (done.bend ?? {}) : {};
      next = setBend(next, base, self, bend);
    } else if (turned.has(i)) {
      const { base } = placementOf(rec);
      next.pieces[i] = freeRec(rec, base, matrixToPose(poseOn(frames, base, self)));
    }
    next = setTwist(next, i, done.twist ?? 0);
  });
  return next;
}

function climbBy(course: Course, run: Run, rise: number): Course {
  let lo = -MAX_GRADE;
  let hi = MAX_GRADE;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (gain(climb(course, run, mid), run) < rise) lo = mid;
    else hi = mid;
  }
  // Angles are kept to 0.1°, so the rise comes in steps: take the nearer side.
  const [under, over] = [climb(course, run, lo), climb(course, run, hi)];
  return Math.abs(gain(under, run) - rise) <= Math.abs(gain(over, run) - rise) ? under : over;
}
