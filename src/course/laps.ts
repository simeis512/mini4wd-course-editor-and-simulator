import { Matrix4, Vector3 } from 'three';
import { GLOBAL_SPEC, laneLinks, laneOffset, portLaneOffsets } from './catalog';
import type { PartDef } from './part';
import { jointLanes, portKey, type Layout, type PlacedPiece, type PortRef } from './course';
import { pointOnFrame, type PartGeometry } from './geometry';

// Following each lane round the course (spec 7, #16): which lane a lap
// started in comes back in, and how long the lap is in each lane.

/** How close a track's lane must end to a port's lane to be that lane, mm. */
const LANE_MATCH = 1;

/** The road a lane runs along through a part, from one port lane to another, part-local mm. */
interface LanePath {
  from: [port: number, lane: number];
  to: [port: number, lane: number];
  points: Vector3[];
}

const pathCache = new WeakMap<PartGeometry, LanePath[]>();

/** Where a port's lane meets the road, part-local. */
function portLanePoint(part: PartDef, geo: PartGeometry, port: number, lane: number): Vector3 {
  const right = portLaneOffsets(part.ports[port]).find((o) => o.lane === lane)?.right ?? 0;
  return pointOnFrame(geo.ports[port], right, 0);
}

/**
 * The road each lane link of a part runs along: the lane of one of its
 * tracks that starts at one port lane and ends at the other. A link no
 * track matches goes straight across.
 */
function lanePaths(part: PartDef, geo: PartGeometry): LanePath[] {
  let paths = pathCache.get(geo);
  if (paths) return paths;
  const lines = geo.tracks.flatMap((t) => t.lanes.map((l) => t.samples.map((f) => pointOnFrame(f, laneOffset(l), 0))));
  paths = laneLinks(part).map(({ from, to }) => {
    const a = portLanePoint(part, geo, ...from);
    const b = portLanePoint(part, geo, ...to);
    for (const line of lines) {
      const [first, last] = [line[0], line[line.length - 1]];
      if (first.distanceTo(a) < LANE_MATCH && last.distanceTo(b) < LANE_MATCH) return { from, to, points: line };
      if (first.distanceTo(b) < LANE_MATCH && last.distanceTo(a) < LANE_MATCH) return { from, to, points: [...line].reverse() };
    }
    return { from, to, points: [a, b] };
  });
  pathCache.set(geo, paths);
  return paths;
}

/** A lane where it crosses into a piece: the port it comes in by and the part's lane there. */
export interface LaneEntry extends PortRef {
  lane: number;
}

/**
 * Run through a piece from where a lane comes in: the port and lane it
 * leaves by and the road it runs along, world mm. Null when the lane ends
 * inside the piece.
 */
function through(pc: PlacedPiece, entry: LaneEntry): { port: number; lane: number; points: Vector3[] } | null {
  for (const path of lanePaths(pc.part, pc.geometry)) {
    const forward = path.from[0] === entry.port && path.from[1] === entry.lane;
    const back = path.to[0] === entry.port && path.to[1] === entry.lane;
    if (!forward && !back) continue;
    const [port, lane] = forward ? path.to : path.from;
    const local = forward ? path.points : [...path.points].reverse();
    return { port, lane, points: local.map((p) => p.clone().applyMatrix4(pc.matrix)) };
  }
  return null;
}

/** One lap from the start line in one lane. */
export interface Lap {
  /** The lane it starts in, as the start port's lane. */
  lane: number;
  /** The lane it comes back to the start line in; null when the lane is broken. */
  next: number | null;
  /** Length along the lane centre, mm, up to where it comes back or breaks off. */
  length: number;
  /** Where the lane breaks off: an open port, or a joint whose lanes do not line up. */
  broken: PortRef | null;
  /** The lane centre, world mm. */
  points: Vector3[];
}

export interface LapCheck {
  /** Where the laps start: the lanes cross into this piece by this port (the start line). */
  start: PortRef;
  /** A lap per lane of the start port, left to right looking along the way the course runs. */
  laps: Lap[];
  /**
   * The lanes in the order a car meets them lap after lap, starting in the
   * left-hand lane; empty when a lane is broken.
   */
  cycle: number[];
  /** Whether running lap after lap goes through every lane (3 laps for 3 lanes). */
  allLanes: boolean;
  /**
   * The way the course turns overall, which puts the inside lane on that
   * side: 1 left (anticlockwise from above), -1 right, 0 neither (a figure
   * of eight).
   */
  turn: 1 | -1 | 0;
}

/** More steps than any real course takes; stops a lap that never comes back. */
const MAX_STEPS = 10000;

/** How far ahead of where it leaves the road a machine can land, mm (#28, provisional). */
export const JUMP_REACH = 1500;
/** How squarely a landing port must face back at the take-off: the cosine of the most it may turn away (30°). */
const JUMP_FACING = Math.cos(Math.PI / 6);

const forwardOf = (frame: Matrix4) => new Vector3(0, 0, 1).transformDirection(frame).setY(0).normalize();

/**
 * Where a lane that runs off the road lands (#28), as off a jump ramp: the
 * lane of an open port, or a lane that ends at a joint, ahead that faces
 * back at it, in line with where the lane left. The nearest such; null when
 * there is none.
 */
export function jumpLanding(layout: Layout, takeoff: PortRef, from: Vector3): LaneEntry | null {
  const ahead = forwardOf(layout.pieces[takeoff.piece].ports[takeoff.port]);
  let best: (LaneEntry & { reach: number }) | null = null;
  const ends = [...layout.open.map((o) => ({ ...o, lanes: null })), ...layout.deadEnds];
  for (const o of ends) {
    if (o.piece === takeoff.piece && o.port === takeoff.port) continue;
    const pc = layout.pieces[o.piece];
    const frame = pc.ports[o.port];
    if (forwardOf(frame).dot(ahead) > -JUMP_FACING) continue;
    for (const { lane, right } of portLaneOffsets(pc.part.ports[o.port])) {
      if (o.lanes && !o.lanes.includes(lane)) continue;
      const d = pointOnFrame(frame, right, 0).sub(from);
      const reach = d.dot(ahead);
      const side = d.setY(0).addScaledVector(ahead, -reach).length();
      if (reach > 0 && reach <= JUMP_REACH && side <= GLOBAL_SPEC.lanePitch / 2 && (!best || reach < best.reach)) {
        best = { piece: o.piece, port: o.port, lane, reach };
      }
    }
  }
  return best && { piece: best.piece, port: best.port, lane: best.lane };
}

/** Follow one lane from the start line until it crosses it again; over jumps too when `jumps`. */
function runLap(layout: Layout, partner: Map<string, PortRef & { shift: number }>, start: PortRef, lane: number, jumps: boolean): Lap {
  let at: LaneEntry = { ...start, lane };
  const points: Vector3[] = [];
  let length = 0;
  const add = (pts: Vector3[]) => {
    for (const p of pts) {
      if (points.length) length += points[points.length - 1].distanceTo(p);
      points.push(p);
    }
  };
  for (let step = 0; step < MAX_STEPS; step++) {
    const pc = layout.pieces[at.piece];
    const out = through(pc, at);
    if (!out) return { lane, next: null, length, broken: { piece: at.piece, port: at.port }, points };
    add(out.points);
    const leave = { piece: at.piece, port: out.port };
    const other = partner.get(portKey(leave));
    const match = other && jointLanes(pc.part, out.port, layout.pieces[other.piece].part, other.port, other.shift).find(([l]) => l === out.lane);
    if (other && match) at = { piece: other.piece, port: other.port, lane: match[1] };
    else {
      // Off the road: through the air to where it lands, the lane going straight there.
      const landing = jumps ? jumpLanding(layout, leave, points[points.length - 1]) : null;
      if (!landing) return { lane, next: null, length, broken: leave, points };
      at = landing;
    }
    if (at.piece === start.piece && at.port === start.port) return { lane, next: at.lane, length, broken: null, points };
  }
  return { lane, next: null, length, broken: null, points };
}

/** Total turn of a path seen from above, deg, + to the left. */
function turning(points: readonly Vector3[]): number {
  let total = 0;
  let prev: number | null = null;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dz = points[i].z - points[i - 1].z;
    if (Math.hypot(dx, dz) < 1e-6) continue;
    // Heading measured so that a turn to the left (from +Z towards +X) adds.
    const heading = Math.atan2(dx, dz);
    if (prev !== null) total += Math.atan2(Math.sin(heading - prev), Math.cos(heading - prev));
    prev = heading;
  }
  return (total * 180) / Math.PI;
}

/**
 * Follow every lane from the start line (spec 7, #16): the lanes cross into
 * the first piece (or the piece `from`) by its first port, or by its second
 * when the course runs the other way (`dir` -1), and laps are counted each
 * time they cross that joint again. With `jumps`, a lane goes on over a jump
 * to where it lands (`jumpLanding`), as the simulator runs it. Null for a
 * course with no pieces.
 */
export function checkLaps(layout: Layout, dir: 1 | -1 = 1, { jumps = false, from = 0 }: { jumps?: boolean; from?: number } = {}): LapCheck | null {
  const first = layout.pieces[from];
  if (!first) return null;
  // A shifted joint is shifted the same seen from either side (#60).
  const partner = new Map<string, PortRef & { shift: number }>();
  for (const j of layout.joints) {
    partner.set(portKey(j.a), { ...j.b, shift: j.shift });
    partner.set(portKey(j.b), { ...j.a, shift: j.shift });
  }
  const start: PortRef = { piece: from, port: dir === -1 && first.part.ports.length > 1 ? 1 : 0 };
  // Running into the piece is looking back into the port, so its left is the port's right.
  const lanes = portLaneOffsets(first.part.ports[start.port])
    .sort((a, b) => b.right - a.right)
    .map((o) => o.lane);
  const laps = lanes.map((lane) => runLap(layout, partner, start, lane, jumps));
  const broken = laps.some((l) => l.next === null);
  const cycle: number[] = [];
  if (!broken && lanes.length) {
    let lane = lanes[0];
    while (!cycle.includes(lane)) {
      cycle.push(lane);
      lane = laps.find((l) => l.lane === lane)!.next!;
    }
  }
  const turn = broken ? 0 : Math.round(turning(laps[0].points) / 360);
  return {
    start,
    laps,
    cycle,
    allLanes: cycle.length === lanes.length && lanes.length > 0,
    turn: turn > 0 ? 1 : turn < 0 ? -1 : 0,
  };
}
