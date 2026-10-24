import { Matrix4, Vector3 } from 'three';
import type { Course, Layout, PlacedPiece, Stopper } from './course';
import { pieceMiddle, turnAboutMiddle } from './edit';
import { boxOutline, HOSE_DIAMETER, hoseCurve, hoseMiddle, moveStopper, scaleHose, turnStopper } from './stoppers';

/**
 * Drag handles on the selected piece, as in CAD (#62): arrows to slide it
 * along or across itself, a ring to turn it and an arrow to lift it. The
 * views draw them; the sums are here so both views share them.
 */

/** Where the handles sit on a piece: its middle, and the level directions along and across it (world, unit). */
export interface HandleFrame {
  centre: Vector3;
  along: Vector3;
  across: Vector3;
}

/**
 * A handle edit: slide by `mm` along a level direction, turn by `deg`
 * (+ anticlockwise from above), lift by `mm`, or grow by `factor` (hoses).
 */
export type HandleEdit =
  | { kind: 'slide'; dir: Vector3; mm: number }
  | { kind: 'turn'; deg: number }
  | { kind: 'lift'; mm: number }
  | { kind: 'scale'; factor: number };

/**
 * The handle frame of a placed piece. "Along" runs from its first port to its
 * second (the chord, which is the tangent at the middle of a curve); a piece
 * whose ports meet, or that has one port, uses the way it faces.
 */
export function handleFrame(pc: PlacedPiece): HandleFrame {
  const along = new Vector3();
  if (pc.ports.length >= 2) {
    along.setFromMatrixPosition(pc.ports[1]).sub(new Vector3().setFromMatrixPosition(pc.ports[0]));
    along.y = 0;
  }
  if (along.lengthSq() < 1) along.set(0, 0, 1).transformDirection(pc.matrix).setY(0);
  if (along.lengthSq() < 1e-9) along.set(0, 0, 1);
  along.normalize();
  // Left of "along" seen from above (parts' right is -X, so left is +X when facing +Z).
  const across = new Vector3(along.z, 0, -along.x);
  return { centre: pieceMiddle(pc), along, across };
}

/**
 * The handle frame of a hose or box on the floor: a box faces its open side
 * (+ Z turned by its yaw), a hose has no way it faces so it keeps the world's.
 */
export function stopperFrame(s: Stopper): HandleFrame {
  if (s.kind === 'hose') {
    const [x, z] = hoseMiddle(s);
    return { centre: new Vector3(x, 0, z), along: new Vector3(0, 0, 1), across: new Vector3(1, 0, 0) };
  }
  const t = (s.yaw * Math.PI) / 180;
  const along = new Vector3(Math.sin(t), 0, Math.cos(t));
  return { centre: new Vector3(s.x, 0, s.z), along, across: new Vector3(along.z, 0, -along.x) };
}

/** How far a hose or box reaches from the middle of its handles on the floor, mm, so its ring can go round it. */
export function stopperReach(s: Stopper): number {
  const c = stopperFrame(s).centre;
  const [pts, r] = s.kind === 'hose' ? [hoseCurve(s, 20), HOSE_DIAMETER / 2] : [boxOutline(s).outline, 0];
  return Math.max(...pts.map(([x, z]) => Math.hypot(x - c.x, z - c.z))) + r;
}

/** `course` with stopper `index` slid, turned or grown by a handle; stoppers stay on the floor. */
export function stopperEdit(course: Course, index: number, edit: HandleEdit): Course {
  switch (edit.kind) {
    case 'slide':
      return moveStopper(course, index, edit.dir.x * edit.mm, edit.dir.z * edit.mm);
    case 'turn':
      return turnStopper(course, index, edit.deg);
    case 'scale':
      return scaleHose(course, index, edit.factor);
    case 'lift':
      return course;
  }
}

/**
 * The point on a level ring round `centre` at `deg`. Turning a piece by `a`
 * (`turnAboutMiddle`) carries the point at `deg` to the one at `deg + a`.
 */
export function ringPoint(centre: Vector3, radius: number, deg: number): Vector3 {
  const t = (deg * Math.PI) / 180;
  return new Vector3(centre.x + radius * Math.sin(t), centre.y, centre.z + radius * Math.cos(t));
}

/** Samples taken round the ring to find the point nearest the pointer. */
const RING_SAMPLES = 360;

/**
 * The angle (degrees) of the point on the ring that shows nearest to `at` on
 * the screen, through `project` (world → screen); null when none shows.
 * Works for a ring seen at a slant as well as from straight above.
 */
export function nearestRingDeg(
  project: (p: Vector3) => [number, number] | null,
  centre: Vector3,
  radius: number,
  at: readonly [number, number],
): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (let i = 0; i < RING_SAMPLES; i++) {
    const deg = (i * 360) / RING_SAMPLES;
    const p = project(ringPoint(centre, radius, deg));
    if (!p) continue;
    const d = (p[0] - at[0]) ** 2 + (p[1] - at[1]) ** 2;
    if (d < bestD) [best, bestD] = [deg, d];
  }
  return best;
}

/** `deg` brought into (-180, 180]. */
export function wrapDeg(deg: number): number {
  const d = ((deg % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
}

/**
 * How far (mm) a pointer that moved from `from` to `to` on the screen has
 * gone along a direction that shows on screen as `axis` px per `mm` mm.
 * Movement across it is ignored. 0 when the direction does not show.
 */
export function alongScreen(axis: readonly [number, number], mm: number, from: readonly [number, number], to: readonly [number, number]): number {
  const len2 = axis[0] ** 2 + axis[1] ** 2;
  if (len2 < 1e-6) return 0;
  return (((to[0] - from[0]) * axis[0] + (to[1] - from[1]) * axis[1]) / len2) * mm;
}

/** `v` rounded to the nearest `step`. */
export function snapTo(v: number, step: number): number {
  return Math.round(v / step) * step || 0;
}

/** The lowest port of the pieces in `group`, mm above the floor. */
export function lowestPort(layout: Layout, group: Iterable<number>): number {
  let low = Infinity;
  for (const i of group) for (const port of layout.pieces[i].ports) low = Math.min(low, port.elements[13]);
  return low === Infinity ? 0 : low;
}

/**
 * The world transform for a handle edit of piece `index` (to give `moveGroup`
 * with the group that moves). A lift never takes the group's lowest port
 * below the floor (`low`, from `lowestPort`).
 */
export function handleMatrix(layout: Layout, index: number, edit: HandleEdit, low = Infinity): Matrix4 {
  switch (edit.kind) {
    case 'slide':
      return new Matrix4().makeTranslation(edit.dir.x * edit.mm, 0, edit.dir.z * edit.mm);
    case 'turn':
      return turnAboutMiddle(layout.pieces[index], edit.deg);
    case 'lift':
      return new Matrix4().makeTranslation(0, Math.max(edit.mm, -Math.max(low, 0)), 0);
    case 'scale':
      return new Matrix4();
  }
}
