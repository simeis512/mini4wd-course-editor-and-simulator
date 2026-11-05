import { Vector3 } from 'three';
import { MM } from '../course/mesh';
import { ROAD_FRICTION, tapeFrictionAt, WALL_FRICTION, type TapeZone } from '../course/tape-zones';
import type { Machine } from './machine';

// The joint tape under the tyres and against the rollers (#133, owner
// 2026-10-31): on a floor strip the tyres grip by the tape's friction over
// the road's; by a wall strip's inner face the rollers' drag along the
// fence goes up by the tape's friction over the fence's.

/** How far from where a tyre touches the road the floor tape is looked for, mm: the contact point is a ray's, not the tyre's patch (provisional). */
const FLOOR_REACH = 1;
/** How much further than its radius from a roller's middle the wall tape is looked for, mm: the fence gives a little (provisional). */
const WALL_REACH = 0.5;

const at = new Vector3();

/** Set the tyres' grip and the rollers' drag for where the machine is now; with no tape this does nothing. */
export function touchTape(m: Machine, zones: readonly TapeZone[]): void {
  if (!zones.length) return;
  const { vehicle, spec } = m;
  for (let i = 0; i < vehicle.numWheels(); i++) {
    const c = vehicle.wheelIsInContact(i) ? vehicle.wheelContactPoint(i) : null;
    const tape = c ? tapeFrictionAt(zones, 'floor', at.set(c.x, c.y, c.z).divideScalar(MM), FLOOR_REACH) : null;
    const grip = spec.grip * (tape === null ? 1 : tape / ROAD_FRICTION);
    if (Math.abs((vehicle.wheelFrictionSlip(i) ?? 0) - grip) > 1e-6) vehicle.setWheelFrictionSlip(i, grip);
  }
  // The chassis box first, then the rollers in the spec's order.
  spec.rollers.forEach((r, k) => {
    const collider = m.colliders[k + 1];
    const t = collider.translation();
    const tape = tapeFrictionAt(zones, 'wall', at.set(t.x, t.y, t.z).divideScalar(MM), r.radius / MM + WALL_REACH);
    const drag = spec.rollerFriction * (tape === null ? 1 : tape / WALL_FRICTION);
    if (Math.abs(collider.friction() - drag) > 1e-6) collider.setFriction(drag);
  });
}
