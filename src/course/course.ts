import { Matrix4, Vector3 } from 'three';
import { CATALOG_VERSION, getPart, portLaneOffsets, type PartDef } from './catalog';
import { bendAngle, bendMatrix, BEND_LIMIT, pieceGeometry, TWIST_LIMIT, type Bend } from './flex';
import { attach, FACE, facingError, IDENTITY_POSE, poseToMatrix, type FrameError, type PartGeometry, type Pose } from './geometry';

/** What every piece record has. */
interface RecBase {
  part: string;
  variant?: number;
  /** Twist of the piece about its centreline, deg, + lowers the right side (spec 16.2). */
  twist?: number;
}

/** A placed piece. Pieces only refer to pieces before them (spec 5.1). */
export type PieceRec =
  | (RecBase & { at: 'origin' })
  /** Joined to a port; the joint may bend a little (spec 16.1). */
  | (RecBase & { port: number; to: [piece: number, port: number]; bend?: Bend })
  /**
   * Free placement: this piece's `port` faces the frame `pose`, which is
   * relative to the port `free` (or to the world when null). A zero pose
   * relative to a port is the same as connecting to it.
   */
  | (RecBase & { port: number; free: [piece: number, port: number] | null; pose: Pose });

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
}

/** Two ports that are joined, by the stored graph or by meeting (spec 5.3). */
export interface Joint {
  a: PortRef;
  b: PortRef;
  /** `link`: stored as a connection; `closure`: two loose ports that meet. */
  kind: 'link' | 'closure';
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
    const part = getPart(rec.part);
    if ('port' in rec && (rec.port < 0 || rec.port >= part.ports.length)) {
      throw new Error(`piece ${i}: no port ${rec.port} on ${rec.part}`);
    }
    if (rec.variant !== undefined && !part.variants[rec.variant]) {
      throw new Error(`piece ${i}: no variant ${rec.variant} on ${rec.part}`);
    }
    const ref = anchorRef(rec);
    if (ref) {
      const [j, p] = ref;
      if (!(j >= 0 && j < i)) throw new Error(`piece ${i}: refers to piece ${j}`);
      const other = getPart(course.pieces[j].part);
      if (p < 0 || p >= other.ports.length) throw new Error(`piece ${i}: no port ${p} on piece ${j}`);
    }
  });
  for (const [piece, port] of course.cuts ?? []) {
    const rec = course.pieces[piece];
    if (!rec || port < 0 || port >= getPart(rec.part).ports.length) throw new Error(`split mark on missing port ${piece}:${port}`);
  }
}

/** Ports two pieces can be joined by: same kind and lane count, and partners that allow each other. */
export function compatible(a: PartDef, ap: number, b: PartDef, bp: number): boolean {
  const pa = a.ports[ap];
  const pb = b.ports[bp];
  if (a.cannotJoin?.includes(b.id) || b.cannotJoin?.includes(a.id)) return false;
  if ((pa.partners && !pa.partners.includes(b.id)) || (pb.partners && !pb.partners.includes(a.id))) return false;
  return (pa.kind ?? 'std') === (pb.kind ?? 'std') && pa.lanes.length === pb.lanes.length;
}

/**
 * Lanes that meet at a joint between port `ap` of `a` and port `bp` of `b`,
 * as [lane on a, lane on b]. The ports face each other, so the lane on the
 * right of one is on the left of the other.
 */
export function jointLanes(a: PartDef, ap: number, b: PartDef, bp: number): [number, number][] {
  const others = portLaneOffsets(b.ports[bp]);
  const out: [number, number][] = [];
  for (const { lane, right } of portLaneOffsets(a.ports[ap])) {
    const match = others.find((o) => Math.abs(o.right + right) < 1e-6);
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
    const part = getPart(rec.part);
    const geo = pieceGeometry(part, rec.twist);
    if (Math.abs(rec.twist ?? 0) > TWIST_LIMIT) problems.push({ kind: 'twist-limit', piece: i, port: 'port' in rec ? rec.port : 0 });
    let matrix: Matrix4;
    if ('to' in rec) {
      const [j, p] = rec.to;
      // A bent joint turns about the joint itself (spec 16.1).
      matrix = attach(pieces[j].ports[p].clone().multiply(bendMatrix(rec.bend)), geo.ports[rec.port]);
      if (!compatible(pieces[j].part, p, part, rec.port)) problems.push({ kind: 'cannot-join', piece: i, port: rec.port });
      if (bendAngle(rec.bend) > BEND_LIMIT) problems.push({ kind: 'bend-limit', piece: i, port: rec.port });
      connected.add(portKey({ piece: j, port: p }));
      connected.add(portKey({ piece: i, port: rec.port }));
      links.push({ a: { piece: j, port: p }, b: { piece: i, port: rec.port }, kind: 'link' });
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
      if (!compatible(pieces[a.piece].part, a.port, pieces[b.piece].part, b.port)) continue;
      const err = facingError(pieces[a.piece].ports[a.port], pieces[b.piece].ports[b.port]);
      if (err.distance <= CLOSE_DISTANCE && err.angle <= CLOSE_ANGLE) candidates.push({ a, b, ...err });
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
  const joints: Joint[] = [...links, ...closures.map((c): Joint => ({ a: c.a, b: c.b, kind: 'closure' }))];

  // Group joined pieces (union-find).
  const parent = pieces.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const j of joints) parent[find(j.a.piece)] = find(j.b.piece);
  const group = pieces.map((_, i) => find(i));
  const split = open.filter((r) => cut.has(portKey(r)));
  return { pieces, problems, connected, closures, open, joints, group, split };
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

/** Number of pieces of each part, in catalog order of first use. */
export function partCounts(course: Course): Map<string, number> {
  const counts = new Map<string, number>();
  for (const rec of course.pieces) counts.set(rec.part, (counts.get(rec.part) ?? 0) + 1);
  return counts;
}
