import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import type { Layout } from '../course/course';
import { MM } from '../course/mesh';
import { laneSpot, laneStart, simCourse, type SimCourse } from '../course/sim-course';
import { addCourseColliders, type CourseColliders } from './course-colliders';
import { createMachine, driveMachine, type Machine } from './machine';
import { STANDARD_MACHINE, type MachineSpec } from './machine-spec';
import { createPhysicsWorld } from './world';

// One machine running round a course (#27, spec simulator.md): a fixed
// 1 ms physics step, and the ways a run comes to an end (spec 5).

/** Physics step, s (spec simulator.md 4, provisional). */
export const STEP = 1 / 1000;
/** A machine that gets less than this far along its lane in `STALL_TIME` has stopped (spec simulator.md 5, provisional), mm. */
export const STALL_DISTANCE = 50;
export const STALL_TIME = 2;
/** How near the end of one lane's line a machine must be to go on to the next lane's, mm. */
const LANE_HANDOVER = 100;

/** Why a run came to an end (spec simulator.md 5). */
export type OutReason = 'floor' | 'fall' | 'stopper' | 'stopped';

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
  /** Times past the start of the lane line it started on. */
  laps: number;
  out: OutReason | null;
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
  private done = 0;
  private laps = 0;
  private best = { distance: 0, time: 0 };
  private out: OutReason | null = null;
  /** Where along its lane the machine set off, mm. */
  private startAt = 0;

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
    const start = laneStart(layout, line);
    const machine = createMachine(world, spec, start.position.clone().multiplyScalar(MM), start.forward);
    const run = new Run(world, course, colliders, machine, lane);
    run.along = run.startAt = start.along;
    return run;
  }

  /** Run on for `seconds`, in whole physics steps; stops once the machine is out. */
  advance(seconds: number): RunState {
    const steps = Math.max(0, Math.round(seconds / STEP));
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

  /** Keep up with the machine along its lane, going on to the next lane's line at the end of a lap. */
  private follow(): void {
    const p = this.position();
    const lane = this.course.lanes[this.laneIndex];
    const spot = laneSpot(lane, p);
    const next = lane.next === null ? null : this.course.lanes.findIndex((l) => l.lane === lane.next);
    if (next !== null && next >= 0 && spot.along > lane.length - LANE_HANDOVER) {
      const on = laneSpot(this.course.lanes[next], p);
      if (on.along < LANE_HANDOVER && on.off <= spot.off) {
        this.done += lane.length;
        this.laps++;
        this.laneIndex = next;
        this.along = on.along;
        return;
      }
    }
    this.along = spot.along;
  }

  private position(): Vector3 {
    const t = this.machine.body.translation();
    return new Vector3(t.x, t.y, t.z).divideScalar(MM);
  }

  private checkOut(): OutReason | null {
    const kinds = this.colliders.kinds;
    let out: OutReason | null = null;
    for (const c of this.machine.colliders) {
      this.world.intersectionPairsWith(c, (other) => {
        const k = kinds.get(other.handle);
        if (k?.kind === 'fall' && !k.zone?.intended) out = 'fall';
      });
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
    if (distance > this.best.distance + STALL_DISTANCE) this.best = { distance, time: this.time };
    return this.time - this.best.time > STALL_TIME ? 'stopped' : null;
  }

  private distance(): number {
    return this.done + this.along - this.startAt;
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
      out: this.out,
    };
  }

  free(): void {
    this.world.free();
  }
}
