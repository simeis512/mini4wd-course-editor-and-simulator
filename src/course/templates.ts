import { getPart, LEVEL_HEIGHT, partOf } from './catalog';
import { compatible, layoutCourse, type Course, type PieceRec, type PortRef } from './course';
import { addFreePiece, clone, footprint } from './edit';
import { raiseRun } from './raise';

// Templates: parts often put down together, added in one go from under the
// parts list (#63).

/** A piece of a template: its part, the port it joins by, and the port of the piece before that it joins. */
export interface TemplatePiece {
  part: string;
  /** The piece's own port that faces the piece before (for the first, the port the template joins by). */
  port: number;
  /** The port of the piece before that it joins; unused for the first piece. */
  from: number;
}

export interface TemplateDef {
  id: string;
  name: string;
  /** What it is, for the button's tooltip. */
  note: string;
  pieces: TemplatePiece[];
  /**
   * Height its far end climbs to when joined to an open port, mm: raised as
   * one run (spec 16.3), so a loop of curves passes over itself.
   */
  rise?: number;
}

/** Curves joined end to end, turning left when joined by port 0 (port 1: right). */
const curves = (count: number, port: number): TemplatePiece[] =>
  Array.from({ length: count }, () => ({ part: 'curve45', port, from: 1 - port }));

/** A U-turn of curves between two bank approaches: climbing, the curves banked, coming down (#63). */
const bank = (port: number): TemplatePiece[] => [
  { part: 'bank-approach-20', port: 0, from: 1 },
  ...curves(4, port).map((p, i) => (i === 0 ? { ...p, from: 1 } : p)),
  { part: 'bank-approach-20', port: 1, from: 1 - port },
];

/** The templates, in the order they are listed (#63). */
export const TEMPLATES: TemplateDef[] = [
  {
    id: 'lane-change',
    name: 'レーンチェンジ',
    note: 'ブリッジアプローチ ×2 ＋ レーンチェンジ中央部',
    // As in the basic set: the second bridge approach turned round, the upper ports meeting by loop closure.
    pieces: [
      { part: 'bridge-approach', port: 0, from: 1 },
      { part: 'lane-change-center', port: 0, from: 1 },
      { part: 'bridge-approach', port: 1, from: 1 },
    ],
  },
  { id: 'bank-left', name: 'バンク 左', note: 'バンクアプローチ ×2 ＋ 45°カーブ ×4（左に曲がる）', pieces: bank(0) },
  { id: 'bank-right', name: 'バンク 右', note: 'バンクアプローチ ×2 ＋ 45°カーブ ×4（右に曲がる）', pieces: bank(1) },
  {
    id: 'loop-left',
    name: 'ループ 左',
    note: `45°カーブ ×8（左回り）。口につなぐと 1 周で ${LEVEL_HEIGHT}mm 上って自分の上を越えます`,
    pieces: curves(8, 0),
    rise: LEVEL_HEIGHT,
  },
  {
    id: 'loop-right',
    name: 'ループ 右',
    note: `45°カーブ ×8（右回り）。口につなぐと 1 周で ${LEVEL_HEIGHT}mm 上って自分の上を越えます`,
    pieces: curves(8, 1),
    rise: LEVEL_HEIGHT,
  },
];

export function getTemplate(id: string): TemplateDef {
  const t = TEMPLATES.find((t) => t.id === id);
  if (!t) throw new Error(`unknown template: ${id}`);
  return t;
}

/** The template's pieces after the first, each joined to the one before; `first` is the index of the first. */
function rest(t: TemplateDef, first: number): PieceRec[] {
  return t.pieces.slice(1).map((p, i): PieceRec => ({ part: p.part, port: p.port, to: [first + i, p.from] }));
}

/**
 * Join the template to the open port `at` by its first piece, the rest
 * following, raised if it climbs. `port` is the port the last piece joins
 * by, to go on from its other end. Null when the first piece cannot join there.
 */
export function joinTemplate(course: Course, id: string, at: PortRef): { course: Course; port: number } | null {
  const t = getTemplate(id);
  const [head] = t.pieces;
  if (!compatible(partOf(course.pieces[at.piece]), at.port, getPart(head.part), head.port)) return null;
  const first = course.pieces.length;
  let next = clone(course);
  next.pieces.push({ part: head.part, port: head.port, to: [at.piece, at.port] }, ...rest(t, first));
  if (t.rise) next = raiseRun(next, at, { piece: first, port: head.port }, t.pieces.length, t.rise);
  return { course: next, port: t.pieces[t.pieces.length - 1].port };
}

/**
 * Add the template on its own, lying on the floor, its first piece heading
 * +Z, with the middle of all its pieces' footprints at (x, z).
 */
export function addFreeTemplate(course: Course, id: string, x: number, z: number): Course {
  const t = getTemplate(id);
  const first = course.pieces.length;
  const next = addFreePiece(course, t.pieces[0].part, t.pieces[0].port, x, z);
  next.pieces.push(...rest(t, first));
  const [x0, x1, z0, z1] = addedBounds(next, first);
  const rec = next.pieces[first] as Extract<PieceRec, { free: unknown }>;
  const round = (v: number) => Math.round(v * 10) / 10;
  const [px, py, pz] = rec.pose.pos;
  rec.pose = { ...rec.pose, pos: [round(px + x - (x0 + x1) / 2), py, round(pz + z - (z0 + z1) / 2)] };
  return next;
}

/** Top-view bounds of the pieces from `first` on, world X/Z in mm: [x0, x1, z0, z1]. */
export function addedBounds(course: Course, first: number): [number, number, number, number] {
  const boxes = layoutCourse(course).pieces.slice(first).map(footprint);
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.max(...boxes.map((b) => b[1])),
    Math.min(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}
