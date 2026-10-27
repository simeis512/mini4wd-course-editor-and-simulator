// A. Fast machines and the 1 ms step: does a roller thrown at a fence pass
// through it? A 13 mm ball carrying the machine's 130 g (the part that
// meets the fences) shot from the middle of the middle lane at the divider
// of a straight piece's real trimesh (a 5 mm wall), at speeds up to 30 m/s,
// with and without CCD. (The whole machine is 105 mm wide in a ~115 mm
// lane, so it cannot be turned to face a fence without already touching it.)
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { layoutCourse } from '../../src/course/course';
import { chain } from '../../src/course/presets';
import { MM } from '../../src/course/mesh';
import { simCourse } from '../../src/course/sim-course';
import { addCourseColliders } from '../../src/physics/course-colliders';
import { lab, RAPIER } from './lab';

async function shoot(speed: number, angleDeg: number, ccd: boolean, step = 1e-3) {
  const world = await lab();
  world.timestep = step;
  const course = simCourse(layoutCourse(chain(Array(6).fill('straight'))), 1);
  addCourseColliders(world, course);
  const mid = course.lanes[1].points[0];
  // The first fence on the way: the divider between the middle lane and the next, its far face.
  const xs = [...course.fences.vertices.filter((_, i) => i % 3 === 0)].filter((x) => x > mid.x);
  const near = Math.min(...xs);
  const fenceOut = Math.max(...xs.filter((x) => x < near + 20)) * MM;
  void Vector3;
  const a = (angleDeg * Math.PI) / 180;
  const dir = new Vector3(Math.sin(a), 0, Math.cos(a));
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(mid.x * MM, mid.y * MM + 0.012, (mid.z + 400) * MM).setCcdEnabled(ccd).setGravityScale(0),
  );
  world.createCollider(RAPIER.ColliderDesc.ball(0.0065).setMass(0.13).setRestitution(0.2), body);
  body.setLinvel({ x: dir.x * speed, y: 0, z: dir.z * speed }, true);
  let through = false;
  let reach = -Infinity;
  for (let i = 0; i < Math.round(0.3 / step); i++) {
    world.step();
    reach = Math.max(reach, body.translation().x);
    if (body.translation().x > fenceOut) through = true;
  }
  world.free();
  if (process.env.DEBUG_TUNNEL) console.log({ speed, angleDeg, ccd, near, fenceOut: fenceOut / MM, reach: reach / MM, start: mid.x });
  return through;
}

describe('tunnelling', () => {
  it('finds the speeds at which the machine goes through the fence', async () => {
    const rows: string[] = [];
    for (const ccd of [true, false]) {
      for (const angle of [10, 45, 90]) {
        const res: string[] = [];
        for (const v of [3, 5, 10, 15, 20, 30]) res.push(`${v}m/s ${(await shoot(v, angle, ccd)) ? 'THROUGH' : 'held'}`);
        rows.push(`CCD ${ccd ? 'on ' : 'off'} ${String(angle).padStart(2)}° into the fence: ${res.join(', ')}`);
      }
    }
    console.log(rows.join('\n'));
    expect(await shoot(30, 90, true)).toBe(false);
  }, 120000);
});
