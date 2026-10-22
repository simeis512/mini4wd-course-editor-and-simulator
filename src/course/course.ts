import { Matrix4, Vector3 } from 'three';
import { CATALOG_VERSION, getAttachment, GLOBAL_SPEC, lengthWithin, partOf, portLaneOffsets } from './catalog';
import type { PartDef, PortDef } from './part';
import { bendAngle, bendMatrix, BEND_LIMIT, pieceGeometry, TWIST_LIMIT, type Bend } from './flex';
import { attach, FACE, facingError, IDENTITY_POSE, poseToMatrix, type FrameError, type PartGeometry, type Pose } from './geometry';

/** A piece's own settings, which go with it however it is placed. */
export interface PieceSettings {
  variant?: number;
  /** Twist of the piece about its centreline, deg, + lowers the right side (spec 16.2). */
  twist?: number;
  /** Length of a piece whose part sets it per piece, mm (#69); the part's default when left out. */
  length?: number;
}

/** What every piece record has. */
interface RecBase extends PieceSettings {
  part: string;
}

/** The settings of `rec`, to carry over to a record that places it some other way. */
export function settingsOf(rec: PieceSettings): PieceSettings {
  const out: PieceSettings = {};
  if (rec.variant !== undefined) out.variant = rec.variant;
  if (rec.twist) out.twist = rec.twist;
  if (rec.length !== undefined) out.length = rec.length;
  return out;
}

/** A placed piece. Pieces only refer to pieces before them (spec 5.1). */
export type PieceRec =
  | (RecBase & { at: 'origin' })
  /**
   * Joined to a port; the joint may bend a little (spec 16.1) and be moved
   * sideways by whole lanes (`shift`, see `jointOffset`, #60).
   */
  | (RecBase & { port: number; to: [piece: number, port: number]; bend?: Bend; shift?: number })
  /**
   * Free placement: this piece's `port` faces the frame `pose`, which is
   * relative to the port `free` (or to the world when null). A zero pose
   * relative to a port is the same as connecting to it.
   */
  | (RecBase & { port: number; free: [piece: number, port: number] | null; pose: Pose });

/**
 * Something laid on a piece's road, such as a washboard (spec 4, #17):
 * which lane of the piece's main road, and where its middle is along it.
 */
export interface Attachment {
  /** Id in ATTACHMENTS (attachments.ts). */
  kind: string;
  piece: number;
  /** Lane position on the main road, 0 = left looking along its centreline. */
  lane: number;
  /** From the start of the main centreline to the attachment's middle, mm. */
  offset: number;
  /** Its middle across the lane from the lane's centre, mm, + right looking along the centreline. */
  side: number;
  /** Machines come in by the end nearer the far end of the centreline: the thick end faces its start. */
  reverse?: boolean;
  /**
   * Stood on edge against that fence instead of laid on the road, so it
   * pushes the machine's rollers in (Tamiya tip, user 2026-10-21); `side`
   * is then unused.
   */
  wall?: 'left' | 'right';
}

/**
 * The start line (#56): START stickers across every lane of a piece's main
 * road, `offset` mm along its centreline. One per course.
 */
export interface StartLine {
  piece: number;
  /** From the start of the main centreline, mm. */
  offset: number;
  /** Machines set off towards the start of the centreline instead of its end. */
  reverse?: boolean;
}

/**
 * Tamiya's lap timer (15184, #56): its body stands outside a piece's outer
 * fence and its top reaches over the lane next to it, `offset` mm along the
 * main centreline.
 */
export interface LapTimer {
  piece: number;
  offset: number;
  /** The fence it stands by, looking along the centreline; it covers the lane on that side. */
  side: 'left' | 'right';
  /** Time every lane as it crosses the line, not only the covered one as the real timer does (#56 決定事項). */
  everyLane?: boolean;
}

/** A garden hose laid on the floor to stop machines that fly off (#53): a curve through its points. */
export interface Hose {
  kind: 'hose';
  /** Points on the floor (X, Z mm) the hose runs through, in order. */
  points: [number, number][];
  /** Laid as a loop, back to its first point. */
  closed?: boolean;
  /** Index into HOSE_COLORS (stoppers.ts). */
  color: number;
}

/** A cardboard box on the floor that catches machines (#53). */
export interface CatchBox {
  kind: 'box';
  /** Index into BOX_SIZES (stoppers.ts). */
  size: number;
  /** Middle of where it stands on the floor, mm. */
  x: number;
  z: number;
  /** Turn about the vertical, deg; at 0 the open side faces +Z. */
  yaw: number;
  /** Standing open side up; by default it lies on its side, open towards the course (#53 決定事項). */
  upright?: boolean;
}

/** Something laid on the floor around the course to stop machines that come off it (#53). */
export type Stopper = Hose | CatchBox;

export interface Course {
  v: 1;
  catalog: number;
  pieces: PieceRec[];
  dir?: 1 | -1;
  name?: string;
  /**
   * Ports whose joint has been split on purpose: they never count as joined
   * to a port they touch. Only kept while something still touches them.
   */
  cuts?: [piece: number, port: number][];
  /**
   * Open ports left open on purpose, such as a jump's take-off: they are
   * not warned about (spec 7, #13).
   */
  intended?: [piece: number, port: number][];
  /** Washboards and the like on the road (spec 4). */
  attachments?: Attachment[];
  start?: StartLine;
  timer?: LapTimer;
  /** Hoses and boxes on the floor (#53). */
  stoppers?: Stopper[];
}

export function emptyCourse(): Course {
  return { v: 1, catalog: CATALOG_VERSION, pieces: [] };
}

export interface PortRef {
  piece: number;
  port: number;
}

/** Loop-closure tolerance (spec 5.3, provisional). */
export const CLOSE_DISTANCE = 10;
export const CLOSE_ANGLE = 3;
/**
 * Sideways shifts, in lanes, that two loose ports are tried at to close a
 * loop (#60): as far as three-lane ports still meeting by one lane.
 */
const CLOSE_SHIFTS = [0, -1, 1, -2, 2];

export interface PlacedPiece {
  rec: PieceRec;
  part: PartDef;
  /** Piece-to-world transform, mm. */
  matrix: Matrix4;
  /** The part's geometry with the piece's twist, part-local. */
  geometry: PartGeometry;
  /** Port frames in world coordinates. */
  ports: Matrix4[];
}

export interface Closure extends FrameError {
  a: PortRef;
  b: PortRef;
  /** Lanes the ports meet moved sideways by (#60). */
  shift: number;
}

/** Two ports that are joined, by the stored graph or by meeting (spec 5.3). */
export interface Joint {
  a: PortRef;
  b: PortRef;
  /** `link`: stored as a connection; `closure`: two loose ports that meet. */
  kind: 'link' | 'closure';
  /** Lanes `b` is moved sideways by from `a`; the same seen from either side (#60). */
  shift: number;
}

/**
 * Something that can be built in the editor but not with real parts:
 * a floor end that is not level, two parts that cannot be joined, or a
 * joint bent or a piece twisted further than real parts give (spec 16.4).
 */
export interface Problem {
  kind: 'not-level' | 'cannot-join' | 'bend-limit' | 'twist-limit';
  piece: number;
  port: number;
}

export interface Layout {
  pieces: PlacedPiece[];
  problems: Problem[];
  /** Ports joined by the stored graph. */
  connected: Set<string>;
  /** Open ports that meet within tolerance and count as joined (spec 5.3). */
  closures: Closure[];
  /** Ports joined to nothing. */
  open: PortRef[];
  /** Every joint, links first. */
  joints: Joint[];
  /** For each piece, the id of the group of pieces joined to it (they move together). */
  group: number[];
  /** Open ports marked as split from a port they touch. */
  split: PortRef[];
  /** Open ports marked as left open on purpose (#13). */
  intended: PortRef[];
  /** Lanes that end at a joint because the port they meet has no lane there (#60). */
  deadEnds: DeadEnd[];
  /** The course's attachments, as stored (spec 4). */
  attachments: Attachment[];
  /** The start line, lap timer and floor stoppers, as stored (#56, #53). */
  start: StartLine | null;
  timer: LapTimer | null;
  stoppers: Stopper[];
}

/**
 * Lanes of a joined port that meet no lane across the joint: a shifted
 * joint, or ports of different widths (#60). The road ends there.
 */
export interface DeadEnd extends PortRef {
  /** The part's lanes at that port that end. */
  lanes: number[];
  /** Marked as made that way on purpose, as for open ports (#13). */
  intended: boolean;
}

export const portKey = (r: PortRef): string => `${r.piece}:${r.port}`;

/** Whether two joints join the same two ports, either way round. */
export function sameJoint(x: { a: PortRef; b: PortRef }, y: { a: PortRef; b: PortRef }): boolean {
  const [xa, xb, ya, yb] = [x.a, x.b, y.a, y.b].map(portKey);
  return (xa === ya && xb === yb) || (xa === yb && xb === ya);
}

/** The piece and port a piece is placed from, if any. */
export function anchorRef(rec: PieceRec): [number, number] | null {
  if ('to' in rec) return rec.to;
  if ('free' in rec) return rec.free;
  return null;
}

/** Check that every reference points at an earlier piece and an existing port. */
export function validateCourse(course: Course): void {
  course.pieces.forEach((rec, i) => {
    const part = partOf(rec);
    if ('port' in rec && (rec.port < 0 || rec.port >= part.ports.length)) {
      throw new Error(`piece ${i}: no port ${rec.port} on ${rec.part}`);
    }
    if (rec.variant !== undefined && !part.variants[rec.variant]) {
      throw new Error(`piece ${i}: no variant ${rec.variant} on ${rec.part}`);
    }
    if (rec.length !== undefined && (!part.lengths || lengthWithin(part, rec.length) !== rec.length)) {
      throw new Error(`piece ${i}: ${rec.part} cannot be ${rec.length}mm long`);
    }
    const ref = anchorRef(rec);
    if (ref) {
      const [j, p] = ref;
      if (!(j >= 0 && j < i)) throw new Error(`piece ${i}: refers to piece ${j}`);
      const other = partOf(course.pieces[j]);
      if (p < 0 || p >= other.ports.length) throw new Error(`piece ${i}: no port ${p} on piece ${j}`);
    }
  });
  for (const a of course.attachments ?? []) {
    const rec = course.pieces[a.piece];
    getAttachment(a.kind);
    if (!rec || !partOf(rec).lanes.includes(a.lane)) throw new Error(`${a.kind} on missing lane ${a.piece}:${a.lane}`);
    if (!(a.offset >= 0) || !Number.isFinite(a.side)) throw new Error(`${a.kind} at ${a.offset}mm, ${a.side}mm across`);
    if (a.wall !== undefined && a.wall !== 'left' && a.wall !== 'right') throw new Error(`${a.kind} on wall ${a.wall}`);
  }
  for (const [what, at] of [['start', course.start], ['timer', course.timer]] as const) {
    if (!at) continue;
    const rec = course.pieces[at.piece];
    if (!rec || !partOf(rec).lanes.length || !(at.offset >= 0)) throw new Error(`${what} on missing road ${at.piece} at ${at.offset}mm`);
  }
  if (course.timer && course.timer.side !== 'left' && course.timer.side !== 'right') throw new Error(`timer by ${course.timer.side}`);
  for (const s of course.stoppers ?? []) {
    const ok =
      s.kind === 'hose'
        ? s.points.length >= 2 && s.points.flat().every(Number.isFinite) && Number.isInteger(s.color) && s.color >= 0
        : s.kind === 'box' && [s.x, s.z, s.yaw].every(Number.isFinite) && Number.isInteger(s.size) && s.size >= 0;
    if (!ok) throw new Error(`bad stopper ${JSON.stringify(s)}`);
  }
  for (const [what, marks] of [['split', course.cuts], ['open', course.intended]] as const) {
    for (const [piece, port] of marks ?? []) {
      const rec = course.pieces[piece];
      if (!rec || port < 0 || port >= partOf(rec).ports.length) throw new Error(`${what} mark on missing port ${piece}:${port}`);
    }
  }
}

/**
 * Ports two pieces can be joined by: kinds that go together (the same kind,
 * or an ordinary port), partners that allow each other, and at least one
 * lane that meets across the joint with this sideways `shift` (#60).
 */
export function compatible(a: PartDef, ap: number, b: PartDef, bp: number, shift = 0): boolean {
  const pa = a.ports[ap];
  const pb = b.ports[bp];
  if (a.cannotJoin?.includes(b.id) || b.cannotJoin?.includes(a.id)) return false;
  if ((pa.partners && !pa.partners.includes(b.id)) || (pb.partners && !pb.partners.includes(a.id))) return false;
  const [ka, kb] = [pa.kind ?? 'std', pb.kind ?? 'std'];
  // A port kept to its partners (the lane change centre's) meets only their ports of its own kind.
  if (ka !== kb && (pa.partners || pb.partners || (ka !== 'std' && kb !== 'std'))) return false;
  return jointLanes(a, ap, b, bp, shift).length > 0;
}

/**
 * How far sideways (+ right, mm, looking out of port `pa`) the port `pb`
 * faces it when the joint is shifted by `shift` lanes (#60). Ports with an
 * odd and an even number of lanes meet half a lane apart, so their lanes
 * line up; unshifted, the wider one sticks out on the right.
 */
export function jointOffset(pa: PortDef, pb: PortDef, shift = 0): number {
  const half = pa.lanes.length % 2 !== pb.lanes.length % 2 ? 0.5 : 0;
  return (shift + half) * GLOBAL_SPEC.lanePitch;
}

/** The frame a port's partner faces when the joint is shifted sideways (#60); + X is left. */
export function shiftedFrame(frame: Matrix4, pa: PortDef, pb: PortDef, shift = 0): Matrix4 {
  const d = jointOffset(pa, pb, shift);
  return d ? frame.clone().multiply(new Matrix4().makeTranslation(-d, 0, 0)) : frame.clone();
}

/**
 * Lanes that meet at a joint between port `ap` of `a` and port `bp` of `b`,
 * as [lane on a, lane on b]. The ports face each other, so the lane on the
 * right of one is on the left of the other. A shifted joint moves `b`'s
 * lanes right by `jointOffset`; seen from `b` it is the same shift (#60).
 */
export function jointLanes(a: PartDef, ap: number, b: PartDef, bp: number, shift = 0): [number, number][] {
  const others = portLaneOffsets(b.ports[bp]);
  const d = jointOffset(a.ports[ap], b.ports[bp], shift);
  const out: [number, number][] = [];
  for (const { lane, right } of portLaneOffsets(a.ports[ap])) {
    const match = others.find((o) => Math.abs(o.right + right - d) < 1e-6);
    if (match) out.push([lane, match.lane]);
  }
  return out;
}

const LEVEL_COS = Math.cos((CLOSE_ANGLE * Math.PI) / 180);

/** Whether a port frame lies flat: its up is within the closure angle of world up. */
export function isLevel(frame: Matrix4): boolean {
  return new Vector3(0, 1, 0).transformDirection(frame).y >= LEVEL_COS;
}

/** Work out where every piece sits from the connection graph. */
export function layoutCourse(course: Course): Layout {
  const pieces: PlacedPiece[] = [];
  const connected = new Set<string>();
  const links: Joint[] = [];
  const cut = new Set((course.cuts ?? []).map(([piece, port]) => portKey({ piece, port })));
  const problems: Problem[] = [];
  course.pieces.forEach((rec, i) => {
    const part = partOf(rec);
    const geo = pieceGeometry(part, rec.twist);
    if (Math.abs(rec.twist ?? 0) > TWIST_LIMIT) problems.push({ kind: 'twist-limit', piece: i, port: 'port' in rec ? rec.port : 0 });
    let matrix: Matrix4;
    if ('to' in rec) {
      const [j, p] = rec.to;
      // A bent joint turns about the joint itself (spec 16.1).
      const shift = rec.shift ?? 0;
      // A shifted joint moves sideways first, then bends about where it now is.
      const base = shiftedFrame(pieces[j].ports[p], pieces[j].part.ports[p], part.ports[rec.port], shift);
      matrix = attach(base.multiply(bendMatrix(rec.bend)), geo.ports[rec.port]);
      if (!compatible(pieces[j].part, p, part, rec.port, shift)) problems.push({ kind: 'cannot-join', piece: i, port: rec.port });
      if (bendAngle(rec.bend) > BEND_LIMIT) problems.push({ kind: 'bend-limit', piece: i, port: rec.port });
      connected.add(portKey({ piece: j, port: p }));
      connected.add(portKey({ piece: i, port: rec.port }));
      links.push({ a: { piece: j, port: p }, b: { piece: i, port: rec.port }, kind: 'link', shift });
    } else if ('free' in rec) {
      const base = rec.free ? pieces[rec.free[0]].ports[rec.free[1]] : new Matrix4();
      matrix = attach(base.clone().multiply(poseToMatrix(rec.pose)), geo.ports[rec.port]);
    } else {
      matrix = new Matrix4();
    }
    const ports = geo.ports.map((p) => matrix.clone().multiply(p));
    part.ports.forEach((def, p) => {
      if (def.floor && !isLevel(ports[p])) problems.push({ kind: 'not-level', piece: i, port: p });
    });
    pieces.push({ rec, part, matrix, geometry: geo, ports });
  });

  const loose: PortRef[] = [];
  pieces.forEach((pc, i) =>
    pc.ports.forEach((_, p) => {
      if (!connected.has(portKey({ piece: i, port: p }))) loose.push({ piece: i, port: p });
    }),
  );

  // Pair up loose ports that meet within tolerance; the closest pairs win.
  const candidates: Closure[] = [];
  for (let x = 0; x < loose.length; x++) {
    for (let y = x + 1; y < loose.length; y++) {
      const a = loose[x];
      const b = loose[y];
      if (a.piece === b.piece || cut.has(portKey(a)) || cut.has(portKey(b))) continue;
      const [pa, pb] = [pieces[a.piece], pieces[b.piece]];
      // Ports that meet straight on, or else a lane to either side (#60).
      for (const shift of CLOSE_SHIFTS) {
        if (!compatible(pa.part, a.port, pb.part, b.port, shift)) continue;
        const frame = shiftedFrame(pa.ports[a.port], pa.part.ports[a.port], pb.part.ports[b.port], shift);
        const err = facingError(frame, pb.ports[b.port]);
        if (err.distance <= CLOSE_DISTANCE && err.angle <= CLOSE_ANGLE) {
          candidates.push({ a, b, shift, ...err });
          break;
        }
      }
    }
  }
  candidates.sort((p, q) => p.distance - q.distance);
  const closed = new Set<string>();
  const closures: Closure[] = [];
  for (const c of candidates) {
    if (closed.has(portKey(c.a)) || closed.has(portKey(c.b))) continue;
    closed.add(portKey(c.a));
    closed.add(portKey(c.b));
    closures.push(c);
  }
  const open = loose.filter((r) => !closed.has(portKey(r)));
  const joints: Joint[] = [...links, ...closures.map((c): Joint => ({ a: c.a, b: c.b, kind: 'closure', shift: c.shift }))];

  // Group joined pieces (union-find).
  const parent = pieces.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const j of joints) parent[find(j.a.piece)] = find(j.b.piece);
  const group = pieces.map((_, i) => find(i));
  const split = open.filter((r) => cut.has(portKey(r)));
  const meant = new Set((course.intended ?? []).map(([piece, port]) => portKey({ piece, port })));
  const intended = open.filter((r) => meant.has(portKey(r)));
  const deadEnds: DeadEnd[] = [];
  for (const j of joints) {
    const [pa, pb] = [pieces[j.a.piece].part, pieces[j.b.piece].part];
    const meet = jointLanes(pa, j.a.port, pb, j.b.port, j.shift);
    for (const [ref, part, side] of [
      [j.a, pa, 0],
      [j.b, pb, 1],
    ] as const) {
      const lanes = part.ports[ref.port].lanes.filter((l) => !meet.some((m) => m[side] === l));
      if (lanes.length) deadEnds.push({ ...ref, lanes, intended: meant.has(portKey(ref)) });
    }
  }
  const attachments = course.attachments ?? [];
  const [start, timer, stoppers] = [course.start ?? null, course.timer ?? null, course.stoppers ?? []];
  return { pieces, problems, connected, closures, open, joints, group, split, intended, deadEnds, attachments, start, timer, stoppers };
}

/** The frame a piece's anchoring port faces, in world space. */
export function anchorFrame(layout: Layout, index: number): Matrix4 {
  const rec = layout.pieces[index].rec;
  const port = 'port' in rec ? rec.port : 0;
  return layout.pieces[index].ports[port].clone().multiply(FACE);
}

/** Where a piece is placed from: the port it hangs off (null: the world) and its pose from there. */
export interface Placement {
  base: PortRef | null;
  pose: Pose;
}

/** A connected piece reads as a zero pose from the port it joins (spec 5.1). */
export function placementOf(rec: PieceRec): Placement {
  if ('to' in rec) return { base: { piece: rec.to[0], port: rec.to[1] }, pose: IDENTITY_POSE };
  if ('free' in rec) return { base: rec.free && { piece: rec.free[0], port: rec.free[1] }, pose: rec.pose };
  return { base: null, pose: IDENTITY_POSE };
}

/** The pieces joined to `index`, which move together; or just the piece when moved alone. */
export function movingGroup(layout: Layout, index: number, alone = false): Set<number> {
  if (alone) return new Set([index]);
  const id = layout.group[index];
  return new Set(layout.group.flatMap((g, i) => (g === id ? [i] : [])));
}

/** Pieces in different groups (islands). */
export function groupCount(layout: Layout): number {
  return new Set(layout.group).size;
}
