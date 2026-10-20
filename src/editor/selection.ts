import type { PortRef } from '../course/course';

/** Screen radius for hitting a port, px. */
export const PORT_HIT = 22;
/** Screen radius for hitting a joint, px: small so pieces stay easy to pick. */
export const JOINT_HIT = 12;

export type Selection =
  | { kind: 'port'; ref: PortRef }
  | { kind: 'piece'; index: number }
  /** A joint between two ports. */
  | { kind: 'joint'; a: PortRef; b: PortRef }
  | null;

export interface PickHandlers {
  /** A tap landed on an open port, a piece, or nothing. */
  onPick(selection: Selection): void;
  /** The view was panned, zoomed or turned, so things over it may need to follow. */
  onViewChange?(): void;
}

/** Dragging a piece around in the top view. */
export interface DragHandlers {
  /** A drag began on piece `index`; return false to pan instead. */
  onDragStart(index: number): boolean;
  /** The pointer has moved (dx, dz) mm in the world since the drag began. */
  onDragMove(dx: number, dz: number, noSnap: boolean): void;
  onDragEnd(commit: boolean): void;
}
