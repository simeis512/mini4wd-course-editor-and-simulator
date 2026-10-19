import type { PortRef } from '../course/course';

export type Selection = { kind: 'port'; ref: PortRef } | { kind: 'piece'; index: number } | null;

export interface PickHandlers {
  /** A tap landed on an open port, a piece, or nothing. */
  onPick(selection: Selection): void;
}

/** Dragging a piece around in the top view. */
export interface DragHandlers {
  /** A drag began on piece `index`; return false to pan instead. */
  onDragStart(index: number): boolean;
  /** The pointer has moved (dx, dz) mm in the world since the drag began. */
  onDragMove(dx: number, dz: number, noSnap: boolean): void;
  onDragEnd(commit: boolean): void;
}
