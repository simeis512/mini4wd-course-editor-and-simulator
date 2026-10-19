import { Matrix4, Vector3 } from 'three';
import { CATALOG_VERSION, getPart, portLaneOffsets, type PartDef } from './catalog';
import { attach, FACE, facingError, IDENTITY_POSE, matrixToPose, partGeometry, poseToMatrix, type FrameError, type Pose } from './geometry';

/** A placed piece. Pieces only refer to pieces before them (spec 5.1). */
export type PieceRec =
  | { part: string; variant?: number; at: 'origin' }
  | { part: string; variant?: number; port: number; to: [piece: number, port: number] }
  /**
   * Free placement: this piece's `port` faces the frame `pose`, which is
   * relative to the port `free` (or to the world when null). A zero pose
   * relative to a port is the same as connecting to it.
   */
  | { part: string; variant?: number; port: number; free: [piece: number, port: number] | null; pose: Pose };

export interface Course {
  v: 1;
  catalog: number;
  pieces: PieceRec[];
  dir?: 1 | -1;
  name?: string;
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
  /** Port frames in world coordinates. */
  ports: Matrix4[];
}

export interface Closure extends FrameError {
  a: PortRef;
  b: PortRef;
}

/**
 * Something that can be built in the editor but not with real parts:
 * a floor end that is not level, or two parts that cannot be joined.
 */
export interface Problem {
  kind: 'not-level' | 'cannot-join';
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
}

export const portKey = (r: PortRef): string => `${r.piece}:${r.port}`;

function anchorRef(rec: PieceRec): [number, number] | null {
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
  const problems: Problem[] = [];
  course.pieces.forEach((rec, i) => {
    const part = getPart(rec.part);
    const geo = partGeometry(part);
    let matrix: Matrix4;
    if ('to' in rec) {
      const [j, p] = rec.to;
      matrix = attach(pieces[j].ports[p], geo.ports[rec.port]);
      if (!compatible(pieces[j].part, p, part, rec.port)) problems.push({ kind: 'cannot-join', piece: i, port: rec.port });
      connected.add(portKey({ piece: j, port: p }));
      connected.add(portKey({ piece: i, port: rec.port }));
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
    pieces.push({ rec, part, matrix, ports });
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
      if (a.piece === b.piece) continue;
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
  return { pieces, problems, connected, closures, open };
}

// ---- Editing. Each operation returns a new course and leaves the input alone.

function clone(course: Course): Course {
  return structuredClone(course);
}

/** Place `partId` with its `port` facing the open port `at`, or at the origin. */
export function addPiece(course: Course, partId: string, at: PortRef | null, port = 0, variant?: number): Course {
  const next = clone(course);
  const rec: PieceRec = at ? { part: partId, port, to: [at.piece, at.port] } : course.pieces.length === 0
    ? { part: partId, at: 'origin' }
    : { part: partId, port, free: null, pose: IDENTITY_POSE };
  if (variant !== undefined) rec.variant = variant;
  next.pieces.push(rec);
  return next;
}

/** Re-anchor `rec` (which faced `target`) as a free piece in world space. */
function freeAt(rec: PieceRec, target: Matrix4): PieceRec {
  const port = 'port' in rec ? rec.port : 0;
  const out: PieceRec = { part: rec.part, port, free: null, pose: matrixToPose(target) };
  if (rec.variant !== undefined) out.variant = rec.variant;
  return out;
}

/** The frame a piece's anchoring port faces, in world space. */
export function anchorFrame(layout: Layout, index: number): Matrix4 {
  const rec = layout.pieces[index].rec;
  const port = 'port' in rec ? rec.port : 0;
  return layout.pieces[index].ports[port].clone().multiply(FACE);
}

/**
 * Remove a piece. Pieces anchored to it stay where they are as free pieces
 * (spec 8), and later references are renumbered.
 */
export function deletePiece(course: Course, index: number): Course {
  const layout = layoutCourse(course);
  const pieces: PieceRec[] = [];
  course.pieces.forEach((rec, i) => {
    if (i === index) return;
    const ref = anchorRef(rec);
    if (ref && ref[0] === index) {
      pieces.push(freeAt(rec, anchorFrame(layout, i)));
      return;
    }
    const out = structuredClone(rec);
    const outRef = anchorRef(out);
    if (outRef && outRef[0] > index) outRef[0]--;
    pieces.push(out);
  });
  return { ...clone(course), pieces };
}

/**
 * Turn a piece round so it joins by its other port (spec 8: flip; also how a
 * curve becomes a right-hander). Pieces hanging off it keep their port.
 */
export function flipPiece(course: Course, index: number): Course {
  const next = clone(course);
  const rec = next.pieces[index];
  const part = getPart(rec.part);
  if (part.ports.length !== 2) return next;
  const oldPort = 'port' in rec ? rec.port : 0;
  const newPort = 1 - oldPort;
  if ('at' in rec) {
    next.pieces[index] = { part: rec.part, port: newPort, free: null, pose: IDENTITY_POSE };
    if (rec.variant !== undefined) next.pieces[index].variant = rec.variant;
  } else {
    rec.port = newPort;
  }
  // The port that used to be free is now the anchoring one and vice versa.
  next.pieces.forEach((other, i) => {
    if (i <= index) return;
    const ref = anchorRef(other);
    if (ref && ref[0] === index) ref[1] = ref[1] === oldPort ? newPort : oldPort;
  });
  return next;
}

export function setVariant(course: Course, index: number, variant: number): Course {
  const next = clone(course);
  const rec = next.pieces[index];
  if (variant === getPart(rec.part).defaultVariant) delete rec.variant;
  else rec.variant = variant;
  return next;
}

/** Number of pieces of each part, in catalog order of first use. */
export function partCounts(course: Course): Map<string, number> {
  const counts = new Map<string, number>();
  for (const rec of course.pieces) counts.set(rec.part, (counts.get(rec.part) ?? 0) + 1);
  return counts;
}

// ---- Free placement (spec 5.2, 8)

/** Snap steps while moving a piece (spec 8). */
export const SNAP_DISTANCE = 10;
export const SNAP_ANGLE = 15;
/** Open ports closer than this pull together while dragging (spec 8). */
export const MAGNET_DISTANCE = 40;
export const MAGNET_ANGLE = 10;

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

function freeRec(rec: PieceRec, port: number, base: PortRef | null, pose: Pose): PieceRec {
  const out: PieceRec = { part: rec.part, port, free: base && [base.piece, base.port], pose };
  if (rec.variant !== undefined) out.variant = rec.variant;
  return out;
}

/** The piece and every piece anchored to it, directly or through others. */
export function movingGroup(course: Course, index: number): Set<number> {
  const group = new Set([index]);
  course.pieces.forEach((rec, i) => {
    const ref = anchorRef(rec);
    if (ref && group.has(ref[0])) group.add(i);
  });
  return group;
}

function baseFrame(layout: Layout, base: PortRef | null): Matrix4 {
  return base ? layout.pieces[base.piece].ports[base.port] : new Matrix4();
}

function snapPose(pose: Pose): Pose {
  const step = (x: number, s: number) => Math.round(x / s) * s || 0;
  return {
    pos: pose.pos.map((x) => step(x, SNAP_DISTANCE)) as Pose['pos'],
    rot: [step(pose.rot[0], SNAP_ANGLE), pose.rot[1], pose.rot[2]],
  };
}

export interface MoveOptions {
  /** Move only this piece; pieces hanging off it stay where they are. */
  alone?: boolean;
  /** Round the pose from the base port to 10 mm / 15° (spec 8). */
  snap?: boolean;
}

/**
 * Free a piece so its anchoring port faces `target` (world). Its pose is
 * kept relative to the port it hung off, so a jump gap stays a jump gap
 * when parts before it change (spec 5.2).
 */
export function movePiece(course: Course, index: number, target: Matrix4, opts: MoveOptions = {}): Course {
  const layout = layoutCourse(course);
  const rec = course.pieces[index];
  const { base } = placementOf(rec);
  let pose = matrixToPose(baseFrame(layout, base).clone().invert().multiply(target));
  if (opts.snap) pose = snapPose(pose);
  const next = clone(course);
  next.pieces[index] = freeRec(rec, 'port' in rec ? rec.port : 0, base, pose);
  if (opts.alone) {
    next.pieces.forEach((other, i) => {
      const ref = anchorRef(other);
      if (i > index && ref && ref[0] === index) next.pieces[i] = freeAt(other, anchorFrame(layout, i));
    });
  }
  return next;
}

/** Set a piece's pose from its base port, freeing it if it was connected. */
export function setPose(course: Course, index: number, pose: Pose): Course {
  const next = clone(course);
  const rec = course.pieces[index];
  next.pieces[index] = freeRec(rec, 'port' in rec ? rec.port : 0, placementOf(rec).base, pose);
  return next;
}

export interface Magnet {
  /** Port on the moving pieces. */
  moving: PortRef;
  /** Open port on a piece that stays put. */
  fixed: PortRef;
}

/**
 * Find the nearest pair of open ports, one on the pieces moving with
 * `index` and one on the rest, that are close enough to pull together.
 */
export function findMagnet(course: Course, index: number, distance = MAGNET_DISTANCE): Magnet | null {
  const layout = layoutCourse(course);
  const group = movingGroup(course, index);
  // Ports already closed between two fixed pieces are taken.
  const taken = new Set<string>();
  for (const c of layout.closures) {
    if (!group.has(c.a.piece) && !group.has(c.b.piece)) {
      taken.add(portKey(c.a));
      taken.add(portKey(c.b));
    }
  }
  const loose = layout.pieces.flatMap((pc, piece) =>
    pc.ports.map((_, port) => ({ piece, port })).filter((r) => !layout.connected.has(portKey(r)) && !taken.has(portKey(r))),
  );
  let best: (Magnet & { d: number }) | null = null;
  for (const m of loose) {
    if (!group.has(m.piece)) continue;
    for (const f of loose) {
      if (group.has(f.piece)) continue;
      if (!compatible(layout.pieces[m.piece].part, m.port, layout.pieces[f.piece].part, f.port)) continue;
      const err = facingError(layout.pieces[m.piece].ports[m.port], layout.pieces[f.piece].ports[f.port]);
      if (err.distance <= distance && err.angle <= MAGNET_ANGLE && (!best || err.distance < best.d)) {
        best = { moving: m, fixed: f, d: err.distance };
      }
    }
  }
  return best && { moving: best.moving, fixed: best.fixed };
}

/**
 * Pull the moving pieces so the magnet's ports face exactly. When the
 * dragged piece itself meets an earlier piece it becomes a plain connection.
 */
export function applyMagnet(course: Course, index: number, magnet: Magnet): Course {
  const { moving, fixed } = magnet;
  const rec = course.pieces[index];
  if (moving.piece === index && fixed.piece < index) {
    const next = clone(course);
    const out: PieceRec = { part: rec.part, port: moving.port, to: [fixed.piece, fixed.port] };
    if (rec.variant !== undefined) out.variant = rec.variant;
    next.pieces[index] = out;
    return next;
  }
  const layout = layoutCourse(course);
  const m = layout.pieces[moving.piece].ports[moving.port];
  const f = layout.pieces[fixed.piece].ports[fixed.port];
  // The rigid move that turns the moving port onto the fixed one.
  const pull = f.clone().multiply(FACE).multiply(m.clone().invert());
  const { base } = placementOf(rec);
  const target = pull.multiply(anchorFrame(layout, index));
  const pose = matrixToPose(baseFrame(layout, base).clone().invert().multiply(target));
  const next = clone(course);
  next.pieces[index] = freeRec(rec, 'port' in rec ? rec.port : 0, base, pose);
  return next;
}
