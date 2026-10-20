import { Matrix4, Vector3 } from 'three';
import { getPart } from './catalog';
import { layoutCourse, movingGroup, type Course, type PortRef } from './course';
import { jointBend, linkHolder, moveGroup, setBend, setTwist } from './edit';

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

/**
 * Up to `count` pieces from the joint between `from` and `into`, the other
 * way: against the stored links, each piece hanging off the next one. The
 * piece where the links stop (the first piece, or one placed freely) stays
 * where it is, so it is not part of the run. Returned in the order the
 * links go, ending at the joint, ready to raise like `runFrom`.
 */
function runBack(course: Course, from: PortRef, into: PortRef, count: number): Run | null {
  if (linkHolder(course, from, into) !== from.piece) return null;
  const pieces: number[] = [];
  let entered = into;
  while (pieces.length < count && twoEnded(course, entered.piece)) {
    const rec = course.pieces[entered.piece];
    // Each piece in the run hangs by its far port off the next one up.
    if (!('to' in rec) || rec.port !== 1 - entered.port) break;
    pieces.push(entered.piece);
    entered = { piece: rec.to[0], port: rec.to[1] };
  }
  if (pieces.length === 0) return null;
  const top = pieces[pieces.length - 1];
  const rec = course.pieces[top] as { port: number; to: [number, number] };
  return runFrom(course, { piece: rec.to[0], port: rec.to[1] }, { piece: top, port: rec.port }, pieces.length);
}

/** Which pieces raising from the joint between `from` and `into` would move, going into `into` (spec 16.3). */
export function previewRun(course: Course, from: PortRef, into: PortRef, count: number): RunPreview {
  const forward = runFrom(course, from, into, count);
  if (forward) {
    const last = forward.pieces[forward.pieces.length - 1];
    return { pieces: forward.pieces, end: farPort(course, last) };
  }
  const back = runBack(course, from, into, count);
  if (!back) return { pieces: [], end: null };
  const pieces = [...back.pieces].reverse();
  const top = course.pieces[pieces[pieces.length - 1]] as { to: [number, number] };
  return { pieces, end: { piece: top.to[0], port: top.to[1] } };
}

/** The port of a two-ended piece away from the one it hangs by. */
function farPort(course: Course, piece: number): PortRef | null {
  const rec = course.pieces[piece];
  return 'port' in rec && twoEnded(course, piece) ? { piece, port: 1 - rec.port } : null;
}

const DEG = 180 / Math.PI;

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
 * leaves the run level again. Going with the stored links, the pieces
 * beyond follow; going against them, the joint stays and everything joined
 * on the far side rises. Returns the course unchanged when the joint is
 * not a stored link.
 */
export function raiseRun(course: Course, from: PortRef, into: PortRef, count: number, rise: number): Course {
  const run = runFrom(course, from, into, count);
  if (run) return climbBy(course, run, rise);
  const back = runBack(course, from, into, count);
  if (!back) return course;
  // Going the links' way the run comes down to the joint; lift everything
  // joined to it back up so the joint stays where it was.
  const down = climbBy(course, back, -rise);
  return moveGroup(down, movingGroup(layoutCourse(down), from.piece), new Matrix4().makeTranslation(0, rise, 0));
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
