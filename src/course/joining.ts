import { compatible, layoutCourse, movingGroup, portKey, type Course, type Layout, type PortRef } from './course';
import { clone, freeRec, moveGroup, uncut } from './edit';
import { FACE, facingError, IDENTITY_POSE } from './geometry';

// Joining, splitting and the magnet that pulls ports together (spec 5.2, 5.3, 8).

/** Open ports closer than this pull together while dragging (spec 8). */
export const MAGNET_DISTANCE = 40;
export const MAGNET_ANGLE = 10;

export interface Magnet {
  /** Port on the moving pieces. */
  moving: PortRef;
  /** Open port on a piece that stays put. */
  fixed: PortRef;
}

/**
 * The nearest pair of loose ports, one on the moving pieces and one on the
 * rest, that are close enough to pull together. Split ports count too, so
 * dropping a piece back where it was joins it again.
 */
export function findMagnet(course: Course, group: Set<number>, distance = MAGNET_DISTANCE): Magnet | null {
  const layout = layoutCourse(course);
  // Ports already joined between two fixed pieces are taken.
  const taken = new Set<string>();
  for (const c of layout.closures) {
    if (!group.has(c.a.piece) && !group.has(c.b.piece)) {
      taken.add(portKey(c.a));
      taken.add(portKey(c.b));
    }
  }
  const loose = layout.pieces.flatMap((pc, piece) =>
    pc.ports.map((_, port) => ({ piece, port })).filter((r) => !layout.connected.has(portKey(r)) && !taken.has(portKey(r))),
  );
  let best: (Magnet & { d: number }) | null = null;
  for (const m of loose) {
    if (!group.has(m.piece)) continue;
    for (const f of loose) {
      if (group.has(f.piece)) continue;
      if (!compatible(layout.pieces[m.piece].part, m.port, layout.pieces[f.piece].part, f.port)) continue;
      const err = facingError(layout.pieces[m.piece].ports[m.port], layout.pieces[f.piece].ports[f.port]);
      if (err.distance <= distance && err.angle <= MAGNET_ANGLE && (!best || err.distance < best.d)) {
        best = { moving: m, fixed: f, d: err.distance };
      }
    }
  }
  return best && { moving: best.moving, fixed: best.fixed };
}

/** Pull the moving pieces so the magnet's ports face exactly, and join them. */
export function applyMagnet(course: Course, group: Set<number>, magnet: Magnet): Course {
  const layout = layoutCourse(course);
  const m = layout.pieces[magnet.moving.piece].ports[magnet.moving.port];
  const f = layout.pieces[magnet.fixed.piece].ports[magnet.fixed.port];
  // The rigid move that turns the moving port onto the fixed one.
  const pull = f.clone().multiply(FACE).multiply(m.clone().invert());
  return uncut(moveGroup(course, group, pull), [magnet.moving, magnet.fixed]);
}

/**
 * Split a joint (spec 8). A stored connection becomes a free placement at
 * the same spot; both ports are marked so they stay apart until moved.
 */
export function splitJoint(course: Course, a: PortRef, b: PortRef): Course {
  const next = clone(course);
  for (const [x, y] of [[a, b], [b, a]]) {
    const rec = course.pieces[y.piece];
    if ('to' in rec && rec.to[0] === x.piece && rec.to[1] === x.port && rec.port === y.port) {
      next.pieces[y.piece] = freeRec(rec, x, IDENTITY_POSE);
    }
  }
  next.cuts = [...(course.cuts ?? []), [a.piece, a.port], [b.piece, b.port]];
  return next;
}

/** Join two ports that meet, undoing a split; ports a little apart are pulled together first. */
export function joinPorts(course: Course, a: PortRef, b: PortRef): Course {
  const later = a.piece > b.piece ? a : b;
  const earlier = later === a ? b : a;
  const layout = layoutCourse(uncut(course, [a, b]));
  if (layout.group[a.piece] === layout.group[b.piece]) return uncut(course, [a, b]);
  return applyMagnet(course, movingGroup(layout, later.piece), { moving: later, fixed: earlier });
}

/** A loose port near `ref` that it could join: for the "join" button. */
export function joinableNear(layout: Layout, ref: PortRef, distance = MAGNET_DISTANCE): PortRef | null {
  const here = layout.pieces[ref.piece];
  let best: { ref: PortRef; d: number } | null = null;
  for (const other of layout.open) {
    if (other.piece === ref.piece) continue;
    const there = layout.pieces[other.piece];
    if (!compatible(here.part, ref.port, there.part, other.port)) continue;
    const err = facingError(here.ports[ref.port], there.ports[other.port]);
    if (err.distance <= distance && err.angle <= MAGNET_ANGLE && (!best || err.distance < best.d)) best = { ref: other, d: err.distance };
  }
  return best?.ref ?? null;
}
