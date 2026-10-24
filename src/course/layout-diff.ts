import type { Layout, PlacedPiece } from './course';

/** Exact geometry/placement comparison; colour and attachments do not change road (#92). */
export function sameRoad(a: PlacedPiece | undefined, b: PlacedPiece): boolean {
  return !!a && a.part === b.part && a.geometry === b.geometry && a.matrix.equals(b.matrix);
}

/** Indices whose road changed, including removed indices. Never mutates either layout (#92). */
export function changedPieces(before: Layout, after: Layout): Set<number> {
  const changed = new Set<number>();
  for (let i = 0; i < Math.max(before.pieces.length, after.pieces.length); i++) {
    if (!after.pieces[i] || !sameRoad(before.pieces[i], after.pieces[i])) changed.add(i);
  }
  return changed;
}
