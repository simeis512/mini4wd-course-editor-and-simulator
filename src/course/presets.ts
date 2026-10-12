import type { Course, PieceRec } from './course';
import { CATALOG_VERSION } from './catalog';

/** Chain parts end to end: each piece joins the previous piece's far port. */
export function chain(parts: string[]): Course {
  const pieces: PieceRec[] = parts.map((part, i) =>
    i === 0 ? { part, at: 'origin' } : { part, port: 0, to: [i - 1, 1] },
  );
  return { v: 1, catalog: CATALOG_VERSION, pieces };
}

/**
 * The basic set's oval with the lane change replaced by straights (lane
 * change parts arrive in phase 2): straight, wave, straight, a U-turn of
 * four curves, three straights, another U-turn.
 */
export function basicOval(): Course {
  const uTurn = ['curve45', 'curve45', 'curve45', 'curve45'];
  return chain(['straight', 'wave', 'straight', ...uTurn, 'straight', 'straight', 'straight', ...uTurn]);
}
