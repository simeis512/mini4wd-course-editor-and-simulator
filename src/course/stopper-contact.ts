import { Vector3, type Matrix4 } from 'three';
import { blockCorners, blockFootprint } from './blocks';
import { GLOBAL_SPEC } from './catalog';
import type { Layout } from './course';
import { partStands, pointOnFrame, STAND_BEAM, STAND_DEPTH, STAND_LEG, type Stand } from './geometry';
import { supports } from './height';
import { insidePolygon, worldTracks } from './mesh';
import { boxOutline, boxSize, hoseCurve, HOSE_DIAMETER } from './stoppers';
import { timerBlocks } from './timing';

// Hoses and boxes on the floor that run into the course, its supports, the
// lap timer or each other (#53). Shapes are compared from above, each with
// the heights it takes up, so a box under raised road is fine as long as
// it is lower than the road.

/** What a stopper runs into. */
export type ContactTarget = { kind: 'piece'; piece: number } | { kind: 'support'; piece: number } | { kind: 'timer' } | { kind: 'stopper'; index: number };

/** A stopper running into something, and a point where they meet (world mm). */
export interface StopperContact {
  kind: 'stopper';
  stopper: number;
  other: ContactTarget;
  at: Vector3;
}

/** Floor point (X, Z). */
type P = readonly [number, number];

/**
 * Something seen from above: an area (`poly`, convex) or a line as thick as
 * `radius` each side, with the heights it takes up and its bounds.
 */
interface Shape {
  poly?: P[];
  line?: P[];
  radius: number;
  y: [number, number];
  box: [number, number, number, number];
}

function shape(pts: P[], kind: 'poly' | 'line', y: [number, number], radius = 0): Shape {
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const box: Shape['box'] = [Math.min(...xs) - radius, Math.max(...xs) + radius, Math.min(...zs) - radius, Math.max(...zs) + radius];
  return { [kind]: pts, radius, y, box };
}

const { roadThickness, fenceHeight } = GLOBAL_SPEC;

/** A track's road and fences as one quad per sample step. */
function trackShapes(samples: readonly Matrix4[], left: number, right: number): Shape[] {
  const l = samples.map((f) => pointOnFrame(f, left, 0));
  const r = samples.map((f) => pointOnFrame(f, right, 0));
  const out: Shape[] = [];
  for (let i = 0; i + 1 < samples.length; i++) {
    const c = [l[i], l[i + 1], r[i + 1], r[i]];
    const ys = c.map((v) => v.y);
    out.push(shape(c.map((v): P => [v.x, v.z]), 'poly', [Math.min(...ys) - roadThickness, Math.max(...ys) + fenceHeight]));
  }
  return out;
}

/** A stand's two legs from the floor and the crossbar between them (as `buildSupportMesh` draws it). */
function standShapes({ left, right, along, depth = STAND_DEPTH }: Stand): Shape[] {
  const across = right.clone().sub(left).setY(0).normalize();
  const half = along.clone().multiplyScalar(depth / 2);
  const slab = (a: Vector3, b: Vector3, y: [number, number]) =>
    shape([a.clone().sub(half), b.clone().sub(half), b.clone().add(half), a.clone().add(half)].map((v): P => [v.x, v.z]), 'poly', y);
  const l2 = left.clone().addScaledVector(across, STAND_LEG);
  const r2 = right.clone().addScaledVector(across, -STAND_LEG);
  return [slab(left, l2, [0, left.y]), slab(r2, right, [0, right.y]), slab(l2, r2, [Math.min(l2.y, r2.y) - STAND_BEAM, Math.max(l2.y, r2.y)])];
}

/** The things stoppers can run into, other than stoppers. */
function obstacles(layout: Layout): { target: ContactTarget; shapes: Shape[] }[] {
  const out: { target: ContactTarget; shapes: Shape[] }[] = [];
  const tracks = worldTracks(layout);
  for (const t of tracks) out.push({ target: { kind: 'piece', piece: t.piece }, shapes: trackShapes(t.samples, t.section.left, t.section.right) });
  for (const [piece, pc] of layout.pieces.entries()) {
    const own = partStands(pc.part, pc.geometry).map((s) => ({
      left: s.left.clone().applyMatrix4(pc.matrix),
      right: s.right.clone().applyMatrix4(pc.matrix),
      along: s.along.clone().transformDirection(pc.matrix),
      depth: s.depth,
    }));
    if (own.length) out.push({ target: { kind: 'support', piece }, shapes: own.flatMap(standShapes) });
  }
  for (const s of supports(layout, tracks)) out.push({ target: { kind: 'support', piece: s.piece }, shapes: standShapes(s) });
  if (layout.timer) {
    // Its body and top; the tape lies flat on the road.
    const shapes = timerBlocks(layout, layout.timer)
      .slice(0, 2)
      .map((b) => {
        const ys = blockCorners(b).map((v) => v.y);
        return shape(blockFootprint(b), 'poly', [Math.min(...ys), Math.max(...ys)]);
      });
    out.push({ target: { kind: 'timer' }, shapes });
  }
  return out;
}

/** Spans of hose tested as one piece, each with its own bounds, so a long hose is quick to test. */
const HOSE_CHUNK = 8;

/** A stopper from above, with its height: a box as one area, a hose as short stretches of line. */
function stopperShapes(layout: Layout, index: number): Shape[] {
  const s = layout.stoppers[index];
  if (s.kind === 'box') {
    const { depth, height } = boxSize(s);
    return [shape(boxOutline(s).outline, 'poly', [0, s.upright ? height : depth])];
  }
  const curve = hoseCurve(s);
  const out: Shape[] = [];
  for (let i = 0; i + 1 < curve.length; i += HOSE_CHUNK) out.push(shape(curve.slice(i, i + HOSE_CHUNK + 1), 'line', [0, HOSE_DIAMETER], HOSE_DIAMETER / 2));
  return out;
}

/** Bounds round shapes. */
function bounds(shapes: readonly Shape[]): Shape['box'] {
  return [Math.min(...shapes.map((s) => s.box[0])), Math.max(...shapes.map((s) => s.box[1])), Math.min(...shapes.map((s) => s.box[2])), Math.max(...shapes.map((s) => s.box[3]))];
}

const apart = (a: Shape['box'], b: Shape['box']) => a[1] <= b[0] || b[1] <= a[0] || a[3] <= b[2] || b[3] <= a[2];

/** Where any of one set of shapes overlaps any of another, or null. */
function overlapAny(a: readonly Shape[], b: readonly Shape[]): Vector3 | null {
  for (const s of a) {
    for (const t of b) {
      const at = overlap(s, t);
      if (at) return at;
    }
  }
  return null;
}

/** Edges of a shape: a closed area's sides, or a line's spans. */
function edges(s: Shape): [P, P][] {
  if (s.line) return s.line.slice(1).map((p, i) => [s.line![i], p]);
  const p = s.poly!;
  return p.map((q, i) => [q, p[(i + 1) % p.length]]);
}

const cross = (o: P, a: P, b: P) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Nearest point of segment ab to p, and how far it is. */
function toSegment(p: P, a: P, b: P): { d: number; at: P } {
  const [dx, dz] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  const at: P = [a[0] + t * dx, a[1] + t * dz];
  return { d: Math.hypot(at[0] - p[0], at[1] - p[1]), at };
}

/**
 * How far apart two segments are, and a point between them; crossing ones
 * are -1 apart, so that only touching end to end or side by side is 0.
 */
function segments(a: P, b: P, c: P, d: P): { d: number; at: P } {
  const [d1, d2, d3, d4] = [cross(c, d, a), cross(c, d, b), cross(a, b, c), cross(a, b, d)];
  if (d1 * d2 < 0 && d3 * d4 < 0) {
    const t = d1 / (d1 - d2);
    return { d: -1, at: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])] };
  }
  let best = { d: Infinity, at: a };
  for (const [p, q, r] of [
    [a, c, d],
    [b, c, d],
    [c, a, b],
    [d, a, b],
  ] as const) {
    const n = toSegment(p, q, r);
    if (n.d < best.d) best = { d: n.d, at: [(n.at[0] + p[0]) / 2, (n.at[1] + p[1]) / 2] };
  }
  return best;
}

/** Areas that only touch, or overlap less than this, mm, are not running into each other. */
const TOUCH = 0.5;

/** Where two convex areas overlap by more than `TOUCH` (separating axes), or null. */
function areas(a: readonly P[], b: readonly P[]): P | null {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const [p, q] = [poly[i], poly[(i + 1) % poly.length]];
      const [nx, nz] = [q[1] - p[1], p[0] - q[0]];
      const len = Math.hypot(nx, nz);
      if (!len) continue;
      const along = (v: P) => (v[0] * nx + v[1] * nz) / len;
      const [pa, pb] = [a.map(along), b.map(along)];
      if (Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb)) <= TOUCH) return null;
    }
  }
  // Somewhere in the overlap: the corners of each that lie in the other.
  const within = [...a.filter((v) => insidePolygon(v[0], v[1], b)), ...b.filter((v) => insidePolygon(v[0], v[1], a))];
  const pts = within.length ? within : [...a, ...b];
  return [pts.reduce((s, v) => s + v[0], 0) / pts.length, pts.reduce((s, v) => s + v[1], 0) / pts.length];
}

/** Where a thick line comes within `reach` of an area or another line, or null. */
function lines(a: Shape, b: Shape): P | null {
  const reach = a.radius + b.radius - TOUCH;
  for (const [s, t] of [
    [a, b],
    [b, a],
  ]) {
    if (!t.poly) continue;
    const p = s.line?.find((q) => insidePolygon(q[0], q[1], t.poly!));
    if (p) return p;
  }
  for (const [p, q] of edges(a)) {
    for (const [r, s] of edges(b)) {
      const n = segments(p, q, r, s);
      if (n.d < reach) return n.at;
    }
  }
  return null;
}

/**
 * Where two shapes overlap, or null: their heights must overlap, and so
 * must they from above. Only touching is not running into each other.
 */
function overlap(a: Shape, b: Shape): Vector3 | null {
  const [ya, yb] = [a.y, b.y];
  if (ya[1] <= yb[0] || yb[1] <= ya[0]) return null;
  if (apart(a.box, b.box)) return null;
  const at = a.poly && b.poly ? areas(a.poly, b.poly) : lines(a, b);
  return at && new Vector3(at[0], (Math.max(ya[0], yb[0]) + Math.min(ya[1], yb[1])) / 2, at[1]);
}

/**
 * Stoppers that run into the course (its road and fences, as high as the
 * fence tops), its supports, the lap timer, or another stopper (#53). Each
 * pair is reported once.
 */
export function stopperContacts(layout: Layout): StopperContact[] {
  if (!layout.stoppers.length) return [];
  const mine = layout.stoppers.map((_, i) => stopperShapes(layout, i));
  const mineBox = mine.map(bounds);
  const others = obstacles(layout).map((o) => ({ ...o, box: bounds(o.shapes) }));
  const out: StopperContact[] = [];
  const found = new Set<string>();
  for (const [stopper, shapes] of mine.entries()) {
    for (const o of others) {
      // A piece's tracks and stands come one by one: report each piece once.
      const key = `${stopper}:${JSON.stringify(o.target)}`;
      if (found.has(key) || apart(mineBox[stopper], o.box)) continue;
      const at = overlapAny(shapes, o.shapes);
      if (!at) continue;
      found.add(key);
      out.push({ kind: 'stopper', stopper, other: o.target, at });
    }
    for (let index = stopper + 1; index < mine.length; index++) {
      const at = apart(mineBox[stopper], mineBox[index]) ? null : overlapAny(shapes, mine[index]);
      if (at) out.push({ kind: 'stopper', stopper, other: { kind: 'stopper', index }, at });
    }
  }
  return out;
}
