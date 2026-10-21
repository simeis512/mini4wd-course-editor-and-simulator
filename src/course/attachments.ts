import type { Matrix4, Vector3 } from 'three';
import { getAttachment, laneOffset, partOf } from './catalog';
import type { Attachment, Course, PlacedPiece } from './course';
import { distancesAlong, frameAlong, pointOnFrame } from './geometry';

// Washboards and the like laid on a piece's road (spec 4, #17).

/** Samples along an attachment, mm apart at most. */
const STEP = 4;

/** An attachment's place on its piece, part-local. */
export interface AttachmentShape {
  /** Frames along the middle of its lane, on the road, one end to the other. */
  frames: Matrix4[];
  /** Height of its top above the road at each frame. */
  tops: number[];
  /** Half its width across the lane. */
  half: number;
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

/**
 * Where an attachment lies on its piece `pc` and the shape of its bumps:
 * each a smooth hump, end to end (provisional, spec 4).
 */
export function attachmentShape(pc: PlacedPiece, a: Attachment): AttachmentShape {
  const def = getAttachment(a.kind);
  const { samples } = pc.geometry;
  const distances = distancesAlong(samples);
  const mid = offsetWithin(pc, a);
  const steps = Math.max(def.bumps * 4, Math.ceil(def.length / STEP));
  const frames: Matrix4[] = [];
  const tops: number[] = [];
  const side = laneOffset(a.lane);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const f = frameAlong(samples, distances, mid - def.length / 2 + t * def.length);
    // Moved across to the lane; + X is left.
    const p = pointOnFrame(f, side, 0);
    frames.push(f.setPosition(p));
    tops.push(def.height * Math.sin(Math.PI * def.bumps * t) ** 2);
  }
  return { frames, tops, half: def.width / 2 };
}

/**
 * An attachment seen from above, world mm: its outline (one edge, then the
 * other back) and a line across each bump's crest.
 */
export function attachmentOutline(pc: PlacedPiece, a: Attachment): { outline: Vector3[]; crests: [Vector3, Vector3][] } {
  const { frames, tops, half } = attachmentShape(pc, a);
  const world = frames.map((f) => pc.matrix.clone().multiply(f));
  const edge = (x: number) => world.map((f) => pointOnFrame(f, x, 0));
  const [left, right] = [edge(-half), edge(half)];
  const crests = world.flatMap((_, i) => (tops[i] > (tops[i - 1] ?? 0) && tops[i] >= (tops[i + 1] ?? 0) ? [[left[i], right[i]] as [Vector3, Vector3]] : []));
  return { outline: [...left, ...right.reverse()], crests };
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
  };
  next.attachments = [...(next.attachments ?? []), a];
  return next;
}

/** Change an attachment's lane or place (whole mm). */
export function moveAttachment(course: Course, index: number, to: { lane?: number; offset?: number }): Course {
  const next = structuredClone(course);
  const a = next.attachments![index];
  if (to.lane !== undefined && partOf(next.pieces[a.piece]).lanes.includes(to.lane)) a.lane = to.lane;
  if (to.offset !== undefined) a.offset = Math.max(0, Math.round(to.offset));
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
