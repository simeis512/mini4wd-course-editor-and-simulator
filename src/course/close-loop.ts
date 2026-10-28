import { Matrix4, Quaternion, Vector3 } from 'three';
import { isLevel, layoutCourse, movingGroup, shiftedFrame, type Course, type Layout, type PortRef } from './course';
import { moveGroup, setBend, setTwist } from './edit';
import { facingError, FACE } from './geometry';

// Closing a loop by force (#86): the two open ends of a group are brought
// together by bending many joints and twisting many pieces a very little,
// as real joints give and pieces flex when a course that does not quite
// close is pushed together. Once they face each other they meet as an
// ordinary closure (spec 5.3).

/** Most a closing may add to one joint's pitch or yaw, or one piece's twist, deg (#86 決定事項, provisional). */
export const CLOSE_LOOP_LIMIT = 0.15;
/** How near the ends must come, mm and deg (#86 決定事項, provisional). */
export const CLOSE_LOOP_DISTANCE = 0.5;
export const CLOSE_LOOP_ANGLE = 0.1;
/** How far apart the ends may be for closing to be offered, mm per piece of the group (#86, owner 2026-10-26, provisional). */
export const CLOSE_LOOP_REACH_PER_PIECE = 1;
/** Shifts tried when the group already has shifted joints (#86 決定事項 8), as for closures (spec 5.3, #60). */
const SHIFTS = [0, -1, 1, -2, 2];
/** A piece is on the floor when all its ports are this near the floor, mm. */
const FLOOR_HEIGHT = 1;

/** Weights of the errors: 1 mm counts as much as 0.2°. */
const ANGLE_WEIGHT = 5;
const DEG = Math.PI / 180;

/** The two open ends of a group and how far they are from meeting. */
export interface LoopEnds {
  a: PortRef;
  b: PortRef;
  /** Lanes `b` meets `a` moved sideways by (#60). */
  shift: number;
  distance: number;
  angle: number;
}

/** A closing that worked, or how far from meeting the ends stay. */
export type CloseResult =
  | { ok: true; course: Course; ends: LoopEnds; /** Largest angle added anywhere, deg. */ largest: number }
  | { ok: false; distance: number; angle: number; reason: 'no-ends' | 'too-far' };

/**
 * The open ends of the group `piece` is in, when it has exactly two (#86):
 * the bridge approach's one-lane upper end does not count. Tried at a
 * sideways shift only when another joint of the group is shifted.
 */
export function loopEnds(layout: Layout, piece: number): LoopEnds | null {
  const group = movingGroup(layout, piece);
  const counted = layout.open.filter((r) => group.has(r.piece) && layout.pieces[r.piece].part.ports[r.port].kind !== 'lc-upper');
  if (counted.length !== 2) return null;
  const [a, b] = counted;
  const shifted = layout.joints.some((j) => j.shift && group.has(j.a.piece));
  let best: LoopEnds | null = null;
  for (const shift of shifted ? SHIFTS : [0]) {
    const err = endError(layout, a, b, shift);
    if (err && (!best || weighted(err) < weighted(best))) best = { a, b, shift, ...err };
  }
  return best;
}

/** How far apart the ends of `piece`'s group may be for closing to be offered, mm (#86): `CLOSE_LOOP_REACH_PER_PIECE` per piece. */
export function closeLoopReach(layout: Layout, piece: number): number {
  return movingGroup(layout, piece).size * CLOSE_LOOP_REACH_PER_PIECE;
}

const weighted = (e: { distance: number; angle: number }) => e.distance + ANGLE_WEIGHT * e.angle;

/** How far `b` is from facing `a` at `shift`; null when the ports cannot meet so. */
function endError(layout: Layout, a: PortRef, b: PortRef, shift: number): { distance: number; angle: number } | null {
  const [pa, pb] = [layout.pieces[a.piece], layout.pieces[b.piece]];
  const [da, db] = [pa.part.ports[a.port], pb.part.ports[b.port]];
  if (Math.abs(shift) > 0 && da.lanes.length < 2) return null;
  try {
    return facingError(shiftedFrame(pa.ports[a.port], da, db, shift), pb.ports[b.port]);
  } catch {
    return null;
  }
}

/** The pieces from `a`'s to `b`'s along joints, with the joint into each after the first. */
function pathBetween(layout: Layout, from: number, to: number): { pieces: number[]; joints: Layout['joints'] } | null {
  const via = new Map<number, Layout['joints'][number] | null>([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const i = queue.shift()!;
    if (i === to) break;
    for (const j of layout.joints) {
      const other = j.a.piece === i ? j.b.piece : j.b.piece === i ? j.a.piece : null;
      if (other === null || via.has(other)) continue;
      via.set(other, j);
      queue.push(other);
    }
  }
  if (!via.has(to)) return null;
  const pieces = [to];
  const joints: Layout['joints'] = [];
  for (let i = to; i !== from; ) {
    const j = via.get(i)!;
    joints.unshift(j);
    i = j.a.piece === i ? j.b.piece : j.a.piece;
    pieces.unshift(i);
  }
  return { pieces, joints };
}

/** Whether the joint's two pieces are still joined some other way without it. */
function inLoop(layout: Layout, joint: Layout['joints'][number]): boolean {
  const seen = new Set([joint.a.piece]);
  const queue = [joint.a.piece];
  while (queue.length) {
    const i = queue.shift()!;
    for (const j of layout.joints) {
      if (j === joint) continue;
      const other = j.a.piece === i ? j.b.piece : j.b.piece === i ? j.a.piece : null;
      if (other === null || seen.has(other)) continue;
      if (other === joint.b.piece) return true;
      seen.add(other);
      queue.push(other);
    }
  }
  return false;
}

/** A piece lying on the floor: every port level and at floor height. */
function onFloor(layout: Layout, i: number): boolean {
  return layout.pieces[i].ports.every((p) => Math.abs(p.elements[13]) < FLOOR_HEIGHT && isLevel(p));
}

/** One thing a closing may change: a joint's pitch or yaw (on the piece that holds the link), or a piece's twist. */
type Knob = { piece: number; what: 'pitch' | 'yaw' | 'twist'; /** Pieces along the way from the nearer open end. */ far: number };

/** The course with `x[k]` deg added to each knob, unrounded: a working course, never stored. */
function turned(course: Course, knobs: readonly Knob[], x: readonly number[]): Course {
  const next: Course = { ...course, pieces: course.pieces.slice() };
  knobs.forEach((k, n) => {
    if (!x[n]) return;
    const rec = { ...next.pieces[k.piece] } as Course['pieces'][number] & { bend?: { pitch?: number; yaw?: number }; twist?: number };
    if (k.what === 'twist') rec.twist = (rec.twist ?? 0) + x[n];
    else rec.bend = { ...rec.bend, [k.what]: (rec.bend?.[k.what] ?? 0) + x[n] };
    next.pieces[k.piece] = rec;
  });
  return next;
}

/** Rotation from frame `q` to frame `p` as a small turn about each axis, deg. */
function turnBetween(p: Quaternion, q: Quaternion): Vector3 {
  const d = p.clone().multiply(q.clone().invert());
  if (d.w < 0) d.set(-d.x, -d.y, -d.z, -d.w);
  const s = Math.sqrt(1 - Math.min(1, d.w * d.w));
  const angle = 2 * Math.acos(Math.min(1, d.w)) / DEG;
  return s < 1e-12 ? new Vector3() : new Vector3(d.x / s, d.y / s, d.z / s).multiplyScalar(angle);
}

/**
 * What is still wrong, weighted: where `b` is against where it should be
 * (mm, and its turn ×`ANGLE_WEIGHT`), then each floor piece's ports off the
 * floor and leaning (#86 決定事項 5: floor pieces stay on the floor).
 */
function residual(layout: Layout, ends: LoopEnds, floor: readonly number[], base: Layout): number[] {
  const { a, b, shift } = ends;
  const [pa, pb] = [layout.pieces[a.piece], layout.pieces[b.piece]];
  const want = shiftedFrame(pa.ports[a.port], pa.part.ports[a.port], pb.part.ports[b.port], shift).multiply(FACE);
  const at = pb.ports[b.port];
  const out = [...new Vector3().setFromMatrixPosition(at).sub(new Vector3().setFromMatrixPosition(want)).toArray()];
  const turn = turnBetween(new Quaternion().setFromRotationMatrix(at), new Quaternion().setFromRotationMatrix(want));
  out.push(...turn.multiplyScalar(ANGLE_WEIGHT).toArray());
  const up = new Vector3();
  for (const i of floor) {
    layout.pieces[i].ports.forEach((p, n) => {
      const was = base.pieces[i].ports[n];
      up.set(0, 1, 0).transformDirection(p);
      const upWas = new Vector3(0, 1, 0).transformDirection(was);
      out.push(p.elements[13] - was.elements[13], (up.x - upWas.x) / DEG * ANGLE_WEIGHT, (up.z - upWas.z) / DEG * ANGLE_WEIGHT);
    });
  }
  return out;
}

/**
 * The straight-line model of the residual near `x`: `r + J (y − x)`, kept as
 * its Gram form for speed. Minimising `|r + J (y − x)|² + Σ w_k y_k²` with
 * every `y` within ±`limit` is convex; `w` makes each knob dearer the
 * further it is from the open ends.
 */
class Model {
  private readonly G: number[][];
  private readonly q: number[];
  private readonly c2: number;

  constructor(J: readonly number[][], r: readonly number[], x: readonly number[], private readonly w: readonly number[]) {
    const n = x.length;
    // c = r − J x, so the residual is c + J y.
    const c = r.map((v, m) => v - J[m].reduce((s, j, k) => s + j * x[k], 0));
    this.G = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, k) => J.reduce((s, row) => s + row[i] * row[k], 0)));
    this.q = Array.from({ length: n }, (_, k) => J.reduce((s, row, m) => s + row[k] * c[m], 0));
    this.c2 = c.reduce((s, v) => s + v * v, 0);
  }

  /** |residual|² at `y`, on the model. */
  error(y: readonly number[]): number {
    let e = this.c2;
    y.forEach((yi, i) => {
      e += 2 * this.q[i] * yi;
      this.G[i].forEach((g, k) => (e += yi * g * y[k]));
    });
    return e;
  }

  /**
   * Best `y`, each within ±`limit`: an active-set search, solving exactly
   * for the free knobs with the rest held at a limit, freeing one that
   * pulls away from its limit or holding one that overshoots, until neither.
   */
  solve(limit: number): number[] {
    const { G, q } = this;
    const n = q.length;
    const at = new Array<number>(n).fill(0); // −1, 0 (free) or +1: which limit a knob is held at
    let y = new Array<number>(n).fill(0);
    for (let iter = 0; iter < 4 * n + 10; iter++) {
      const free = at.flatMap((s, k) => (s ? [] : [k]));
      const solved = this.freeSolve(free, at, limit);
      y = at.map((s) => s * limit);
      free.forEach((k, i) => (y[k] = solved[i]));
      // Hold the free knob furthest past its limit.
      let worst = -1;
      for (const k of free) if (Math.abs(y[k]) > limit + 1e-12 && (worst < 0 || Math.abs(y[k]) > Math.abs(y[worst]))) worst = k;
      if (worst >= 0) {
        at[worst] = Math.sign(y[worst]);
        continue;
      }
      // Free the held knob whose pull back inside is strongest.
      let release = -1;
      let pull = 1e-12;
      for (let k = 0; k < n; k++) {
        if (!at[k]) continue;
        const grad = G[k].reduce((s, g, i) => s + g * y[i], 0) + q[k] + this.w[k] * y[k];
        if (grad * at[k] > pull) [release, pull] = [k, grad * at[k]];
      }
      if (release < 0) break;
      at[release] = 0;
    }
    return y.map((v) => Math.max(-limit, Math.min(limit, v)));
  }

  /** The free knobs' best values with the others held at their limit. */
  private freeSolve(free: readonly number[], at: readonly number[], limit: number): number[] {
    const { G, q } = this;
    const m = free.length;
    const A = free.map((i) => {
      const row = free.map((k) => G[i][k] + (i === k ? this.w[i] : 0));
      const rhs = -q[i] - at.reduce((s, sgn, k) => s + (sgn ? G[i][k] * sgn * limit : 0), 0);
      return [...row, rhs];
    });
    for (let c = 0; c < m; c++) {
      let p = c;
      for (let i = c + 1; i < m; i++) if (Math.abs(A[i][c]) > Math.abs(A[p][c])) p = i;
      [A[c], A[p]] = [A[p], A[c]];
      for (let i = c + 1; i < m; i++) {
        const f = A[i][c] / A[c][c];
        if (f) for (let j = c; j <= m; j++) A[i][j] -= f * A[c][j];
      }
    }
    const x = new Array<number>(m).fill(0);
    for (let i = m - 1; i >= 0; i--) {
      let s = A[i][m];
      for (let j = i + 1; j < m; j++) s -= A[i][j] * x[j];
      x[i] = s / A[i][i];
    }
    return x;
  }

  /**
   * Nudge each knob by `step` either way, within ±`limit`, while that brings
   * the model's error down: for angles that must be whole steps.
   */
  polish(y: number[], step: number, limit: number): number[] {
    const { G, q } = this;
    const out = y.slice();
    const Gy = G.map((row) => row.reduce((s, g, k) => s + g * out[k], 0));
    for (let pass = 0; pass < POLISH_PASSES; pass++) {
      let better = false;
      for (let k = 0; k < out.length; k++) {
        for (const d of [step, -step]) {
          const next = out[k] + d;
          if (Math.abs(next) > limit + 1e-9) continue;
          // Change in |c + J y|² + Σ w y² from moving y[k] by d.
          const change = 2 * d * (Gy[k] + q[k]) + d * d * G[k][k] + this.w[k] * (next * next - out[k] * out[k]);
          if (change >= -1e-12) continue;
          for (let i = 0; i < out.length; i++) Gy[i] += G[i][k] * d;
          out[k] = next;
          better = true;
          break;
        }
      }
      if (!better) break;
    }
    return out;
  }
}

/** Most passes of nudging rounded angles. */
const POLISH_PASSES = 200;
/** How much small angles are preferred over a closer fit (mm² per deg²), so the change spreads over many knobs (#86 決定事項 4). */
const SMALL = 1e-2;
/**
 * How fast a knob gets dearer away from the open ends: by (1 + pieces
 * away)^FALLOFF. The ends take the change first and it fades out along
 * the course, rather than reaching far round to the start (owner
 * 2026-10-28, provisional).
 */
const FALLOFF = 3;

/** Step for the finite differences, deg. */
const PROBE = 0.01;
/** Rounds of re-linearising. */
const ROUNDS = 6;

/**
 * Bring the open ends of `piece`'s group together (#86): every joint on the
 * way between them may bend by up to `CLOSE_LOOP_LIMIT` more (pitch only
 * off the floor, yaw anywhere) and every two-ended piece off the floor may
 * twist as much more, most near the open ends and less the further from
 * them. The group then moves back
 * so its middle stays where it was and both ends come half way. Nothing is
 * changed when they cannot meet within `CLOSE_LOOP_DISTANCE` / `CLOSE_LOOP_ANGLE`.
 * `step` is the step the course stores angles in, deg.
 */
export function closeLoop(course: Course, piece: number, step: number): CloseResult {
  const round = (deg: number) => Math.round(deg / step) * step;
  const base = layoutCourse(course);
  const ends = loopEnds(base, piece);
  if (!ends) return { ok: false, distance: 0, angle: 0, reason: 'no-ends' };
  const path = pathBetween(base, ends.a.piece, ends.b.piece);
  const fail = (e: { distance: number; angle: number }): CloseResult => ({ ok: false, distance: e.distance, angle: e.angle, reason: 'too-far' });
  if (!path) return fail(ends);
  const floor = [...movingGroup(base, piece)].filter((i) => onFloor(base, i));
  const flat = new Set(floor);
  const knobs: Knob[] = [];
  const n = path.pieces.length;
  path.joints.forEach((j, k) => {
    // A joint inside another loop (such as a lane change's crossing) stays as it is, or that loop would open.
    if (j.kind !== 'link' || inLoop(base, j)) return;
    const holder = j.b.piece;
    const off = !flat.has(j.a.piece) || !flat.has(j.b.piece);
    // Joint k is between path pieces k and k + 1.
    const far = Math.min(k, n - 2 - k);
    knobs.push({ piece: holder, what: 'yaw', far });
    if (off) knobs.push({ piece: holder, what: 'pitch', far });
  });
  path.pieces.forEach((i, k) => {
    if (!flat.has(i) && base.pieces[i].part.ports.length === 2) knobs.push({ piece: i, what: 'twist', far: Math.min(k, n - 1 - k) });
  });
  // Scaled so the knobs are on average as dear as SMALL: only how the change is shared out moves.
  const rise = knobs.map((k) => (1 + k.far) ** FALLOFF);
  const mean = rise.reduce((s, v) => s + v, 0) / (rise.length || 1);
  const weights = rise.map((v) => (SMALL * v) / mean);
  if (!knobs.length) return fail(ends);

  let x = new Array<number>(knobs.length).fill(0);
  const at = (v: readonly number[]) => residual(layoutCourse(turned(course, knobs, v), base), ends, floor, base);
  let model: Model | null = null;
  for (let pass = 0; pass < ROUNDS; pass++) {
    const r = at(x);
    // Columns of the Jacobian by finite differences.
    const cols = knobs.map((_, k) => {
      const probe = x.slice();
      probe[k] += PROBE;
      return at(probe).map((v, m) => (v - r[m]) / PROBE);
    });
    model = new Model(r.map((_, m) => cols.map((col) => col[m])), r, x, weights);
    const next = model.solve(CLOSE_LOOP_LIMIT);
    const step = Math.max(...next.map((v, k) => Math.abs(v - x[k])));
    x = next;
    if (step < 1e-4) break;
  }
  // Round as the course stores angles, then nudge them a step at a time to make up for it.
  // The largest whole step within the limit.
  const most = Math.floor(CLOSE_LOOP_LIMIT / step + 1e-9) * step;
  x = model!.polish(x.map((v) => Math.max(-most, Math.min(most, round(v)))), step, most);

  // Store the changes, then put the middle back.
  let next = course;
  knobs.forEach((k, n) => {
    if (!x[n]) return;
    const rec = next.pieces[k.piece] as { to?: [number, number]; port?: number; bend?: { pitch?: number; yaw?: number }; twist?: number };
    if (k.what === 'twist') next = setTwist(next, k.piece, (rec.twist ?? 0) + x[n]);
    else {
      const [p, q] = rec.to!;
      next = setBend(next, { piece: p, port: q }, { piece: k.piece, port: rec.port! }, { ...rec.bend, [k.what]: (rec.bend?.[k.what] ?? 0) + x[n] });
    }
  });
  next = keepMiddle(next, base, path.pieces[Math.floor(path.pieces.length / 2)], piece);
  const done = layoutCourse(next);
  const err = endError(done, ends.a, ends.b, ends.shift) ?? ends;
  if (err.distance > CLOSE_LOOP_DISTANCE || err.angle > CLOSE_LOOP_ANGLE) return fail(err);
  const largest = Math.max(0, ...x.map(Math.abs));
  return { ok: true, course: next, ends: { ...ends, ...err }, largest };
}

/** Move the group back so `middle` is where it was in `base`, turning only about the vertical. */
function keepMiddle(course: Course, base: Layout, middle: number, piece: number): Course {
  const now = layoutCourse(course);
  const delta = base.pieces[middle].matrix.clone().multiply(now.pieces[middle].matrix.clone().invert());
  if (new Vector3().setFromMatrixPosition(delta).length() < 1e-3 && delta.elements[0] > 1 - 1e-9) return course;
  const forward = new Vector3(0, 0, 1).transformDirection(delta);
  const level = new Matrix4().makeRotationY(Math.atan2(forward.x, forward.z));
  const p = new Vector3().setFromMatrixPosition(now.pieces[middle].matrix).applyMatrix4(level);
  const goal = new Vector3().setFromMatrixPosition(base.pieces[middle].matrix);
  level.setPosition(goal.x - p.x, 0, goal.z - p.z);
  return moveGroup(course, movingGroup(now, piece), level);
}
