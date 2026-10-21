import type { Course, PieceRec } from './course';
import { CATALOG_VERSION, getPart } from './catalog';

/** Chain parts end to end: each piece joins the previous piece's far port. */
export function chain(parts: string[]): Course {
  const pieces: PieceRec[] = parts.map((part, i) =>
    i === 0 ? { part, at: 'origin' } : { part, port: 0, to: [i - 1, 1] },
  );
  return { v: 1, catalog: CATALOG_VERSION, pieces };
}

/**
 * The basic set's oval: straight, wave, straight, a U-turn of four curves,
 * the lane change (bridge approach, centre, bridge approach the other way
 * round), another U-turn. The lane change's upper ports meet by loop
 * closure. Coloured like 94892: red curves at one end, blue at the other.
 */
/** Blue in the curve's variants. */
const BLUE = getPart('curve45').variants.findIndex((v) => v.id === 'blue');

export function basicOval(): Course {
  const uTurn = ['curve45', 'curve45', 'curve45', 'curve45'];
  const course = chain(['straight', 'wave', 'straight', ...uTurn, 'bridge-approach']);
  const f = course.pieces.length - 1;
  course.pieces.push(
    { part: 'lane-change-center', port: 0, to: [f, 1] },
    { part: 'bridge-approach', port: 1, to: [f + 1, 1] },
    { part: 'curve45', port: 0, to: [f + 2, 0], variant: BLUE },
    ...uTurn.slice(1).map((part, i): PieceRec => ({ part, port: 0, to: [f + 3 + i, 1], variant: BLUE })),
  );
  return course;
}
