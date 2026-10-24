import RAPIER from '@dimforge/rapier3d-compat';
import { describe, expect, it } from 'vitest';
import { layoutCourse } from '../course/course';
import { chain } from '../course/presets';
import { simCourse } from '../course/sim-course';
import { addCourseColliders } from './course-colliders';
import { createPhysicsWorld } from './world';

/** A ball of radius `r` m dropped at (x, y, z) m, stepped for `seconds`. */
function drop(world: RAPIER.World, [x, y, z]: [number, number, number], r: number, vx = 0, seconds = 1): RAPIER.RigidBody {
  const ball = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinvel(vx, 0, 0));
  world.createCollider(RAPIER.ColliderDesc.ball(r), ball);
  for (let t = 0; t < seconds * 60; t++) world.step();
  return ball;
}

describe('addCourseColliders (spec 9, #26)', () => {
  it('lets a ball come to rest on the road, in metres', async () => {
    const world = await createPhysicsWorld();
    addCourseColliders(world, simCourse(layoutCourse(chain(['straight']))));
    const ball = drop(world, [0, 0.1, 0.27], 0.01);
    expect(ball.translation().y).toBeCloseTo(0.01, 2);
  });

  it('stops a ball rolled sideways at the lane divider', async () => {
    const world = await createPhysicsWorld();
    addCourseColliders(world, simCourse(layoutCourse(chain(['straight']))));
    // In the middle lane, rolled towards + X (its left); the divider is at x = 60mm.
    const ball = drop(world, [0, 0.02, 0.27], 0.01, 1);
    // Its face is 57.5mm out; the ball is 10mm round.
    expect(ball.translation().x).toBeLessThan(0.0476);
    expect(ball.translation().y).toBeGreaterThan(0);
  });

  it('reports a ball that drops past an open end in that fall zone', async () => {
    const world = await createPhysicsWorld();
    const { kinds } = addCourseColliders(world, simCourse(layoutCourse(chain(['straight']))));
    const ball = drop(world, [0, 0.05, 0.6], 0.01, 0, 0.1);
    const hits: number[] = [];
    world.intersectionPairsWith(ball.collider(0), (other) => {
      hits.push(other.handle);
    });
    expect(hits.map((h) => kinds.get(h)?.kind)).toEqual(['fall']);
    expect(kinds.get(hits[0])?.zone?.at).toEqual({ piece: 0, port: 1 });
  });
});
