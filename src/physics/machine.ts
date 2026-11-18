import RAPIER from '@dimforge/rapier3d-compat';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { driveForce, rideHeight, TYRE_GIVE, wheelPoints, type MachineSpec } from './machine-spec';

// A machine in the physics world (#27, spec simulator.md 2): the chassis
// as one rigid body, the tyres as Rapier's ray-cast wheels driven by the
// motor, and the rollers as balls on the chassis. Machine axes are the
// parts' axes: + X left, + Y up, + Z forward.

/**
 * Spring and damping of that give, per kg of machine (Rapier scales them by
 * the chassis mass): stiff enough to hold the machine within half a
 * millimetre (spec simulator.md 2, provisional).
 */
const TYRE_STIFFNESS = 8000;
const TYRE_DAMPING = 150;
/**
 * How hard the tyres hold against sliding sideways, as Rapier's side
 * friction stiffness: low enough that the rollers can turn the machine
 * round the fences, as the tyres let them on a real course (no steering;
 * spec simulator.md 2, provisional, tuned so the standard machine laps the
 * basic oval).
 */
const TYRE_SIDE_GRIP = 0.3;
/** Friction of the chassis box where it scrapes the road or a fence (#29, provisional). */
const CHASSIS_FRICTION = 0.3;
/** Thickness of a brake pad's collider, m (its underside is what touches). */
const BRAKE_THICKNESS = 0.002;
/** Radius of the balls that carry a weight's mass, m: they touch nothing, so any small size. */
const MASS_BALL = 0.002;

/** A mass damper riding its shaft (#32): its own body on a slider joint to the chassis. */
export interface MovingDamper {
  body: RAPIER.RigidBody;
  /** Where the bottom of its travel is on the chassis, m (chassis axes). */
  rest: [number, number, number];
}

export interface Machine {
  spec: MachineSpec;
  body: RAPIER.RigidBody;
  vehicle: RAPIER.DynamicRayCastVehicleController;
  /** The colliders that touch the course: chassis, rollers and brakes. */
  colliders: RAPIER.Collider[];
  /** The dampers that ride their shafts, in the order of `spec.dampers` with a stroke. */
  dampers: MovingDamper[];
  /** Every collider of the machine, the ones carrying mass only too. */
  own: Set<number>;
}

/** A collider that only carries mass: a sensor in no collision group. */
function massOnly(mass: number): RAPIER.ColliderDesc {
  return RAPIER.ColliderDesc.ball(MASS_BALL).setMass(mass).setSensor(true).setCollisionGroups(0);
}

/**
 * Put a machine on the road at `position` (m, on the road surface) facing
 * `forward` along the road whose up is `up`.
 */
export function createMachine(world: RAPIER.World, spec: MachineSpec, position: Vector3, forward: Vector3, up = new Vector3(0, 1, 0)): Machine {
  const z = forward.clone().normalize();
  const x = up.clone().cross(z).normalize();
  const y = z.clone().cross(x);
  const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
  const at = position.clone().addScaledVector(y, rideHeight(spec));
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(at.x, at.y, at.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      // Fast enough to pass through the road in one step on landing without it (spec simulator.md 4).
      .setCcdEnabled(true),
  );
  const [w, h, l] = spec.size;
  const colliders = [
    world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, l / 2).setMass(spec.mass).setFriction(CHASSIS_FRICTION), body),
    // Balls, not cylinders: a cylinder running along a trimesh fence catches on its
    // triangles and loses most of its speed, where a ball slides on. Only the
    // roller's radius matters against the upright fences.
    ...spec.rollers.map((r) =>
      world.createCollider(
        RAPIER.ColliderDesc.ball(r.radius)
          .setTranslation(r.at[0], r.at[1] - rideHeight(spec), r.at[2])
          .setMass(0)
          .setFriction(spec.rollerFriction)
          // The fences' own friction must not add to it.
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
          .setRestitution(r.restitution ?? spec.rollerRestitution),
        body,
      ),
    ),
    // Brake pads: they touch only where the machine dips or the road bends up under them (#32).
    ...(spec.brakes ?? []).map((b) =>
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(b.size[0] / 2, BRAKE_THICKNESS / 2, b.size[1] / 2)
          .setTranslation(b.at[0], b.at[1] + BRAKE_THICKNESS / 2 - rideHeight(spec), b.at[2])
          .setMass(0)
          .setFriction(b.friction)
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
          .setRestitution(0),
        body,
      ),
    ),
  ];
  const own = new Set(colliders.map((c) => c.handle));
  const fixed = [...(spec.weights ?? []), ...(spec.dampers ?? []).filter((d) => d.stroke <= 0)];
  for (const f of fixed) {
    own.add(world.createCollider(massOnly(f.mass).setTranslation(f.at[0], f.at[1] - rideHeight(spec), f.at[2]), body).handle);
  }
  const dampers = (spec.dampers ?? []).filter((d) => d.stroke > 0).map((d) => {
    const rest: [number, number, number] = [d.at[0], d.at[1] - rideHeight(spec), d.at[2]];
    const p = new Vector3(...rest).applyQuaternion(q).add(at);
    const weight = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    );
    own.add(world.createCollider(massOnly(d.mass), weight).handle);
    // Up and down the chassis' Y, from the bottom of its travel by the stroke (#125: a prismatic joint holds it).
    const params = RAPIER.JointData.prismatic({ x: rest[0], y: rest[1], z: rest[2] }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    params.limitsEnabled = true;
    params.limits = [0, d.stroke];
    world.createImpulseJoint(params, body, weight, true).setContactsEnabled(false);
    return { body: weight, rest };
  });
  const vehicle = world.createVehicleController(body);
  vehicle.indexUpAxis = 1;
  vehicle.setIndexForwardAxis = 2;
  for (const [px, py, pz] of wheelPoints(spec)) {
    vehicle.addWheel({ x: px, y: py, z: pz }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, 2 * TYRE_GIVE, spec.tyreRadius);
  }
  for (let i = 0; i < vehicle.numWheels(); i++) {
    vehicle.setWheelSuspensionStiffness(i, TYRE_STIFFNESS);
    vehicle.setWheelSuspensionCompression(i, TYRE_DAMPING);
    vehicle.setWheelSuspensionRelaxation(i, TYRE_DAMPING);
    vehicle.setWheelMaxSuspensionTravel(i, 2 * TYRE_GIVE);
    vehicle.setWheelFrictionSlip(i, spec.grip);
    vehicle.setWheelSideFrictionStiffness(i, TYRE_SIDE_GRIP);
  }
  return { spec, body, vehicle, colliders, dampers, own };
}

/** Drive the tyres for one step (4WD: the motor turns all four), then let the wheels push the chassis. */
export function driveMachine(m: Machine, dt: number, on = true): void {
  const speed = m.vehicle.currentVehicleSpeed();
  const force = on ? driveForce(m.spec, speed) / m.vehicle.numWheels() : 0;
  for (let i = 0; i < m.vehicle.numWheels(); i++) m.vehicle.setWheelEngineForce(i, force);
  m.vehicle.updateVehicle(dt, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, (c) => !m.own.has(c.handle));
}

/** How far each riding damper is up its shaft from the bottom of its travel, m. */
export function damperLifts(m: Machine): number[] {
  const r = m.body.rotation();
  const q = new Quaternion(r.x, r.y, r.z, r.w);
  const t = m.body.translation();
  const up = new Vector3(0, 1, 0).applyQuaternion(q);
  return m.dampers.map((d) => {
    const rest = new Vector3(...d.rest).applyQuaternion(q).add(new Vector3(t.x, t.y, t.z));
    const p = d.body.translation();
    return new Vector3(p.x, p.y, p.z).sub(rest).dot(up);
  });
}
