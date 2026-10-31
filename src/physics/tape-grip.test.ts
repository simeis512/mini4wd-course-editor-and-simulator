import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { GLOBAL_SPEC } from '../course/catalog';
import { layoutCourse, type Layout } from '../course/course';
import { pointOnFrame } from '../course/geometry';
import { MM } from '../course/mesh';
import { basicOval, chain } from '../course/presets';
import { simCourse } from '../course/sim-course';
import { setTape, type JointTape } from '../course/tape';
import { ROAD_FRICTION, tapeZones, WALL_FRICTION } from '../course/tape-zones';
import { addCourseColliders } from './course-colliders';
import { createMachine, driveMachine, type Machine } from './machine';
import { STANDARD_MACHINE } from './machine-spec';
import { Run, STEP } from './run';
import { touchTape } from './tape-grip';
import { createPhysicsWorld } from './world';

const spec = STANDARD_MACHINE;
const floor = { kind: 'cloth', width: 50, friction: 0.6 * ROAD_FRICTION } as const;
const wall = { kind: 'cloth', width: 50, friction: 2 * WALL_FRICTION, face: 'inner' } as const;
const straights = (tape?: JointTape) => layoutCourse(setTape(chain(Array(4).fill('straight')), tape));

/**
 * A machine on the road `right` mm across from the middle, its middle
 * `behind` mm before the joint of pieces 0 and 1, going from 0 to 1; the
 * wheels already looked at the road.
 */
async function machineAt(layout: Layout, right: number, behind: number): Promise<Machine> {
  const world = await createPhysicsWorld();
  addCourseColliders(world, simCourse(layout));
  const pc = layout.pieces[1];
  const port = pc.matrix.clone().multiply(pc.geometry.ports[0]);
  // The port faces back into piece 0.
  const back = new Vector3(0, 0, 1).transformDirection(port);
  const at = pointOnFrame(port, right, 0).addScaledVector(back, behind).multiplyScalar(MM);
  const m = createMachine(world, spec, at, back.clone().negate());
  // A step of no time, so that the wheels' rays find the road.
  world.timestep = 0;
  world.step();
  driveMachine(m, STEP, false);
  return m;
}

describe('joint tape under the tyres and against the rollers (#133)', () => {
  it('grips by the floor tape over the road where a tyre is on the strip', async () => {
    const layout = straights({ floor });
    // Front axle on the joint, rear axle well behind it.
    const m = await machineAt(layout, GLOBAL_SPEC.lanePitch, (spec.wheelbase / 2) / MM);
    touchTape(m, tapeZones(layout));
    // Front left, front right, rear left, rear right.
    const slips = [0, 1, 2, 3].map((i) => m.vehicle.wheelFrictionSlip(i)!);
    for (const i of [0, 1]) expect(slips[i]).toBeCloseTo(spec.grip * 0.6);
    for (const i of [2, 3]) expect(slips[i]).toBeCloseTo(spec.grip);
  });

  it('drags the rollers by the wall tape over the fence where one is by a strip, and only there', async () => {
    const layout = straights({ wall });
    const face = 1.5 * GLOBAL_SPEC.lanePitch - GLOBAL_SPEC.fenceThickness / 2;
    const [r] = spec.rollers;
    // Pushed out against an outer wall, the rear rollers by the joint.
    const across = face - (r.at[0] + r.radius) / MM;
    const m = await machineAt(layout, across, -0.07 / MM);
    touchTape(m, tapeZones(layout));
    const drags = spec.rollers.map((_, k) => m.colliders[k + 1].friction());
    const taped = drags.filter((d) => Math.abs(d - 2 * spec.rollerFriction) < 1e-6);
    // One rear roller is by the wall; the others are off the tape or away from the wall.
    expect(taped).toHaveLength(1);
    expect(drags.filter((d) => Math.abs(d - spec.rollerFriction) < 1e-6)).toHaveLength(3);
    // Untaped, nothing changes.
    const bare = await machineAt(straights(), across, -0.07 / MM);
    touchTape(bare, tapeZones(straights()));
    for (const k of [1, 2, 3, 4]) expect(bare.colliders[k].friction()).toBeCloseTo(spec.rollerFriction);
  });

  it('runs a taped course: slippery floor tape costs a little way', async () => {
    const run = async (tape?: JointTape) => {
      const r = (await Run.create(layoutCourse(setTape(chain(Array(12).fill('straight')), tape))))!;
      const s = r.advance(1.2);
      r.free();
      return s;
    };
    const bare = await run();
    const slippery = await run({ floor: { kind: 'opp', width: 100, friction: 0 } });
    expect(slippery.out).toBeNull();
    expect(slippery.distance).toBeLessThan(bare.distance - 1);
    expect(slippery.distance).toBeGreaterThan(0.5 * bare.distance);
  });

  it('runs the basic oval: rough wall tape holds the rollers back where they meet it', async () => {
    const lap = async (tape?: JointTape) => {
      const r = (await Run.create(layoutCourse(setTape(basicOval(), tape))))!;
      const s = r.advance(8);
      r.free();
      return s;
    };
    const bare = await lap();
    const rough = await lap({ wall: { kind: 'cloth', width: 100, friction: 2, face: 'inner' } });
    expect(rough.out).toBeNull();
    expect(rough.distance).toBeLessThan(bare.distance - 50);
  }, 30000);
});
