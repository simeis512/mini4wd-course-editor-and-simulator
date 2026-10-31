// The roller's grip on the fence as one model (#125, 2026-10-31): a roller
// turns freely in its rolling direction, so the fence's friction only acts
// on its slip across that, along the roller's axis (mostly up and down).
// That one friction gives both the hold-down of a thrust angle (the
// rolling direction is tilted, so the roller always slips a little) and
// the resistance to sliding up a fence (it slips up).
//
//   slip angle β = atan(axial slip / rolling speed)
//   F = μ_ax · N · min(1, β / θ₀), against the axial slip
//   plus rolling drag c_rr · N against the rolling direction
//
// μ_ax: friction across the rolling direction, with what an edge biting
// into the fence adds; θ₀: how small a slip angle reaches full grip (a
// sharp narrow edge bites sooner); c_rr: rolling drag from biting in.
import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';

export interface RollerGrip {
  name: string;
  muAx: number;
  theta0Deg: number;
  rollingDrag: number;
}

/** Provisional pair for the racers' belief: a narrow edged aluminium roller and a wide bearing roller. */
export const NARROW_EDGE: RollerGrip = { name: 'narrow edge (1 mm)', muAx: 0.5, theta0Deg: 1, rollingDrag: 0.02 };
export const WIDE_FLAT: RollerGrip = { name: 'wide flat (3 mm)', muAx: 0.2, theta0Deg: 3, rollingDrag: 0.01 };

const v3 = (v: { x: number; y: number; z: number }) => new Vector3(v.x, v.y, v.z);

/**
 * The fence's grip on one roller as a world force at its contact point.
 * `push` is the fence's push on the roller, N; `normal` its direction
 * (any sign: it is turned to point from the fence into the machine).
 */
export function rollerGripForce(
  body: RAPIER.RigidBody,
  roller: RAPIER.Collider,
  radius: number,
  thrustDeg: number,
  push: number,
  normal: Vector3,
  grip: RollerGrip,
  dt = 0,
): { force: Vector3; at: Vector3 } | null {
  if (push <= 0 || normal.lengthSq() === 0) return null;
  const r = body.rotation();
  const q = new Quaternion(r.x, r.y, r.z, r.w);
  const p = v3(roller.translation());
  const n = normal.clone().normalize();
  if (n.dot(v3(body.translation()).sub(p)) < 0) n.negate();
  // The roller's axis: the machine's up leant forward by the thrust angle (+ = top forward).
  const t = (thrustDeg * Math.PI) / 180;
  const axis = new Vector3(0, Math.cos(t), Math.sin(t)).applyQuaternion(q);
  const at = p.clone().addScaledVector(n, -radius);
  const v = v3(body.velocityAtPoint(at));
  const vt = v.clone().addScaledVector(n, -v.dot(n));
  const roll = axis.clone().cross(n);
  if (roll.lengthSq() < 1e-12) return null;
  roll.normalize();
  const along = vt.dot(roll);
  const slip = vt.clone().addScaledVector(roll, -along);
  const force = new Vector3();
  const s = slip.length();
  if (s > 1e-9) {
    const beta = Math.atan2(s, Math.abs(along));
    let f = grip.muAx * push * Math.min(1, beta / ((grip.theta0Deg * Math.PI) / 180));
    // Added outside the solver, a stiff grip overshoots: never more than
    // stops the slip in one step (taking a quarter of the machine as what
    // the roller moves).
    if (dt > 0) f = Math.min(f, (body.mass() / 4) * (s / dt));
    force.addScaledVector(slip, -f / s);
  }
  if (Math.abs(along) > 1e-6) force.addScaledVector(roll, -Math.sign(along) * grip.rollingDrag * push);
  return { force, at };
}
