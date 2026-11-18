// The machine the simulator runs (#27, spec simulator.md 2-3): one rigid
// body for the chassis and body, four ray-cast tyres and four rollers.
// SI units (m, kg, s) like the physics world.

export interface MotorSpec {
  /** Turns per minute with no load at the battery's voltage. */
  freeRpm: number;
  /** Torque held still, N·m. */
  stallTorque: number;
}

export interface RollerSpec {
  /** Centre from the middle of the chassis: x to the left, y up from the road, z forward, m. */
  at: [number, number, number];
  radius: number;
  height: number;
  /** Its own friction and bounce on the fences, else the machine's (#32). */
  friction?: number;
  restitution?: number;
}

/**
 * A mass damper (#32): a weight that rides up its shaft from `at` by as
 * much as `stroke`, or with no stroke stays put. Its mass is on top of the
 * chassis box's.
 */
export interface DamperSpec {
  mass: number;
  /** Middle of the weight at the bottom of its travel, as for rollers, m. */
  at: [number, number, number];
  stroke: number;
  /** Its shape, m (for drawing; it touches nothing): a cylinder on its shaft, or a bar lying front to back. */
  shape: { kind: 'cylinder'; radius: number; height: number } | { kind: 'bar'; size: [number, number, number] };
}

/** The rear tyres, when they differ from the front ones (#32, owner 2026-11-19). */
export interface TyreSpec {
  radius: number;
  width: number;
  grip: number;
}

/** A brake pad under the chassis (#32): `at` is the middle of its underside, as for rollers; width and length, m. */
export interface BrakeSpec {
  at: [number, number, number];
  size: [number, number];
  friction: number;
}

/** A weight fixed to the chassis, on top of the chassis box's mass (#32). */
export interface WeightSpec {
  mass: number;
  at: [number, number, number];
}

export interface MachineSpec {
  /** The chassis box's mass: the whole machine less its dampers and weights, kg. */
  mass: number;
  /** Chassis box (the body's collider): width, height, length, m. */
  size: [number, number, number];
  /** Underside of the chassis above the road, m. */
  clearance: number;
  tyreRadius: number;
  /** Tyre width, for drawing, m. */
  tyreWidth: number;
  /** Front and rear axles from the middle, m. */
  wheelbase: number;
  /** Centre of the left tyres to the right ones, m. */
  tread: number;
  /** Rear tyres' tread when it differs from the front's, m. */
  rearTread?: number;
  /** Motor turns per tyre turn. */
  gearRatio: number;
  /** Share of the motor's torque that reaches the tyres. */
  efficiency: number;
  motor: MotorSpec;
  rollers: RollerSpec[];
  /** Tyre grip on the road: the most the tyres push along the road per newton they press on it. */
  grip: number;
  /**
   * Friction of the rollers on the fences. They turn on bearings, so along
   * the fence they hold back next to nothing; the colliders do not turn, so
   * this stands in for the bearings' drag (#29).
   */
  rollerFriction: number;
  rollerRestitution: number;
  rearTyre?: TyreSpec;
  dampers?: DamperSpec[];
  brakes?: BrakeSpec[];
  weights?: WeightSpec[];
}

/** Motor torque at a speed (spec simulator.md 3): straight from the stall torque down to nothing at the free speed, N·m. */
export function motorTorque(motor: MotorSpec, rpm: number): number {
  const t = motor.stallTorque * (1 - rpm / motor.freeRpm);
  return Math.max(0, Math.min(motor.stallTorque, t));
}

/**
 * The push of all four tyres on the road at a forward speed, N (4WD: one
 * motor turns them all), as if all had this radius (the front's unless
 * given): with smaller tyres at one end, those turn faster at the speed.
 */
export function driveForce(spec: MachineSpec, speed: number, radius = spec.tyreRadius): number {
  const wheelRpm = (Math.abs(speed) / radius) * (60 / (2 * Math.PI));
  return (motorTorque(spec.motor, wheelRpm * spec.gearRatio) * spec.gearRatio * spec.efficiency) / radius;
}

/** The tyre of each wheel in `wheelPoints`' order: the front ones, then the rear ones. */
export function wheelTyres(spec: MachineSpec): TyreSpec[] {
  const front = { radius: spec.tyreRadius, width: spec.tyreWidth, grip: spec.grip };
  const rear = spec.rearTyre ?? front;
  return [front, front, rear, rear];
}

/** Top speed on the level with nothing holding it back, m/s. */
export function freeSpeed(spec: MachineSpec): number {
  return ((spec.motor.freeRpm / spec.gearRatio) * 2 * Math.PI * spec.tyreRadius) / 60;
}

/** How far the front of the machine reaches ahead of the chassis middle: the chassis, a front roller or a front tyre, m. */
export function frontReach(spec: MachineSpec): number {
  return Math.max(spec.size[2] / 2, spec.wheelbase / 2 + spec.tyreRadius, -spec.wheelbase / 2 + (spec.rearTyre?.radius ?? 0), ...spec.rollers.map((r) => r.at[2] + r.radius));
}

/**
 * How far a tyre gives, m: Mini 4WD tyres have no springs, only a little
 * give. The wheels' rays reach this far below the road at rest, so the
 * tyres hold the road (spec simulator.md 2, provisional).
 */
export const TYRE_GIVE = 0.001;
/** Height of the chassis box's middle above the road at rest, m. */
export function rideHeight(spec: MachineSpec): number {
  return spec.clearance + spec.size[1] / 2;
}

/** Wheel positions on the chassis: front left, front right, rear left, rear right, at the axles' rest, m. */
export function wheelPoints(spec: MachineSpec): [number, number, number][] {
  const x = spec.tread / 2;
  const xr = (spec.rearTread ?? spec.tread) / 2;
  const z = spec.wheelbase / 2;
  // The ray starts above the axle by the give and reaches as far below the road.
  const [yf, , yr] = wheelTyres(spec).map((t) => t.radius + TYRE_GIVE - rideHeight(spec));
  return [
    [x, yf, z],
    [-x, yf, z],
    [xr, yr, -z],
    [-xr, yr, -z],
  ];
}
