import { Matrix4, Vector3 } from 'three';
import { offsetFrame, type Block } from './blocks';
import { GLOBAL_SPEC, laneOffset, partOf } from './catalog';
import type { Course, LapTimer, Layout, PieceRec, PlacedPiece, StartLine } from './course';
import { distancesAlong, frameAlong, partGeometry } from './geometry';
import type { PartDef } from './part';

// The start line and Tamiya's lap timer (#56): where they sit on the road
// and their shapes.

/** A START sticker, mm (#56, provisional: from the photo start-stickers-jcjc.jpg). */
export const STICKER = { length: 50, width: 90 };
/**
 * How far past the start line the timer goes when it is put there with the
 * start, mm: the manual has the aluminium tape "a little way from the
 * start" (#56 決定事項, provisional).
 */
export const TIMER_GAP = 150;
/** The timer's shape, mm (#56 決定事項: provisional, from the box art until measured with #1). */
export const TIMER = {
  /** Width along the road. */
  width: 75,
  /** The body standing outside the fence: thickness across the road and height above it. */
  bodyDepth: 45,
  bodyHeight: 120,
  /** The top over the lane: how far in from the fence it reaches, and how thick it is. */
  reach: 115,
  topThickness: 28,
  /** The aluminium tape on the road under it, along the road. */
  tape: 30,
};
/** How far the stickers and tape are drawn above the road, mm, so the road never shows through (cosmetic). */
const ON_ROAD = 1;

const { lanePitch, laneWidth, fenceThickness } = GLOBAL_SPEC;

/**
 * Whether a part is a plain straight: one level road with no turn, slope or
 * swing. The start goes on one, and the timer fits only there (#56).
 */
export function isStraight(part: PartDef): boolean {
  return !part.tracks?.length && part.segments.every((s) => !s.yaw && !s.pitch && !s.roll && !s.lateralProfile);
}

/** The length of a piece's main road, mm. */
function lengthOf(rec: PieceRec): number {
  const d = distancesAlong(partGeometry(partOf(rec)).samples);
  return d[d.length - 1];
}

/** Where along a piece something can be: on its road, whole mm. */
export function onRoad(pc: PlacedPiece, offset: number): number {
  const d = distancesAlong(pc.geometry.samples);
  return Math.round(Math.min(d[d.length - 1], Math.max(0, offset)));
}

/** The world frame `offset` mm along a piece's main road, facing the way machines go (back along it when `reverse`). */
export function roadFrame(pc: PlacedPiece, offset: number, reverse = false): Matrix4 {
  const { samples } = pc.geometry;
  const f = pc.matrix.clone().multiply(frameAlong(samples, distancesAlong(samples), onRoad(pc, offset)));
  return reverse ? f.multiply(new Matrix4().makeRotationY(Math.PI)) : f;
}

/** A START sticker on one lane: its corners on the road and an arrow inside it pointing the way machines go, world mm. */
export interface Sticker {
  lane: number;
  corners: Vector3[];
  arrow: Vector3[];
}

/** The START stickers of a start line, one per lane of its piece's main road. */
export function startStickers(layout: Layout, start: StartLine): Sticker[] {
  const pc = layout.pieces[start.piece];
  const f = roadFrame(pc, start.offset);
  const [l, w] = [STICKER.length / 2, STICKER.width / 2];
  // Seen along the centreline; turned round, the arrow points back.
  const ahead = start.reverse ? -1 : 1;
  const at = (right: number, along: number) => new Vector3(-right, ON_ROAD, along).applyMatrix4(f);
  return pc.part.lanes.map((lane) => {
    const x = laneOffset(lane);
    return {
      lane,
      corners: [at(x - w, -l), at(x + w, -l), at(x + w, l), at(x - w, l)],
      arrow: [at(x, ahead * l * 0.7), at(x - w * 0.35, -ahead * l * 0.5), at(x + w * 0.35, -ahead * l * 0.5)],
    };
  });
}

/** The lane a lap timer covers: the outer lane on its side. */
export function timerLane(pc: PlacedPiece, timer: LapTimer): number {
  const lanes = pc.part.lanes;
  return timer.side === 'left' ? Math.min(...lanes) : Math.max(...lanes);
}

/**
 * A lap timer as blocks, world mm: its body standing outside the fence, its
 * top reaching over the covered lane and the aluminium tape on the road
 * under that (15184 manual).
 */
export function timerBlocks(layout: Layout, timer: LapTimer): Block[] {
  const pc = layout.pieces[timer.piece];
  const f = roadFrame(pc, timer.offset);
  // Outwards across the road, looking along the centreline.
  const out = timer.side === 'left' ? -1 : 1;
  const lane = timerLane(pc, timer);
  const fence = laneOffset(lane) + (out * lanePitch) / 2;
  const back = fence + out * (fenceThickness / 2 + TIMER.bodyDepth);
  const inner = fence - out * TIMER.reach;
  const { width, bodyHeight, topThickness } = TIMER;
  return [
    // The body stands under the top and meets it without overlapping, so no faces fight (user, 2026-10-22).
    { role: 'body', frame: offsetFrame(f, fence + out * (fenceThickness / 2 + TIMER.bodyDepth / 2), (bodyHeight - topThickness) / 2, 0), size: [TIMER.bodyDepth, bodyHeight - topThickness, width] },
    { role: 'top', frame: offsetFrame(f, (back + inner) / 2, bodyHeight - topThickness / 2, 0), size: [Math.abs(back - inner), topThickness, width] },
    { role: 'tape', frame: offsetFrame(f, laneOffset(lane), ON_ROAD, 0), size: [laneWidth - 20, 0.2, TIMER.tape] },
  ];
}

/** Where the timer goes for the start line: just past it on its piece, as far as the piece goes (#56 決定事項). */
export function pastStart(course: Course): { piece: number; offset: number } | null {
  const start = course.start;
  if (!start) return null;
  const ahead = start.offset + (start.reverse ? -TIMER_GAP : TIMER_GAP);
  return { piece: start.piece, offset: Math.round(Math.min(lengthOf(course.pieces[start.piece]), Math.max(0, ahead))) };
}

/** Put the start line on a piece; the first time, the timer goes just past it. */
export function placeStart(course: Course, piece: number, offset: number): Course {
  const next = structuredClone(course);
  next.start = { piece, offset: Math.round(Math.min(lengthOf(next.pieces[piece]), Math.max(0, offset))) };
  if (course.start?.reverse) next.start.reverse = true;
  return next.timer ? next : placeTimer(next, pastStart(next)!);
}

/** Change the start line's place, or which way machines set off from it. */
export function moveStart(course: Course, to: { piece?: number; offset?: number; reverse?: boolean }): Course {
  if (!course.start) return course;
  const next = structuredClone(course);
  const start = next.start!;
  if (to.piece !== undefined) start.piece = to.piece;
  if (to.offset !== undefined) start.offset = Math.round(Math.min(lengthOf(next.pieces[start.piece]), Math.max(0, to.offset)));
  if (to.reverse) start.reverse = true;
  else if (to.reverse === false) delete start.reverse;
  return next;
}

/** Put the lap timer on a piece, or move it; it keeps its side and timing unless told. */
export function placeTimer(course: Course, to: { piece?: number; offset?: number; side?: 'left' | 'right'; everyLane?: boolean }): Course {
  const next = structuredClone(course);
  const timer: LapTimer = next.timer ?? { piece: to.piece ?? 0, offset: 0, side: 'left' };
  if (to.piece !== undefined) timer.piece = to.piece;
  if (to.offset !== undefined) timer.offset = Math.round(Math.min(lengthOf(next.pieces[timer.piece]), Math.max(0, to.offset)));
  if (to.side) timer.side = to.side;
  if (to.everyLane) timer.everyLane = true;
  else if (to.everyLane === false) delete timer.everyLane;
  next.timer = timer;
  return next;
}

export function removeStart(course: Course): Course {
  const next = structuredClone(course);
  delete next.start;
  return next;
}

export function removeTimer(course: Course): Course {
  const next = structuredClone(course);
  delete next.timer;
  return next;
}

/** The start line and timer once piece `index` is deleted: those on it go, later pieces are renumbered. */
export function timingWithoutPiece(course: Course, index: number): Pick<Course, 'start' | 'timer'> {
  const keep = <T extends { piece: number }>(at: T | undefined): T | undefined =>
    !at || at.piece === index ? undefined : at.piece > index ? { ...at, piece: at.piece - 1 } : at;
  const out: Pick<Course, 'start' | 'timer'> = {};
  const [start, timer] = [keep(course.start), keep(course.timer)];
  if (start) out.start = start;
  if (timer) out.timer = timer;
  return out;
}

/** A spot on a piece's main road: the piece, how far along it, and the point there (world mm). */
export interface RoadSpot {
  piece: number;
  offset: number;
  point: Vector3;
}

/**
 * The spot on a main road nearest the floor point (x, z); with `y`, nearest
 * in all three directions, so stacked roads stay apart. Seen from above,
 * the higher of two roads equally near wins. Only pieces with lanes count,
 * and only those `only` lets through when given.
 */
export function nearestRoad(layout: Layout, x: number, z: number, y?: number, only?: (pc: PlacedPiece) => boolean): RoadSpot | null {
  let best: (RoadSpot & { d: number }) | null = null;
  const target = new Vector3(x, y ?? 0, z);
  const [a, b, p] = [new Vector3(), new Vector3(), new Vector3()];
  for (const [piece, pc] of layout.pieces.entries()) {
    if (!pc.part.lanes.length || (only && !only(pc))) continue;
    const { samples } = pc.geometry;
    const along = distancesAlong(samples);
    for (let i = 1; i < samples.length; i++) {
      a.setFromMatrixPosition(samples[i - 1]).applyMatrix4(pc.matrix);
      b.setFromMatrixPosition(samples[i]).applyMatrix4(pc.matrix);
      const ab = b.clone().sub(a);
      if (y === undefined) ab.y = 0;
      const toward = target.clone().sub(a);
      if (y === undefined) toward.y = 0;
      const t = Math.min(1, Math.max(0, toward.dot(ab) / (ab.lengthSq() || 1)));
      p.copy(a).lerp(b, t);
      const d = y === undefined ? Math.hypot(p.x - x, p.z - z) : p.distanceTo(target);
      // Within a millimetre counts as the same, and then the higher road is on top.
      if (!best || d < best.d - 1 || (d < best.d + 1 && p.y > best.point.y)) {
        best = { piece, offset: along[i - 1] + t * (along[i] - along[i - 1]), point: p.clone(), d };
      }
    }
  }
  return best && { piece: best.piece, offset: best.offset, point: best.point };
}
