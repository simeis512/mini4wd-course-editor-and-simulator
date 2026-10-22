import { Matrix4 } from 'three';
import { blockFootprint, offsetFrame, type Block } from './blocks';
import type { CatchBox, Course, Hose, Stopper } from './course';
import { insidePolygon } from './mesh';

// Hoses and cardboard boxes laid on the floor round the course to stop
// machines that fly off it (#53).

/** A garden hose's outside diameter, mm (#53 決定事項, provisional). */
export const HOSE_DIAMETER = 15;

/** Colours a hose can be. Order is part of the URL format: append only. */
export const HOSE_COLORS: readonly { name: string; color: string }[] = [
  { name: 'ブルー', color: '#2f7fd8' },
  { name: 'グリーン', color: '#3a9a4a' },
  { name: 'オレンジ', color: '#ee7d22' },
  { name: 'イエロー', color: '#f0c419' },
  { name: 'グレー', color: '#8a8f98' },
];

/**
 * Box sizes as they stand open side up, mm: width and depth on the floor
 * and height (#53 決定事項: small, medium and large, provisional). Order is
 * part of the URL format: append only.
 */
export const BOX_SIZES: readonly { name: string; width: number; depth: number; height: number }[] = [
  { name: '小', width: 300, depth: 220, height: 180 },
  { name: '中', width: 400, depth: 300, height: 250 },
  { name: '大', width: 500, depth: 380, height: 320 },
];

/** Thickness of a box's cardboard, mm (cosmetic). */
const CARDBOARD = 5;
/** Radius of a new hose's loop, mm (provisional: the loops in hose-loops-*.jpg). */
const LOOP_RADIUS = 200;
/** Points round a new hose's loop. */
const LOOP_POINTS = 6;
/** Fewest points a hose keeps: two for a line, three for a loop. */
const minPoints = (h: Hose) => (h.closed ? 3 : 2);

export const hoseColor = (h: Hose): string => (HOSE_COLORS[h.color] ?? HOSE_COLORS[0]).color;
export const boxSize = (b: CatchBox) => BOX_SIZES[b.size] ?? BOX_SIZES[0];

/**
 * The hose as laid: a smooth curve through its points (Catmull–Rom), back
 * to the first when closed, sampled about `step` mm apart (X, Z).
 */
export function hoseCurve(h: Hose, step = 10): [number, number][] {
  const p = h.points;
  const out: [number, number][] = [];
  const spans = h.closed ? p.length : p.length - 1;
  for (let i = 0; i < spans; i++) {
    const [a, b] = [p[i], p[(i + 1) % p.length]];
    const count = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < count; k++) out.push(spanPoint(h, i, k / count));
  }
  out.push(h.closed ? [...p[0]] : [...p[p.length - 1]]);
  return out;
}

/** The point `t` (0 to 1) of the way along a hose's span from point `i` to the next. */
function spanPoint(h: Hose, i: number, t: number): [number, number] {
  const p = h.points;
  const n = p.length;
  const at = (j: number) => (h.closed ? p[((j % n) + n) % n] : p[Math.min(n - 1, Math.max(0, j))]);
  const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
  const [t2, t3] = [t * t, t * t * t];
  const c = (j: 0 | 1) => 0.5 * (2 * p1[j] + (p2[j] - p0[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (3 * p1[j] - p0[j] - 3 * p2[j] + p3[j]) * t3);
  return [c(0), c(1)];
}

/** How long a hose is, mm: what to cut for it. */
export function hoseLength(h: Hose): number {
  const c = hoseCurve(h);
  let sum = 0;
  for (let i = 1; i < c.length; i++) sum += Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]);
  return sum;
}

/** A box's frame on the floor: its middle, turned to face its open side. */
function boxFrame(b: CatchBox): Matrix4 {
  return new Matrix4().makeTranslation(b.x, 0, b.z).multiply(new Matrix4().makeRotationY((b.yaw * Math.PI) / 180));
}

/**
 * A box as cardboard panels, world mm. Open side up, or by default laid on
 * its side with the open side facing + Z turned by its yaw, so machines fly
 * into it (#53 決定事項).
 */
export function boxBlocks(b: CatchBox): Block[] {
  const f = boxFrame(b);
  const { width: w, depth: d, height: h } = boxSize(b);
  const t = CARDBOARD;
  const panel = (right: number, up: number, along: number, size: [number, number, number]): Block => ({ role: 'box', frame: offsetFrame(f, right, up, along), size });
  // Panels meet edge to edge without overlapping, so no faces fight in 3D.
  if (b.upright) {
    const y = t + (h - t) / 2;
    return [
      panel(0, t / 2, 0, [w, t, d]),
      panel(-(w - t) / 2, y, 0, [t, h - t, d]),
      panel((w - t) / 2, y, 0, [t, h - t, d]),
      panel(0, y, -(d - t) / 2, [w - 2 * t, h - t, t]),
      panel(0, y, (d - t) / 2, [w - 2 * t, h - t, t]),
    ];
  }
  // On its side: its height lies along + Z, its depth stands up and its bottom is at the back.
  return [
    panel(0, d / 2, -(h - t) / 2, [w, d, t]),
    panel(-(w - t) / 2, d / 2, t / 2, [t, d, h - t]),
    panel((w - t) / 2, d / 2, t / 2, [t, d, h - t]),
    panel(0, t / 2, t / 2, [w - 2 * t, t, h - t]),
    panel(0, d - t / 2, t / 2, [w - 2 * t, t, h - t]),
  ];
}

/** A box seen from above: its outline, and the edge of its open side when that faces sideways (X, Z). */
export function boxOutline(b: CatchBox): { outline: [number, number][]; open: [number, number][] | null } {
  const { width: w, depth: d, height: h } = boxSize(b);
  const f = boxFrame(b);
  const outline = blockFootprint({ role: 'box', frame: f, size: [w, 0, b.upright ? d : h] });
  if (b.upright) return { outline, open: null };
  const edge = blockFootprint({ role: 'box', frame: offsetFrame(f, 0, 0, h / 2), size: [w, 0, 0] });
  return { outline, open: edge };
}

/** Distance from (x, z) to a polyline, mm. */
function distanceToLine(x: number, z: number, line: readonly [number, number][]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [[ax, az], [bx, bz]] = [line[i - 1], line[i]];
    const [dx, dz] = [bx - ax, bz - az];
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(ax + t * dx - x, az + t * dz - z));
  }
  return best;
}

/** The stopper at the floor point (x, z), `slack` mm round it allowed; the last laid first. */
export function stopperAt(stoppers: readonly Stopper[], x: number, z: number, slack = 0): number | null {
  for (let i = stoppers.length - 1; i >= 0; i--) {
    const s = stoppers[i];
    if (s.kind === 'hose' ? distanceToLine(x, z, hoseCurve(s)) <= HOSE_DIAMETER / 2 + slack : insidePolygon(x, z, boxOutline(s).outline)) return i;
  }
  return null;
}

/** The point of a hose at (x, z), within `slack` mm; the nearest wins. */
export function hosePointAt(h: Hose, x: number, z: number, slack: number): number | null {
  let best: number | null = null;
  let near = slack;
  h.points.forEach(([px, pz], k) => {
    const d = Math.hypot(px - x, pz - z);
    if (d <= near) [best, near] = [k, d];
  });
  return best;
}

/** How far the stoppers reach on the floor, mm: [x0, x1, z0, z1], or null when there are none. */
export function stopperBounds(stoppers: readonly Stopper[]): [number, number, number, number] | null {
  if (!stoppers.length) return null;
  let [x0, x1, z0, z1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const s of stoppers) {
    const [pts, r] = s.kind === 'hose' ? [hoseCurve(s, 20), HOSE_DIAMETER / 2] : [boxOutline(s).outline, 0];
    for (const [x, z] of pts) [x0, x1, z0, z1] = [Math.min(x0, x - r), Math.max(x1, x + r), Math.min(z0, z - r), Math.max(z1, z + r)];
  }
  return [x0, x1, z0, z1];
}

/** A new hose laid as a loop round (x, z), or a new box there lying open towards + Z. */
export function newStopper(kind: 'hose' | 'box', x: number, z: number, size = 1): Stopper {
  if (kind === 'box') return { kind, size, x: Math.round(x), z: Math.round(z), yaw: 0 };
  const points = Array.from({ length: LOOP_POINTS }, (_, i): [number, number] => {
    const a = (i / LOOP_POINTS) * 2 * Math.PI;
    return [Math.round(x + LOOP_RADIUS * Math.cos(a)), Math.round(z + LOOP_RADIUS * Math.sin(a))];
  });
  return { kind, points, closed: true, color: 0 };
}

/** Change the stoppers through `edit`, which gets a copy. */
function withStoppers(course: Course, edit: (list: Stopper[]) => void): Course {
  const next = structuredClone(course);
  const list = next.stoppers ?? [];
  edit(list);
  if (list.length) next.stoppers = list;
  else delete next.stoppers;
  return next;
}

export function addStopper(course: Course, s: Stopper): Course {
  return withStoppers(course, (list) => list.push(structuredClone(s)));
}

export function removeStopper(course: Course, index: number): Course {
  return withStoppers(course, (list) => list.splice(index, 1));
}

/** Move a stopper, or one point of a hose, across the floor by (dx, dz) mm, to whole mm. */
export function moveStopper(course: Course, index: number, dx: number, dz: number, point?: number): Course {
  return withStoppers(course, (list) => {
    const s = list[index];
    const by = ([x, z]: [number, number]): [number, number] => [Math.round(x + dx), Math.round(z + dz)];
    if (s.kind === 'box') [s.x, s.z] = by([s.x, s.z]);
    else if (point !== undefined) s.points[point] = by(s.points[point]);
    else s.points = s.points.map(by);
  });
}

/** Turn a stopper about its middle by `deg`, + to the left (anticlockwise from above), as pieces turn. */
export function turnStopper(course: Course, index: number, deg: number): Course {
  return withStoppers(course, (list) => {
    const s = list[index];
    if (s.kind === 'box') {
      s.yaw = Math.round((((s.yaw + deg) % 360) + 540) % 360 - 180) || 0;
      return;
    }
    const cx = s.points.reduce((sum, p) => sum + p[0], 0) / s.points.length;
    const cz = s.points.reduce((sum, p) => sum + p[1], 0) / s.points.length;
    // The same turn as a piece's: about + Y.
    const [c, n] = [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
    s.points = s.points.map(([x, z]) => [Math.round(cx + (x - cx) * c + (z - cz) * n) || 0, Math.round(cz - (x - cx) * n + (z - cz) * c) || 0]);
  });
}

/** Change a hose's colour or whether it is a loop, or a box's size or way up. */
export function setStopper(course: Course, index: number, to: { color?: number; closed?: boolean; size?: number; upright?: boolean }): Course {
  return withStoppers(course, (list) => {
    const s = list[index];
    if (s.kind === 'hose') {
      if (to.color !== undefined) s.color = to.color;
      if (to.closed) s.closed = s.points.length >= 3;
      else if (to.closed === false) delete s.closed;
    } else {
      if (to.size !== undefined) s.size = to.size;
      if (to.upright) s.upright = true;
      else if (to.upright === false) delete s.upright;
    }
  });
}

/** Add a point to a hose halfway along the span after point `after` (by default the longest span). */
export function insertHosePoint(course: Course, index: number, after?: number): Course {
  return withStoppers(course, (list) => {
    const h = list[index] as Hose;
    const n = h.points.length;
    const spans = h.closed ? n : n - 1;
    const len = (i: number) => Math.hypot(h.points[(i + 1) % n][0] - h.points[i][0], h.points[(i + 1) % n][1] - h.points[i][1]);
    const k = after !== undefined && after < spans ? after : Array.from({ length: spans }, (_, i) => i).reduce((a, b) => (len(b) > len(a) ? b : a), 0);
    // Halfway along the curve, not the straight between the points, so the hose keeps its shape.
    const [x, z] = spanPoint(h, k, 0.5);
    h.points.splice(k + 1, 0, [Math.round(x), Math.round(z)]);
  });
}

/** Take a point off a hose, keeping enough for its shape. */
export function removeHosePoint(course: Course, index: number, point: number): Course {
  const h = course.stoppers?.[index];
  if (h?.kind !== 'hose' || h.points.length <= minPoints(h)) return course;
  return withStoppers(course, (list) => (list[index] as Hose).points.splice(point, 1));
}
