import { Vector3 } from 'three';
import { blockFootprint, convexHull } from './blocks';
import type { Layout } from './course';
import { insidePolygon } from './mesh';
import { boxOutline, boxSize, hoseCurve, stopperAt } from './stoppers';
import { roadFrame, startStickers, timerBlocks, TIMER } from './timing';

// The start line, lap timer and floor stoppers together (#56, #53): which
// one is where, for picking and for placing things beside them.

/** One of them. */
export type PropRef = { kind: 'start' } | { kind: 'timer' } | { kind: 'stopper'; index: number };

/** The start line seen from above: round the stickers of every lane (X, Z). */
export function startOutline(layout: Layout): [number, number][] {
  if (!layout.start) return [];
  return convexHull(startStickers(layout, layout.start).flatMap((s) => s.corners.map((p): [number, number] => [p.x, p.z])));
}

/** The lap timer seen from above: its body and top (X, Z). */
export function timerOutline(layout: Layout): [number, number][] {
  if (!layout.timer) return [];
  return convexHull(timerBlocks(layout, layout.timer).flatMap(blockFootprint));
}

/**
 * What is at the floor point (x, z) seen from above, `slack` mm round it
 * allowed: the timer over the road first, then the start line on it, then
 * the stoppers on the floor. `skip` leaves some out (hidden ones).
 */
export function propAt(layout: Layout, x: number, z: number, slack = 0, skip: (ref: PropRef) => boolean = () => false): PropRef | null {
  for (const ref of [{ kind: 'timer' }, { kind: 'start' }] as const) {
    if (skip(ref)) continue;
    const outline = ref.kind === 'timer' ? timerOutline(layout) : startOutline(layout);
    if (outline.length && insidePolygon(x, z, outline)) return ref;
  }
  const shown = layout.stoppers.map((_, index) => !skip({ kind: 'stopper', index }));
  const index = stopperAt(layout.stoppers.filter((_, i) => shown[i]), x, z, slack);
  if (index === null) return null;
  // Back to the index in the whole list.
  return { kind: 'stopper', index: shown.flatMap((on, i) => (on ? [i] : []))[index] };
}

/** One of them seen from above, as points round it (X, Z). */
export function propOutline(layout: Layout, ref: PropRef): [number, number][] {
  if (ref.kind === 'start') return startOutline(layout);
  if (ref.kind === 'timer') return timerOutline(layout);
  const s = layout.stoppers[ref.index];
  if (!s) return [];
  return s.kind === 'hose' ? hoseCurve(s, 50) : boxOutline(s).outline;
}

/** A point to keep things beside: the middle of the start line or of the timer's top, or of a stopper, world mm. */
export function propPoint(layout: Layout, ref: PropRef): Vector3 | null {
  if (ref.kind === 'start' && layout.start) {
    const pc = layout.pieces[layout.start.piece];
    return new Vector3().setFromMatrixPosition(roadFrame(pc, layout.start.offset));
  }
  if (ref.kind === 'timer' && layout.timer) {
    const top = new Vector3().setFromMatrixPosition(timerBlocks(layout, layout.timer)[1].frame);
    return top.setY(top.y + TIMER.topThickness / 2);
  }
  const s = ref.kind === 'stopper' ? layout.stoppers[ref.index] : undefined;
  if (!s) return null;
  if (s.kind === 'box') return new Vector3(s.x, boxSize(s).depth / 2, s.z);
  const n = s.points.length;
  return new Vector3(s.points.reduce((sum, p) => sum + p[0], 0) / n, 0, s.points.reduce((sum, p) => sum + p[1], 0) / n);
}
