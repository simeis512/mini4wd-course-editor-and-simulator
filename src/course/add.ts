import { getPart } from './catalog';
import { compatible, layoutCourse, portKey, type Course, type PortRef } from './course';
import { addPiece, footprint } from './edit';

/**
 * Join `partId` to the open port `at`. `port` fixes which of its ports
 * joins (the way round chosen in the parts list); otherwise the way round that real
 * parts allow wins (a bank approach's floor end on the level). Null when
 * the part cannot join there.
 */
export function joinPart(course: Course, partId: string, at: PortRef, port?: number): { course: Course; port: number } | null {
  const part = getPart(partId);
  const target = getPart(course.pieces[at.piece].part);
  const ports = part.ports
    .map((_, p) => p)
    .filter((p) => (port === undefined || p === port) && compatible(target, at.port, part, p));
  if (ports.length === 0) return null;
  const tries = ports.map((p) => addPiece(course, partId, at, p));
  const fits = tries.findIndex((c) => {
    const index = c.pieces.length - 1;
    return !layoutCourse(c).problems.some((pr) => pr.piece === index);
  });
  return { course: tries[Math.max(0, fits)], port: ports[Math.max(0, fits)] };
}

/**
 * The last piece's next open port other than the one it joined by `port`, to
 * keep going from (the lane change centre's upper port closes by itself).
 */
export function nextOpenPort(course: Course, port: number): PortRef | null {
  const index = course.pieces.length - 1;
  const part = getPart(course.pieces[index].part);
  const open = new Set(layoutCourse(course).open.map(portKey));
  const far = part.ports.findIndex((_, p) => p !== port && open.has(portKey({ piece: index, port: p })));
  return far >= 0 ? { piece: index, port: far } : null;
}

/**
 * The course with `partId` joined to the open port it would sit by when
 * dropped at (x, z), within `reach` mm of the middle of its footprint; null
 * when it lands by none (#40).
 */
export function dropJoin(course: Course, partId: string, port: number | undefined, x: number, z: number, reach: number): Course | null {
  // A piece filling a gap sits about as near from either end, so the way that closes it wins.
  let best: { next: Course; open: number; d: number } | null = null;
  for (const ref of layoutCourse(course).open) {
    const joined = joinPart(course, partId, ref, port);
    if (!joined) continue;
    const layout = layoutCourse(joined.course);
    const [x0, x1, z0, z1] = footprint(layout.pieces[layout.pieces.length - 1]);
    const d = Math.hypot((x0 + x1) / 2 - x, (z0 + z1) / 2 - z);
    const open = layout.open.length;
    if (d <= reach && (!best || open < best.open || (open === best.open && d < best.d))) best = { next: joined.course, open, d };
  }
  return best?.next ?? null;
}
