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

/**
 * The basic oval with a jump in place of the wave (the owner's course,
 * 2026-10-24, #28): a bridge approach after the first straight sends the
 * right lane up off its upper port and over a gap onto the next straight,
 * which the other two lanes reach under it through its lower port.
 */
export function rampJumpOval(): Course {
  // The oval without the wave and the straight before it, which the ramp and the free straight stand for.
  const oval = basicOval();
  const pieces: PieceRec[] = [
    oval.pieces[0],
    { part: 'straight', port: 0, free: null, pose: { pos: [0, 0, 1080], rot: [0, 0, 0] } },
    // The rest of the oval, each joined one piece further back.
    ...oval.pieces.slice(3).map((rec): PieceRec => ('to' in rec ? { ...rec, to: [rec.to[0] - 1, rec.to[1]] } : rec)),
    { part: 'bridge-approach', port: 0, to: [0, 1] },
  ];
  return { ...oval, pieces };
}
