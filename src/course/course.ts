import { Matrix4, Vector3 } from 'three';
import { CATALOG_VERSION, getPart, GLOBAL_SPEC, portLaneOffsets, type PartDef } from './catalog';
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
    const geo = partGeometry(part);
    let matrix: Matrix4;
    if ('to' in rec) {
      const [j, p] = rec.to;
      matrix = attach(pieces[j].ports[p], geo.ports[rec.port]);
      if (!compatible(pieces[j].part, p, part, rec.port)) problems.push({ kind: 'cannot-join', piece: i, port: rec.port });
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

// ---- Editing. Each operation returns a new course and leaves the input alone.

function clone(course: Course): Course {
  return structuredClone(course);
}

/** Place `partId` with its `port` facing the open port `at`, or at the origin. */
export function addPiece(course: Course, partId: string, at: PortRef | null, port = 0, variant?: number): Course {
  const next = clone(course);
  const rec: PieceRec = at ? { part: partId, port, to: [at.piece, at.port] } : course.pieces.length === 0 && port === 0
    ? { part: partId, at: 'origin' }
    : { part: partId, port, free: null, pose: IDENTITY_POSE };
  if (variant !== undefined) rec.variant = variant;
  next.pieces.push(rec);
  return next;
}

/** Room left around a piece's lane centrelines: the outer lane and its fence. */
const FOOTPRINT_MARGIN = GLOBAL_SPEC.lanePitch * 1.5 + GLOBAL_SPEC.fenceThickness;

/** Rough top-view bounds of a placed piece, world X/Z in mm: [x0, x1, z0, z1]. */
export function footprint(pc: PlacedPiece): [number, number, number, number] {
  const p = new Vector3();
  const xs: number[] = [];
  const zs: number[] = [];
  for (const track of partGeometry(pc.part).tracks) {
    for (const f of track.samples) {
      p.setFromMatrixPosition(f).applyMatrix4(pc.matrix);
      xs.push(p.x);
      zs.push(p.z);
    }
  }
  const m = FOOTPRINT_MARGIN;
  return [Math.min(...xs) - m, Math.max(...xs) + m, Math.min(...zs) - m, Math.max(...zs) + m];
}

/**
 * Add `partId` on its own, joined by nothing: lying on the floor by its
 * `port`, heading +Z, with the middle of its footprint at (x, z) (spec 8).
 */
export function addFreePiece(course: Course, partId: string, port: number, x: number, z: number, variant?: number): Course {
  const rec: PieceRec = { part: partId, port, free: null, pose: IDENTITY_POSE };
  const part = getPart(partId);
  const [x0, x1, z0, z1] = footprint({ rec, part, matrix: attach(new Matrix4(), partGeometry(part).ports[port]), ports: [] });
  const round = (v: number) => Math.round(v * 10) / 10;
  rec.pose = { pos: [round(x - (x0 + x1) / 2), 0, round(z - (z0 + z1) / 2)], rot: [0, 0, 0] };
  if (variant !== undefined) rec.variant = variant;
  const next = clone(course);
  next.pieces.push(rec);
  return next;
}

/**
 * The nearest spot to (x, z), on a grid of `step` mm, where `partId` added by
 * `addFreePiece` overlaps no piece already placed.
 */
export function freeSpot(course: Course, partId: string, port: number, x: number, z: number, step = 100): [number, number] {
  const taken = layoutCourse(course).pieces.map(footprint);
  // The new piece's bounds when centred on the origin; elsewhere they just shift.
  const [p0, p1, q0, q1] = footprint(layoutCourse(addFreePiece(emptyCourse(), partId, port, 0, 0)).pieces[0]);
  const fits = (cx: number, cz: number) =>
    taken.every(([x0, x1, z0, z1]) => cx + p1 <= x0 || cx + p0 >= x1 || cz + q1 <= z0 || cz + q0 >= z1);
  const x0 = Math.round(x / step) * step;
  const z0 = Math.round(z / step) * step;
  for (let ring = 0; ring <= 60; ring++) {
    const spots: [number, number][] = [];
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) === ring) spots.push([x0 + i * step, z0 + j * step]);
      }
    }
    spots.sort((a, b) => Math.hypot(a[0] - x, a[1] - z) - Math.hypot(b[0] - x, b[1] - z));
    const spot = spots.find(([cx, cz]) => fits(cx, cz));
    if (spot) return spot;
  }
  return [x0, z0];
}

/** `rec` re-anchored as a free piece at `pose` from the port `base` (null: the world). */
function freeRec(rec: PieceRec, base: PortRef | null, pose: Pose): PieceRec {
  const out: PieceRec = { part: rec.part, port: 'port' in rec ? rec.port : 0, free: base && [base.piece, base.port], pose };
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
      pieces.push(freeRec(rec, null, matrixToPose(anchorFrame(layout, i))));
      return;
    }
    const out = structuredClone(rec);
    const outRef = anchorRef(out);
    if (outRef && outRef[0] > index) outRef[0]--;
    pieces.push(out);
  });
  const next: Course = { ...clone(course), pieces };
  if (course.cuts) {
    next.cuts = course.cuts.filter(([p]) => p !== index).map(([p, port]): [number, number] => [p > index ? p - 1 : p, port]);
  }
  return tidyCuts(next);
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
  // The piece has turned round, so its old joints are gone.
  if (next.cuts) next.cuts = next.cuts.filter(([p]) => p !== index);
  return tidyCuts(next);
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

// ---- Joining, splitting and free placement (spec 5.2, 5.3, 8)

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

function baseFrame(layout: Layout, base: PortRef | null): Matrix4 {
  return base ? layout.pieces[base.piece].ports[base.port] : new Matrix4();
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

/**
 * Move the pieces in `group` by the world transform `delta`. Pieces outside
 * it stay where they are: any that hung off a moving piece keep their pose
 * from the same port, recomputed so they do not move (spec 5.2).
 */
export function moveGroup(course: Course, group: Set<number>, delta: Matrix4): Course {
  const layout = layoutCourse(course);
  const next = clone(course);
  course.pieces.forEach((rec, i) => {
    const ref = anchorRef(rec);
    const hungOffMoving = ref !== null && group.has(ref[0]);
    if (group.has(i) === hungOffMoving) return; // moves with its anchor, or nothing moves
    const { base } = placementOf(rec);
    const anchor = anchorFrame(layout, i);
    const target = group.has(i) ? delta.clone().multiply(anchor) : anchor;
    const from = base && group.has(base.piece) ? delta.clone().multiply(baseFrame(layout, base)) : baseFrame(layout, base);
    next.pieces[i] = freeRec(rec, base, matrixToPose(from.clone().invert().multiply(target)));
  });
  return next;
}

/** Set a piece's pose from its base port, freeing it if it was connected. */
export function setPose(course: Course, index: number, pose: Pose): Course {
  const next = clone(course);
  next.pieces[index] = freeRec(course.pieces[index], placementOf(course.pieces[index]).base, pose);
  return tidyCuts(next);
}

export interface Magnet {
  /** Port on the moving pieces. */
  moving: PortRef;
  /** Open port on a piece that stays put. */
  fixed: PortRef;
}

/**
 * The nearest pair of loose ports, one on the moving pieces and one on the
 * rest, that are close enough to pull together. Split ports count too, so
 * dropping a piece back where it was joins it again.
 */
export function findMagnet(course: Course, group: Set<number>, distance = MAGNET_DISTANCE): Magnet | null {
  const layout = layoutCourse(course);
  // Ports already joined between two fixed pieces are taken.
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

/** Pull the moving pieces so the magnet's ports face exactly, and join them. */
export function applyMagnet(course: Course, group: Set<number>, magnet: Magnet): Course {
  const layout = layoutCourse(course);
  const m = layout.pieces[magnet.moving.piece].ports[magnet.moving.port];
  const f = layout.pieces[magnet.fixed.piece].ports[magnet.fixed.port];
  // The rigid move that turns the moving port onto the fixed one.
  const pull = f.clone().multiply(FACE).multiply(m.clone().invert());
  return uncut(moveGroup(course, group, pull), [magnet.moving, magnet.fixed]);
}

function uncut(course: Course, refs: PortRef[]): Course {
  if (!course.cuts) return course;
  const keys = new Set(refs.map(portKey));
  return withCuts(course, course.cuts.filter(([piece, port]) => !keys.has(portKey({ piece, port }))));
}

/** `course` with these split marks, leaving the field out when there are none. */
function withCuts(course: Course, cuts: [number, number][]): Course {
  const next = { ...course };
  if (cuts.length) next.cuts = cuts;
  else delete next.cuts;
  return next;
}

/**
 * Split a joint (spec 8). A stored connection becomes a free placement at
 * the same spot; both ports are marked so they stay apart until moved.
 */
export function splitJoint(course: Course, a: PortRef, b: PortRef): Course {
  const next = clone(course);
  for (const [x, y] of [[a, b], [b, a]]) {
    const rec = course.pieces[y.piece];
    if ('to' in rec && rec.to[0] === x.piece && rec.to[1] === x.port && rec.port === y.port) {
      next.pieces[y.piece] = freeRec(rec, x, IDENTITY_POSE);
    }
  }
  next.cuts = [...(course.cuts ?? []), [a.piece, a.port], [b.piece, b.port]];
  return next;
}

/** Join two ports that meet, undoing a split; ports a little apart are pulled together first. */
export function joinPorts(course: Course, a: PortRef, b: PortRef): Course {
  const later = a.piece > b.piece ? a : b;
  const earlier = later === a ? b : a;
  const layout = layoutCourse(uncut(course, [a, b]));
  if (layout.group[a.piece] === layout.group[b.piece]) return uncut(course, [a, b]);
  return applyMagnet(course, movingGroup(layout, later.piece), { moving: later, fixed: earlier });
}

/** A loose port near `ref` that it could join: for the "join" button. */
export function joinableNear(layout: Layout, ref: PortRef, distance = MAGNET_DISTANCE): PortRef | null {
  const here = layout.pieces[ref.piece];
  let best: { ref: PortRef; d: number } | null = null;
  for (const other of layout.open) {
    if (other.piece === ref.piece) continue;
    const there = layout.pieces[other.piece];
    if (!compatible(here.part, ref.port, there.part, other.port)) continue;
    const err = facingError(here.ports[ref.port], there.ports[other.port]);
    if (err.distance <= distance && err.angle <= MAGNET_ANGLE && (!best || err.distance < best.d)) best = { ref: other, d: err.distance };
  }
  return best?.ref ?? null;
}

/** Drop split marks on ports that no longer touch anything they could join. */
export function tidyCuts(course: Course): Course {
  if (!course.cuts) return course;
  const loose = { ...course };
  delete loose.cuts;
  const meeting = new Set(layoutCourse(loose).closures.flatMap((c) => [portKey(c.a), portKey(c.b)]));
  const seen = new Set<string>();
  const cuts = course.cuts.filter(([piece, port]) => {
    const key = portKey({ piece, port });
    if (!meeting.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return withCuts(course, cuts);
}
