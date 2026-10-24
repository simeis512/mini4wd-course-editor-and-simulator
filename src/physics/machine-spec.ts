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
}

export interface MachineSpec {
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
}

/** 13mm rollers, 105mm across over them (the regulation width), 12mm up: as on the kits (#30, provisional). */
const ROLLER = { radius: 0.0065, height: 0.006 };
const ROLLER_X = 0.105 / 2 - ROLLER.radius;
const ROLLER_Y = 0.012;

/**
 * A Super-II–like kit with the normal motor on two AA cells (#30, all
 * provisional): Tamiya's catalogue gives the normal motor about 12,000 rpm
 * and 0.6–0.8 mN·m at 3 V, the torque where it runs best; the stall torque
 * is taken as about five times that, as for small DC motors; 4.2:1
 * gears, 26mm tyres.
 */
export const STANDARD_MACHINE: MachineSpec = {
  mass: 0.13,
  size: [0.08, 0.02, 0.15],
  clearance: 0.003,
  tyreRadius: 0.013,
  tyreWidth: 0.011,
  wheelbase: 0.08,
  tread: 0.072,
  gearRatio: 4.2,
  efficiency: 0.7,
  motor: { freeRpm: 12000, stallTorque: 0.0035 },
  rollers: [
    { at: [ROLLER_X, ROLLER_Y, 0.075], ...ROLLER },
    { at: [-ROLLER_X, ROLLER_Y, 0.075], ...ROLLER },
    { at: [ROLLER_X, ROLLER_Y, -0.07], ...ROLLER },
    { at: [-ROLLER_X, ROLLER_Y, -0.07], ...ROLLER },
  ],
  grip: 1,
  // Near nothing, as for rollers that turn freely (#29, provisional).
  rollerFriction: 0.01,
  rollerRestitution: 0.2,
};

/** Motor torque at a speed (spec simulator.md 3): straight from the stall torque down to nothing at the free speed, N·m. */
export function motorTorque(motor: MotorSpec, rpm: number): number {
  const t = motor.stallTorque * (1 - rpm / motor.freeRpm);
  return Math.max(0, Math.min(motor.stallTorque, t));
}

/** The push of all four tyres on the road at a forward speed, N (4WD: one motor turns them all). */
export function driveForce(spec: MachineSpec, speed: number): number {
  const wheelRpm = (Math.abs(speed) / spec.tyreRadius) * (60 / (2 * Math.PI));
  return (motorTorque(spec.motor, wheelRpm * spec.gearRatio) * spec.gearRatio * spec.efficiency) / spec.tyreRadius;
}

/** Top speed on the level with nothing holding it back, m/s. */
export function freeSpeed(spec: MachineSpec): number {
  return ((spec.motor.freeRpm / spec.gearRatio) * 2 * Math.PI * spec.tyreRadius) / 60;
}
