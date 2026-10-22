import type { PortRef } from '../course/course';

/** Pixels a pointer may move and still count as a tap, not a drag. */
export const TAP_SLOP = 6;
/** Screen radius for hitting a port, px. */
export const PORT_HIT = 22;
/** Screen radius for hitting a joint, px: small so pieces stay easy to pick. */
export const JOINT_HIT = 12;

export type Selection =
  | { kind: 'port'; ref: PortRef }
  | { kind: 'piece'; index: number }
  /** A joint between two ports. */
  | { kind: 'joint'; a: PortRef; b: PortRef }
  /** The start line or the lap timer (#56). */
  | { kind: 'start' }
  | { kind: 'timer' }
  /** A hose or box on the floor (#53); `point`, one of a hose's points. */
  | { kind: 'stopper'; index: number; point?: number }
  | null;

/** The start line, the timer or a stopper (or one of its points) as selected. */
export type PropSelection = Extract<Selection, { kind: 'start' | 'timer' | 'stopper' }>;

/** Whether the selection is the start line, the timer or a stopper. */
export const isProp = (s: Selection): s is PropSelection => s?.kind === 'start' || s?.kind === 'timer' || s?.kind === 'stopper';

/**
 * Whether what is under the pointer (`hit`) is the selection or part of it,
 * so that a drag there moves it: the piece itself, the start line or timer,
 * or the stopper or one of its points.
 */
export function grabs(selection: Selection, hit: Selection): boolean {
  if (!selection || !hit || selection.kind !== hit.kind) return false;
  if (selection.kind === 'piece') return hit.kind === 'piece' && hit.index === selection.index;
  if (selection.kind === 'stopper') return hit.kind === 'stopper' && hit.index === selection.index;
  return selection.kind === 'start' || selection.kind === 'timer';
}

export interface PickHandlers {
  /** A tap landed on an open port, a piece, or nothing. */
  onPick(selection: Selection): void;
  /** The view was panned, zoomed or turned, so things over it may need to follow. */
  onViewChange?(): void;
}

/** Dragging the selection around in a view. */
export interface DragHandlers {
  /** A drag began on the selection, on `target` (see `grabs`); return false to pan instead. */
  onDragStart(target: NonNullable<Selection>): boolean;
  /** The pointer has moved (dx, dz) mm in the world since the drag began. */
  onDragMove(dx: number, dz: number, noSnap: boolean): void;
  onDragEnd(commit: boolean): void;
}
