import { anchorRef, layoutCourse, sameJoint, shiftedFrame, settingsOf, type Course, type Joint, type Layout, type PieceRec, type PortRef } from './course';
import { ANGLE_STEP, clone } from './edit';
import { FACE, exactPose } from './geometry';

// Pieces whose ports meet are always stored as links (#131): nothing that
// looks joined is left placed on its own, which the user cannot see.

/** A course re-linked, and where its pieces came from: `order[k]` is the old index of piece `k`. */
export interface Relinked {
  course: Course;
  order: number[];
}

const unchanged = (course: Course): Relinked => ({ course, order: course.pieces.map((_, i) => i) });

const roundAngle = (deg: number) => Math.round(deg / ANGLE_STEP) * ANGLE_STEP;

/**
 * `course` with every pair of ports that meet stored as a link, except one
 * closure in each loop (spec 5.1, 5.3). In each group the first piece stays
 * where it is placed from; the links already stored stay, and closures
 * become links, those that meet most closely first, bent as they meet so
 * the pieces hardly move. A link that now has to be held from its other
 * side keeps its bend. Pieces are put in another
 * order where a link has to refer to a later piece; the first piece stays
 * first. Nothing changes if a joint would come apart. `previous`, a
 * layout to reuse unchanged placements from (#92).
 */
export function linkJoined(course: Course, previous?: Layout): Relinked {
  const layout = layoutCourse(course, previous);
  const n = course.pieces.length;
  const parent = course.pieces.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const tree: Joint[] = layout.joints.filter((j) => j.kind === 'link');
  for (const j of tree) parent[find(j.a.piece)] = find(j.b.piece);
  const closures = [...layout.closures].sort((p, q) => p.distance - q.distance || p.angle - q.angle);
  let added = false;
  for (const c of closures) {
    const [x, y] = [find(c.a.piece), find(c.b.piece)];
    if (x === y) continue;
    parent[x] = y;
    tree.push({ a: c.a, b: c.b, kind: 'closure', shift: c.shift });
    added = true;
  }
  if (!added) return unchanged(course);

  // Hang every piece off the one before it in its group's tree, from the group's first piece.
  const edges: [PortRef, PortRef, Joint][][] = course.pieces.map(() => []);
  for (const j of tree) {
    edges[j.a.piece].push([j.a, j.b, j]);
    edges[j.b.piece].push([j.b, j.a, j]);
  }
  const recs: PieceRec[] = [...course.pieces];
  const seen = new Set<number>();
  for (let root = 0; root < n; root++) {
    if (seen.has(root)) continue;
    seen.add(root);
    const queue = [root];
    while (queue.length) {
      const at = queue.shift()!;
      for (const [here, there, joint] of edges[at]) {
        if (seen.has(there.piece)) continue;
        seen.add(there.piece);
        queue.push(there.piece);
        recs[there.piece] = hungOff(course, layout, here, there, joint);
      }
    }
  }

  // Put each piece after the one it is placed from, keeping the old order where it can.
  const order: number[] = [];
  const placed = new Set<number>();
  while (order.length < n) {
    const next = recs.findIndex((rec, i) => {
      const ref = anchorRef(rec);
      return !placed.has(i) && (!ref || placed.has(ref[0]));
    });
    if (next < 0) return unchanged(course);
    placed.add(next);
    order.push(next);
  }
  const relinked = renumber(course, recs, order);
  const at = newIndex(order);
  const kept = layoutCourse(relinked).joints;
  const moved = (r: PortRef): PortRef => ({ piece: at[r.piece], port: r.port });
  const whole = layout.joints.every((j) => kept.some((k) => sameJoint(k, { a: moved(j.a), b: moved(j.b) })));
  return whole ? { course: relinked, order } : unchanged(course);
}

/**
 * The record for the piece on `child` hung off the port `base` across
 * `joint`: as stored when it already is, or else as a new link: a link
 * held from `child`'s side turned round, or a closure.
 */
function hungOff(course: Course, layout: Layout, base: PortRef, child: PortRef, joint: Joint): PieceRec {
  const rec = course.pieces[child.piece];
  if (joint.kind === 'link' && 'to' in rec && rec.to[0] === base.piece && rec.to[1] === base.port && rec.port === child.port) return rec;
  const out: PieceRec = { part: rec.part, port: child.port, to: [base.piece, base.port], ...settingsOf(rec) };
  if (joint.shift) out.shift = joint.shift;
  // The bend that keeps the piece turned as it is: a link turned round keeps its bend, a closure keeps the angle it meets at.
  const [here, there] = [layout.pieces[base.piece], layout.pieces[child.piece]];
  const from = shiftedFrame(here.ports[base.port], here.part.ports[base.port], there.part.ports[child.port], joint.shift);
  const turn = exactPose(from.invert().multiply(there.ports[child.port].clone().multiply(FACE)));
  const [yaw, pitch] = [roundAngle(turn.rot[0]), roundAngle(turn.rot[1])];
  if (yaw || pitch) out.bend = { ...(pitch ? { pitch } : {}), ...(yaw ? { yaw } : {}) };
  return out;
}

/** `newIndex(order)[old]` is where the old piece `old` went. */
function newIndex(order: number[]): number[] {
  const at: number[] = [];
  order.forEach((old, k) => (at[old] = k));
  return at;
}

/** `course` with the pieces `recs` put in `order`, and everything that names a piece following them. */
function renumber(course: Course, recs: PieceRec[], order: number[]): Course {
  const at = newIndex(order);
  const next = clone(course);
  next.pieces = order.map((old) => {
    const rec = structuredClone(recs[old]);
    const ref = anchorRef(rec);
    if (ref) ref[0] = at[ref[0]];
    return rec;
  });
  const marks = (list: [number, number][]) => list.map(([piece, port]): [number, number] => [at[piece], port]);
  if (next.cuts) next.cuts = marks(next.cuts);
  if (next.intended) next.intended = marks(next.intended);
  for (const a of next.attachments ?? []) a.piece = at[a.piece];
  if (next.start) next.start.piece = at[next.start.piece];
  if (next.timer) next.timer.piece = at[next.timer.piece];
  return next;
}

/** A port of the course before `linkJoined`, in the course after it. */
export function relinkedPort(order: number[], ref: PortRef): PortRef {
  return { piece: order.indexOf(ref.piece), port: ref.port };
}
