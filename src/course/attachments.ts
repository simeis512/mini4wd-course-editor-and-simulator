import type { Matrix4, Vector3 } from 'three';
import { getAttachment, GLOBAL_SPEC, laneOffset, partOf, type AttachmentDef } from './catalog';
import type { Attachment, Course, PlacedPiece } from './course';
import { distancesAlong, frameAlong, pointOnFrame } from './geometry';

// Washboards and the like laid on a piece's road (spec 4, #17).

/** Samples along an attachment, mm apart at most. */
const STEP = 2;

/** An attachment's place on its piece, part-local. */
export interface AttachmentShape {
  /** Frames along its middle, on the road, one end to the other. */
  frames: Matrix4[];
  /** Height of its top above the road at each frame. */
  tops: number[];
  /** Half its width across the lane. */
  half: number;
  /** Indices of the frames where the tabs end and the flat top begins and ends. */
  edges: number[];
}

/** The length of a piece's main road, measured along it, mm. */
function roadLength(pc: PlacedPiece): number {
  const d = distancesAlong(pc.geometry.samples);
  return d[d.length - 1];
}

/** Where an attachment's middle can be on a piece: kept on the road, whole mm. */
export function offsetWithin(pc: PlacedPiece, a: Attachment): number {
  const half = getAttachment(a.kind).length / 2;
  const length = roadLength(pc);
  return Math.round(length < 2 * half ? length / 2 : Math.min(length - half, Math.max(half, a.offset)));
}

/** Furthest an attachment's middle can be from its lane's centre: against a fence, mm. */
export function sideLimit(kind: string): number {
  return Math.max(0, (GLOBAL_SPEC.laneWidth - getAttachment(kind).width) / 2);
}

/** Where across the lane an attachment can be: between the fences, whole mm. */
export function sideWithin(a: Pick<Attachment, 'kind' | 'side'>): number {
  const limit = sideLimit(a.kind);
  return Math.round(Math.min(limit, Math.max(-limit, a.side)));
}

/**
 * Height of an attachment's top `s` mm from one end: a thin tab, a slope
 * up (smoothed at both ends) and the flat top, then the same back down.
 */
export function attachmentHeight(def: AttachmentDef, s: number): number {
  const u = Math.min(s, def.length - s) - def.tab;
  if (u < 0) return def.tabThickness;
  const t = Math.min(1, u / def.ramp);
  return def.tabThickness + (def.height - def.tabThickness) * t * t * (3 - 2 * t);
}

/** Where an attachment lies on its piece `pc` and the shape of its top (provisional, spec 4). */
export function attachmentShape(pc: PlacedPiece, a: Attachment): AttachmentShape {
  const def = getAttachment(a.kind);
  const { samples } = pc.geometry;
  const distances = distancesAlong(samples);
  const mid = offsetWithin(pc, a);
  // Sample at the tab and top edges exactly, and every STEP mm between.
  const marks = [def.tab, def.tab + def.ramp, def.length - def.tab - def.ramp, def.length - def.tab];
  const along = [...new Set([...Array.from({ length: Math.ceil(def.length / STEP) + 1 }, (_, i) => Math.min(def.length, i * STEP)), ...marks])].sort((x, y) => x - y);
  // Across to the lane and its place in it; + X is left.
  const across = laneOffset(a.lane) + sideWithin(a);
  const frames = along.map((s) => {
    const f = frameAlong(samples, distances, mid - def.length / 2 + s);
    return f.setPosition(pointOnFrame(f, across, 0));
  });
  return {
    frames,
    tops: along.map((s) => attachmentHeight(def, s)),
    half: def.width / 2,
    edges: marks.map((m) => along.indexOf(m)),
  };
}

/**
 * An attachment seen from above, world mm: its outline (one edge, then the
 * other back), the tabs at its ends, and lines across where its top is flat.
 */
export function attachmentOutline(pc: PlacedPiece, a: Attachment): { outline: Vector3[]; tabs: Vector3[][]; lines: [Vector3, Vector3][] } {
  const { frames, half, edges } = attachmentShape(pc, a);
  const world = frames.map((f) => pc.matrix.clone().multiply(f));
  const edge = (x: number) => world.map((f) => pointOnFrame(f, x, 0));
  const [left, right] = [edge(-half), edge(half)];
  const part = (i: number, j: number) => [...left.slice(i, j + 1), ...right.slice(i, j + 1).reverse()];
  const [tabIn, topIn, topOut, tabOut] = edges;
  return {
    outline: [...left, ...right.slice().reverse()],
    tabs: [part(0, tabIn), part(tabOut, world.length - 1)],
    lines: [topIn, topOut].map((i) => [left[i], right[i]]),
  };
}

/** Lay `kind` on a lane of a piece: by default the middle lane, halfway along. */
export function addAttachment(course: Course, kind: string, piece: number, lane?: number, offset?: number): Course {
  const part = partOf(course.pieces[piece]);
  const lanes = part.lanes;
  const length = part.segments.reduce((sum, s) => sum + s.length, 0);
  const next = structuredClone(course);
  const a: Attachment = {
    kind,
    piece,
    lane: lane ?? lanes[Math.floor(lanes.length / 2)],
    offset: Math.round(offset ?? length / 2),
    // Laid along the left fence, as the manual shows (69572).
    side: -sideLimit(kind),
  };
  next.attachments = [...(next.attachments ?? []), a];
  return next;
}

/** Change an attachment's lane or place along or across it (whole mm). */
export function moveAttachment(course: Course, index: number, to: { lane?: number; offset?: number; side?: number }): Course {
  const next = structuredClone(course);
  const a = next.attachments![index];
  if (to.lane !== undefined && partOf(next.pieces[a.piece]).lanes.includes(to.lane)) a.lane = to.lane;
  if (to.offset !== undefined) a.offset = Math.max(0, Math.round(to.offset));
  if (to.side !== undefined) a.side = sideWithin({ kind: a.kind, side: to.side });
  return next;
}

export function removeAttachment(course: Course, index: number): Course {
  const next = structuredClone(course);
  next.attachments!.splice(index, 1);
  if (!next.attachments!.length) delete next.attachments;
  return next;
}

/** The attachments once piece `index` is deleted: its own go, later pieces are renumbered. */
export function withoutPiece(list: readonly Attachment[], index: number): Attachment[] {
  return list.filter((a) => a.piece !== index).map((a) => (a.piece > index ? { ...a, piece: a.piece - 1 } : a));
}
