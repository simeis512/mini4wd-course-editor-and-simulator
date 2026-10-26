// Shared bits for the Rapier feasibility experiments (research only, not
// part of the app). SI units: m, kg, s, N.
import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };

export const STEP = 1 / 1000;

/** An empty world set up as the simulator sets it up (src/physics/world.ts, run.ts). */
export async function lab(gravity = -9.81): Promise<RAPIER.World> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: gravity, z: 0 });
  world.lengthUnit = 0.01;
  world.timestep = STEP;
  return world;
}

/** A fixed box: centre and half sizes, m. */
export function block(world: RAPIER.World, at: [number, number, number], half: [number, number, number], friction = 0.5, restitution = 0): RAPIER.Collider {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...at));
  return world.createCollider(RAPIER.ColliderDesc.cuboid(...half).setFriction(friction).setRestitution(restitution), body);
}

/** Total force between two colliders during the last step (sum of normal and friction impulses / dt), world N. */
export function pairForce(world: RAPIER.World, a: RAPIER.Collider, b: RAPIER.Collider): { normal: number; n: RAPIER.Vector } {
  let normal = 0;
  let n = { x: 0, y: 0, z: 0 };
  world.contactPair(a, b, (m, flipped) => {
    for (let i = 0; i < m.numContacts(); i++) normal += m.contactImpulse(i);
    const v = m.normal();
    const s = flipped ? -1 : 1;
    n = { x: v.x * s, y: v.y * s, z: v.z * s };
  });
  return { normal: normal / world.timestep, n };
}

export const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
export const deg = (d: number) => (d * Math.PI) / 180;
