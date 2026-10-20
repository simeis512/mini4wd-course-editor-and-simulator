import { Vector3, type Matrix4 } from 'three';
import { getPart } from './catalog';
import { layoutCourse, type Course, type PortRef } from './course';
import { jointBend, linkHolder, setBend, setTwist } from './edit';

// Raising a run of pieces by bending its joints and twisting its pieces
// (spec 16.3, #54), e.g. a spiral of curves that passes over itself.

/** A run of pieces joined end to end by stored links, from a joint onwards. */
export interface Run {
  /** The pieces, in order along the run. */
  pieces: number[];
  /** The joint into each piece, then the joint out of the last one if a piece is linked there. */
  joints: [PortRef, PortRef][];
}

/**
 * Up to `count` pieces running on from the joint between `a` and `b`, the
 * way the stored links go: each piece hangs off the far port of the one
 * before. Stops early at a piece with more than two ports. Null when the
 * joint is not a stored link.
 */
export function runFrom(course: Course, a: PortRef, b: PortRef, count: number): Run | null {
  const first = linkHolder(course, a, b);
  if (first === null) return null;
  const entry = first === a.piece ? a : b;
  const run: Run = { pieces: [], joints: [[entry === a ? b : a, entry]] };
  let piece = first;
  for (;;) {
    run.pieces.push(piece);
    const rec = course.pieces[piece];
    if (!('to' in rec) || getPart(rec.part).ports.length !== 2) break;
    const out = { piece, port: 1 - rec.port };
    const next = course.pieces.findIndex((r) => 'to' in r && r.to[0] === out.piece && r.to[1] === out.port);
    if (next < 0) break;
    run.joints.push([out, { piece: next, port: (course.pieces[next] as { port: number }).port }]);
    if (run.pieces.length >= count || getPart(course.pieces[next].part).ports.length !== 2) break;
    piece = next;
  }
  return run;
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
 * Raise the run of `count` pieces from the joint between `a` and `b` by
 * `rise` mm (spec 16.3): the gradient is found so the far end of the last
 * piece ends up `rise` higher, and the road leaves the run level again.
 * Pieces beyond follow. Returns the course unchanged when the joint is not
 * a stored link.
 */
export function raiseRun(course: Course, a: PortRef, b: PortRef, count: number, rise: number): Course {
  const run = runFrom(course, a, b, count);
  if (!run) return course;
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
