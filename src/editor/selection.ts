import type { PortRef } from '../course/course';

export type Selection = { kind: 'port'; ref: PortRef } | { kind: 'piece'; index: number } | null;

export interface PickHandlers {
  /** A tap landed on an open port, a piece, or nothing. */
  onPick(selection: Selection): void;
}
