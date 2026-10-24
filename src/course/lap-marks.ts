import * as THREE from 'three';
import { GLOBAL_SPEC, laneOffset } from './catalog';
import type { Layout, PlacedPiece } from './course';
import { checkLaps } from './laps';
import type { SimLane } from './sim-course';
import { roadFrame, timerLane } from './timing';

// Where the start line and the lap timer (#56) cross each lane the
// simulator runs in, for lap counting and lap times (#28, spec simulator.md 6).

/**
 * How far above or below a line a lane may cross it and still be on it, mm:
 * a lane on the lane change's bridge passes over the start line's piece
 * without crossing it (provisional, under the bridge's 41mm rise).
 */
const CROSS_HEIGHT = 30;

/** A line across the road: its frame (Z along the road) and the stretch of it across the road, as local X, mm. */
interface Line {
  frame: THREE.Matrix4;
  from: number;
  to: number;
}

/** The line across the lanes of a piece's road, or across one of them. */
function lineOn(pc: PlacedPiece, offset: number, lanes: readonly number[]): Line {
  const half = GLOBAL_SPEC.lanePitch / 2;
  // Looking along the road, lanes count from the left, which is + X.
  const xs = lanes.map((l) => -laneOffset(l));
  return { frame: roadFrame(pc, offset), from: Math.min(...xs) - half, to: Math.max(...xs) + half };
}

/** A lane's centre with the distance along it to each point. */
function withDistances(points: THREE.Vector3[]): Pick<SimLane, 'points' | 'distances'> {
  const distances = [0];
  for (let i = 1; i < points.length; i++) distances.push(distances[i - 1] + points[i].distanceTo(points[i - 1]));
  return { points, distances };
}

/** The first spot along a lane's centre where it crosses a line, either way, mm; null when it never does. */
export function crossing(lane: Pick<SimLane, 'points' | 'distances'>, line: Line): number | null {
  const toLine = line.frame.clone().invert();
  const { points, distances } = lane;
  let a = points[0].clone().applyMatrix4(toLine);
  for (let i = 1; i < points.length; i++) {
    const b = points[i].clone().applyMatrix4(toLine);
    if ((a.z < 0 && b.z >= 0) || (a.z > 0 && b.z <= 0)) {
      const t = a.z / (a.z - b.z);
      const at = a.clone().lerp(b, t);
      if (at.x >= line.from && at.x <= line.to && Math.abs(at.y) <= CROSS_HEIGHT) return distances[i - 1] + t * (distances[i] - distances[i - 1]);
    }
    a = b;
  }
  return null;
}

/** Where each lane crosses the start line and where the timer times it, mm along it; null where it does not. */
export interface LapMarks {
  start: (number | null)[];
  timer: (number | null)[];
}

/**
 * The start line and lap timer on each lane (#28). The timer times only the
 * lane it reaches over, as the real one does, unless it is set to time
 * every lane (#56 決定事項).
 */
export function lapMarks(layout: Layout, lanes: readonly Pick<SimLane, 'points' | 'distances'>[]): LapMarks {
  const { start, timer } = layout;
  const startPc = start && layout.pieces[start.piece];
  const timerPc = timer && layout.pieces[timer.piece];
  const startLine = startPc ? lineOn(startPc, start.offset, startPc.part.lanes) : null;
  const timerLine = timerPc ? lineOn(timerPc, timer.offset, timer.everyLane ? timerPc.part.lanes : [timerLane(timerPc, timer)]) : null;
  return {
    start: lanes.map((lane) => (startLine ? crossing(lane, startLine) : null)),
    timer: lanes.map((lane) => (timerLine ? crossing(lane, timerLine) : null)),
  };
}

/**
 * The way round to run so that machines set off the way the start line's
 * arrows point (#56): `dir`, or the other way. With no start line, `dir`.
 */
export function startDirection(layout: Layout, dir: 1 | -1): 1 | -1 {
  const { start } = layout;
  const pc = start && layout.pieces[start.piece];
  const laps = pc && checkLaps(layout, dir)?.laps;
  if (!pc || !laps) return dir;
  const frame = roadFrame(pc, start.offset, start.reverse);
  const line = lineOn(pc, start.offset, pc.part.lanes);
  const toLine = frame.clone().invert();
  for (const l of laps) {
    const { distances } = withDistances(l.points);
    const at = crossing({ points: l.points, distances }, line);
    if (at === null) continue;
    // Which way the lane runs through the line, seen from the arrows.
    const i = distances.findIndex((d) => d > at);
    if (i <= 0) continue;
    const a = l.points[i - 1].clone().applyMatrix4(toLine);
    const b = l.points[i].clone().applyMatrix4(toLine);
    return b.z >= a.z ? dir : dir === 1 ? -1 : 1;
  }
  return dir;
}

/**
 * Which lane from the left at the start the lap timer times (#28): where a
 * machine is set to run first, so the timer catches it. Null when there is
 * no timer, it times every lane, or no lane runs under it.
 */
export function timedLane(layout: Layout, dir: 1 | -1): number | null {
  if (!layout.timer || layout.timer.everyLane) return null;
  const laps = checkLaps(layout, startDirection(layout, dir), true)?.laps ?? [];
  const lane = lapMarks(layout, laps.map((l) => withDistances(l.points))).timer.findIndex((at) => at !== null);
  return lane < 0 ? null : lane;
}
