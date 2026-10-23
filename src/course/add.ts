import { Vector3 } from 'three';
import { getPart, partOf } from './catalog';
import { compatible, emptyCourse, layoutCourse, portKey, type Course, type PortRef } from './course';
import { addFreePiece, addPiece, freeSpot, setLength } from './edit';
import { FACE } from './geometry';
import { addedBounds, addFreeTemplate, joinTemplate } from './templates';

/** What a button in the parts list adds: a part, the way round chosen if any, or a template (#63). */
export type PaletteItem = { part: string; port?: number } | { template: string };

/**
 * Join `partId` to the open port `at`. `port` fixes which of its ports
 * joins (the way round chosen in the parts list); otherwise the way round that real
 * parts allow wins (a bank approach's floor end on the level). Null when
 * the part cannot join there.
 */
export function joinPart(course: Course, partId: string, at: PortRef, port?: number): { course: Course; port: number } | null {
  const part = getPart(partId);
  const target = partOf(course.pieces[at.piece]);
  const ports = part.ports
    .map((_, p) => p)
    .filter((p) => (port === undefined || p === port) && compatible(target, at.port, part, p));
  if (ports.length === 0) return null;
  const tries = ports.map((p) => addPiece(course, partId, at, p));
  const fits = tries.findIndex((c) => {
    const index = c.pieces.length - 1;
    return !layoutCourse(c).problems.some((pr) => pr.piece === index);
  });
  const chosen = tries[Math.max(0, fits)];
  return { course: fitLength(chosen, chosen.pieces.length - 1), port: ports[Math.max(0, fits)] };
}

/**
 * A piece of a part that sets its own length (#69) made as long as it takes
 * for its far end to meet an open port straight ahead, closing the gap there
 * (loop closure, spec 5.3); the nearest such port when there are several.
 * The course as it is when no port within its range lines up.
 */
export function fitLength(course: Course, index: number): Course {
  const rec = course.pieces[index];
  const range = getPart(rec.part).lengths;
  if (!range || !('port' in rec)) return course;
  const layout = layoutCourse(course);
  const far = 1 - rec.port;
  // Looking from the near end into the piece: + Z ahead.
  const ahead = layout.pieces[index].ports[rec.port].clone().multiply(FACE).invert();
  const lengths = layout.open
    .filter((r) => r.piece !== index)
    .map((r) => Math.round(new Vector3().setFromMatrixPosition(layout.pieces[r.piece].ports[r.port]).applyMatrix4(ahead).z))
    .filter((z) => z >= range.min && z <= range.max)
    .sort((a, b) => a - b);
  for (const length of lengths) {
    const next = setLength(course, index, length);
    if (layoutCourse(next).closures.some((c) => [c.a, c.b].some((r) => r.piece === index && r.port === far))) return next;
  }
  return course;
}

/**
 * The last piece's next open port other than the one it joined by `port`, to
 * keep going from (the lane change centre's upper port closes by itself).
 */
export function nextOpenPort(course: Course, port: number): PortRef | null {
  const index = course.pieces.length - 1;
  const part = partOf(course.pieces[index]);
  const open = new Set(layoutCourse(course).open.map(portKey));
  const far = part.ports.findIndex((_, p) => p !== port && open.has(portKey({ piece: index, port: p })));
  return far >= 0 ? { piece: index, port: far } : null;
}

/**
 * Join `item` to the open port `at`. `port` is the port its last piece joins
 * by, to go on from. Null when it cannot join there.
 */
export function joinItem(course: Course, item: PaletteItem, at: PortRef): { course: Course; port: number } | null {
  return 'template' in item ? joinTemplate(course, item.template, at) : joinPart(course, item.part, at, item.port);
}

/** Add `item` on its own, lying on the floor, with the middle of its footprint at (x, z). */
export function addFreeItem(course: Course, item: PaletteItem, x: number, z: number): Course {
  return 'template' in item ? addFreeTemplate(course, item.template, x, z) : addFreePiece(course, item.part, item.port ?? 0, x, z);
}

/** The nearest spot to (x, z) on a `step` mm grid where `item` added on its own overlaps no piece (#41). */
export function itemSpot(course: Course, item: PaletteItem, x: number, z: number, step?: number): [number, number] {
  return freeSpot(course, addedBounds(addFreeItem(emptyCourse(), item, 0, 0), 0), x, z, step);
}

/**
 * The course with `item` joined to the open port it would sit by when
 * dropped at (x, z), within `reach` mm of the middle of its footprint; null
 * when it lands by none (#40).
 */
export function dropJoin(course: Course, item: PaletteItem, x: number, z: number, reach: number): Course | null {
  // A piece filling a gap sits about as near from either end, so the way that closes it wins.
  let best: { next: Course; open: number; d: number } | null = null;
  for (const ref of layoutCourse(course).open) {
    const joined = joinItem(course, item, ref);
    if (!joined) continue;
    const [x0, x1, z0, z1] = addedBounds(joined.course, course.pieces.length);
    const d = Math.hypot((x0 + x1) / 2 - x, (z0 + z1) / 2 - z);
    const open = layoutCourse(joined.course).open.length;
    if (d <= reach && (!best || open < best.open || (open === best.open && d < best.d))) best = { next: joined.course, open, d };
  }
  return best?.next ?? null;
}
