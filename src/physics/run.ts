import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import type { Layout } from '../course/course';
import { GLOBAL_SPEC } from '../course/catalog';
import { MM } from '../course/mesh';
import { laneStart, lapMarks } from '../course/lap-marks';
import { laneSpot, simCourse, type SimCourse } from '../course/sim-course';
import { addCourseColliders, type CourseColliders } from './course-colliders';
import { createMachine, driveMachine, type Machine } from './machine';
import { frontReach, STANDARD_MACHINE, type MachineSpec } from './machine-spec';
import { createPhysicsWorld } from './world';

// One machine running round a course (#27, #28, spec simulator.md): a fixed
// 1 ms physics step, laps and lap times at the start line and the timer,
// and the ways a run comes to an end (spec 5).

/** Physics step, s (spec simulator.md 4, provisional). */
export const STEP = 1 / 1000;
/** A machine that gets less than this far along its lane in `STALL_TIME` has stopped (spec simulator.md 5, provisional), mm. */
export const STALL_DISTANCE = 50;
export const STALL_TIME = 2;
/** A machine that gets this far back from the furthest it has been is running the wrong way (spec simulator.md 5, provisional), mm. */
export const REVERSE_DISTANCE = 200;
/** How near the end of one lane's line a machine must be to go on to the next lane's, mm. */
const LANE_HANDOVER = 100;
/**
 * How far along its lane a machine is looked for from where it last was,
 * mm: far more than it runs in a step, but short of where a lane passes
 * over or under itself, so a machine off the line does not jump there (#112).
 */
export const TRACK_WINDOW = 150;
/**
 * A machine further than this from its own lane's line, nearer another
 * lane's, has jumped into that lane (owner, 2026-10-29; provisional), mm:
 * half the lane pitch. Lane changes and shifted joints stay on the line.
 */
export const WRONG_LANE_OFF = GLOBAL_SPEC.lanePitch / 2;
/** How long a machine may run off its lane like that before it is out (owner: a few seconds; provisional), s. */
export const WRONG_LANE_TIME = 2;

/** Why a run came to an end (spec simulator.md 5). */
export type OutReason = 'floor' | 'stopper' | 'stopped' | 'flipped' | 'reverse' | 'lane';

export interface RunState {
  /** Time since the start, s. */
  time: number;
  /** Forward speed, m/s. */
  speed: number;
  /** Chassis middle, world mm, and its turn. */
  position: Vector3;
  quaternion: Quaternion;
  /** Distance run along the lanes since the start, mm. */
  distance: number;
  /** Times past the start line; with none, past where it set off in each lane. */
  laps: number;
  /**
   * Lap times, s: between passes of the lap timer (#56) on the lanes it
   * times, else from the start between passes of the start line.
   */
  lapTimes: number[];
  out: OutReason | null;
}

/** How far below the chassis middle `ground` looks for the road or the floor, m (cosmetic). */
const GROUND_REACH = 1;

/** Where the road or the floor is under the machine, world mm, and which way it faces there. */
export interface Ground {
  point: Vector3;
  normal: Vector3;
}

/** Closer than this is touching, m; Rapier also lists contacts it only expects soon. */
const TOUCH = 0.0005;

function touching(manifold: RAPIER.TempContactManifold): boolean {
  for (let i = 0; i < manifold.numContacts(); i++) if (manifold.contactDist(i) < TOUCH) return true;
  return false;
}

export class Run {
  readonly spec: MachineSpec;
  private time = 0;
  private laneIndex: number;
  private along = 0;
  /** How far the machine is from its lane's line, mm. */
  private off = 0;
  /** When the machine went further than `WRONG_LANE_OFF` from its line, s. */
  private offSince: number | null = null;
  private done = 0;
  private laps = 0;
  private lapTimes: number[] = [];
  private best = { distance: 0, time: 0 };
  /** The furthest along the lanes the machine has been, mm. */
  private reach = 0;
  /** Where each lane is a lap on, and where it is timed, mm along it (null: not on that lane). */
  private lapAt: (number | null)[] = [];
  private timeAt: (number | null)[] = [];
  /** When and where along the lanes the lap and the lap time were last taken; the time is null until the timer is first passed. */
  private lastLap = { distance: 0 };
  private lastTime: { time: number | null; distance: number } = { time: 0, distance: 0 };
  /** Two passes of a line closer together than this are one, mm: half the shortest lane. */
  private minLap = 0;
  private out: OutReason | null = null;
  /** Where along its lane the machine set off, mm. */
  private startAt = 0;
  /** Time asked for but not yet run, less than a step, s. */
  private owed = 0;

  private constructor(
    readonly world: RAPIER.World,
    readonly course: SimCourse,
    readonly colliders: CourseColliders,
    readonly machine: Machine,
    lane: number,
  ) {
    this.spec = machine.spec;
    this.laneIndex = lane;
  }

  /**
   * A run in the `lane`-th lane from the left at the start (#27): across
   * from the start line when there is one. Null when the course has no
   * lane to run in.
   */
  static async create(layout: Layout, dir: 1 | -1 = 1, lane = 0, spec = STANDARD_MACHINE): Promise<Run | null> {
    const course = simCourse(layout, dir);
    const line = course.lanes[lane];
    if (!line || line.points.length < 2) return null;
    const world = await createPhysicsWorld();
    world.timestep = STEP;
    const colliders = addCourseColliders(world, course);
    const start = laneStart(layout, line, frontReach(spec) / MM);
    const machine = createMachine(world, spec, start.position.clone().multiplyScalar(MM), start.forward);
    const run = new Run(world, course, colliders, machine, lane);
    run.along = run.startAt = start.along;
    const marks = lapMarks(layout, course.lanes);
    run.lapAt = layout.start ? marks.start : course.lanes.map((l) => laneStart(layout, l).along);
    if (layout.timer) {
      run.timeAt = marks.timer;
      run.lastTime = { time: null, distance: -Infinity };
    } else run.timeAt = run.lapAt;
    run.minLap = Math.min(...course.lanes.map((l) => l.length)) / 2;
    // A step of no time, so that rays (the shadow's) find the course before the first real step.
    world.timestep = 0;
    world.step();
    world.timestep = STEP;
    return run;
  }

  /**
   * Run on for `seconds`, in whole physics steps, keeping what is left
   * over for the next call; stops once the machine is out.
   */
  advance(seconds: number): RunState {
    this.owed += Math.max(0, seconds);
    // A hair of slack so that whole steps asked for are not lost to rounding.
    const steps = Math.floor(this.owed / STEP + 1e-6);
    this.owed -= steps * STEP;
    for (let i = 0; i < steps && !this.out; i++) this.step();
    return this.state();
  }

  private step(): void {
    driveMachine(this.machine, STEP);
    this.world.step();
    this.time += STEP;
    this.follow();
    this.out = this.checkOut();
  }

  /** Keep up with the machine along its lane, going on to the next lane's line at the end of a lap; count the laps and time them. */
  private follow(): void {
    const [lane, along] = [this.laneIndex, this.along];
    this.track();
    const distance = this.distance();
    if (this.passed(this.lapAt, lane, along) && distance > this.lastLap.distance + this.minLap) {
      this.laps++;
      this.lastLap = { distance };
    }
    if (this.passed(this.timeAt, lane, along) && distance > this.lastTime.distance + this.minLap) {
      if (this.lastTime.time !== null) this.lapTimes.push(this.time - this.lastTime.time);
      this.lastTime = { time: this.time, distance };
    }
    this.reach = Math.max(this.reach, distance);
  }

  /** Whether the machine went past a mark since it was `along` lane `lane`. */
  private passed(marks: readonly (number | null)[], lane: number, along: number): boolean {
    const over = (l: number, from: number, to: number) => {
      const m = marks[l];
      return m !== null && m !== undefined && from < m && m <= to;
    };
    if (lane === this.laneIndex) return over(lane, along, this.along);
    // Handed back to the lane before, it went back over nothing.
    if (this.course.lanes[lane].next !== this.course.lanes[this.laneIndex].lane) return false;
    return over(lane, along, Infinity) || over(this.laneIndex, -Infinity, this.along);
  }

  private track(): void {
    const p = this.position();
    const lane = this.course.lanes[this.laneIndex];
    const spot = laneSpot(lane, p, { from: this.along - TRACK_WINDOW, to: this.along + TRACK_WINDOW });
    const next = lane.next === null ? null : this.course.lanes.findIndex((l) => l.lane === lane.next);
    if (next !== null && next >= 0 && spot.along > lane.length - LANE_HANDOVER) {
      const on = laneSpot(this.course.lanes[next], p, { from: 0, to: LANE_HANDOVER });
      if (on.along < LANE_HANDOVER && on.off <= spot.off) {
        this.done += lane.length;
        this.laneIndex = next;
        this.along = on.along;
        this.off = on.off;
        return;
      }
    }
    // Backwards past the start of the line, onto the end of the lane that comes round into it.
    const back = this.course.lanes.findIndex((l) => l.next === lane.lane);
    if (back >= 0 && spot.along < LANE_HANDOVER) {
      const before = this.course.lanes[back];
      const on = laneSpot(before, p, { from: before.length - LANE_HANDOVER, to: before.length });
      if (on.along > before.length - LANE_HANDOVER && on.off < spot.off) {
        this.done -= before.length;
        this.laneIndex = back;
        this.along = on.along;
        this.off = on.off;
        return;
      }
    }
    this.along = spot.along;
    this.off = spot.off;
  }

  private position(): Vector3 {
    const t = this.machine.body.translation();
    return new Vector3(t.x, t.y, t.z).divideScalar(MM);
  }

  private checkOut(): OutReason | null {
    const kinds = this.colliders.kinds;
    let out: OutReason | null = null;
    for (const c of this.machine.colliders) {
      this.world.contactPairsWith(c, (other) => {
        const k = kinds.get(other.handle)?.kind;
        if (k !== 'floor' && k !== 'props') return;
        this.world.contactPair(c, other, (manifold) => {
          if (touching(manifold)) out = k === 'floor' ? 'floor' : 'stopper';
        });
      });
    }
    // Tyres on the floor are off the course too.
    for (let i = 0; i < this.machine.vehicle.numWheels(); i++) {
      const ground = this.machine.vehicle.wheelGroundObject(i);
      if (ground && kinds.get(ground.handle)?.kind === 'floor') out = 'floor';
    }
    if (out) return out;
    const distance = this.distance();
    if (distance < this.reach - REVERSE_DISTANCE) return 'reverse';
    if (this.inOtherLane()) return 'lane';
    if (distance > this.best.distance + STALL_DISTANCE) this.best = { distance, time: this.time };
    if (this.time - this.best.time <= STALL_TIME) return null;
    // Stopped upside down, or stopped any other way: on a fence, caught, out of push.
    return this.up().y < 0 ? 'flipped' : 'stopped';
  }

  /**
   * Whether the machine has run on in another lane for `WRONG_LANE_TIME`.
   * The other lanes are only looked at once it has been off its own line
   * that long, so a run on its line costs nothing more; off the line but
   * near no other lane's (in the air), it starts counting again.
   */
  private inOtherLane(): boolean {
    if (this.off <= WRONG_LANE_OFF) {
      this.offSince = null;
      return false;
    }
    this.offSince ??= this.time;
    if (this.time - this.offSince < WRONG_LANE_TIME) return false;
    const p = this.position();
    if (this.course.lanes.some((l, i) => i !== this.laneIndex && laneSpot(l, p).off < this.off)) return true;
    this.offSince = this.time;
    return false;
  }

  /** The machine's up, as a world direction. */
  private up(): Vector3 {
    const r = this.machine.body.rotation();
    return new Vector3(0, 1, 0).applyQuaternion(new Quaternion(r.x, r.y, r.z, r.w));
  }

  private distance(): number {
    return this.done + this.along - this.startAt;
  }

  /** The road, a fence or the floor straight below the chassis middle (for its shadow, #99); null over nothing. */
  ground(): Ground | null {
    const t = this.machine.body.translation();
    const ray = new RAPIER.Ray(t, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRayAndGetNormal(ray, GROUND_REACH, true, undefined, undefined, undefined, this.machine.body);
    if (!hit) return null;
    const n = hit.normal;
    return {
      point: new Vector3(t.x, t.y - hit.timeOfImpact, t.z).divideScalar(MM),
      normal: new Vector3(n.x, n.y, n.z).normalize(),
    };
  }

  state(): RunState {
    const r = this.machine.body.rotation();
    return {
      time: this.time,
      speed: this.machine.vehicle.currentVehicleSpeed(),
      position: this.position(),
      quaternion: new Quaternion(r.x, r.y, r.z, r.w),
      distance: this.distance(),
      laps: this.laps,
      lapTimes: [...this.lapTimes],
      out: this.out,
    };
  }

  free(): void {
    this.world.free();
  }
}
