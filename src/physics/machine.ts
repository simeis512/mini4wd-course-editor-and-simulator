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

export interface Machine {
  spec: MachineSpec;
  body: RAPIER.RigidBody;
  vehicle: RAPIER.DynamicRayCastVehicleController;
  /** The chassis and roller colliders. */
  colliders: RAPIER.Collider[];
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
          .setRestitution(spec.rollerRestitution),
        body,
      ),
    ),
  ];
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
  return { spec, body, vehicle, colliders };
}

/** Drive the tyres for one step (4WD: the motor turns all four), then let the wheels push the chassis. */
export function driveMachine(m: Machine, dt: number, on = true): void {
  const speed = m.vehicle.currentVehicleSpeed();
  const force = on ? driveForce(m.spec, speed) / m.vehicle.numWheels() : 0;
  for (let i = 0; i < m.vehicle.numWheels(); i++) m.vehicle.setWheelEngineForce(i, force);
  const own = new Set(m.colliders.map((c) => c.handle));
  m.vehicle.updateVehicle(dt, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, (c) => !own.has(c.handle));
}
