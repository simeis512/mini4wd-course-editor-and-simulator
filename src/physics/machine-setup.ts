import { BATTERIES, BRAKE_SPONGES, byId, CHASSIS, DAMPER_WEIGHTS, motorLine, MOTORS, ROLLER_KINDS, TYRE_KINDS, TYRES } from '../machine/parts';
import { massOf, standardSetup, type MachineSetup } from '../machine/setup';
import type { MachineSpec } from './machine-spec';

// A machine setup (#31) as the physics runs it (#32): the parts' figures
// in SI units, the mass shared out between the chassis box, the dampers and
// the weights.

/** Millimetres and grams in the setup, metres and kilograms here. */
const MM = 0.001;
const G = 0.001;

/** The chassis box is this much of the chassis' width, within the tyres' outsides (provisional, as the box the run was tuned with: 80 of 97 mm). */
const BOX_WIDTH_SHARE = 0.82;
/** The chassis box's height, m (provisional, as tuned so far). */
const BOX_HEIGHT = 0.02;
/** Share of the motor's torque that reaches the tyres (provisional, #30: unmeasured). */
const EFFICIENCY = 0.7;
/** Lowest the chassis may sit with small tyres, m: it rides on the tyres, not the box. */
const MIN_CLEARANCE = 0.0005;
/** Mass damper weights are brass, about this dense, kg/m³: for their size when drawn (cosmetic). */
const BRASS = 8500;

const xyz = (x: number, y: number, z: number): [number, number, number] => [x * MM, y * MM, z * MM];

export function specFromSetup(setup: MachineSetup): MachineSpec {
  const chassis = byId(CHASSIS, setup.chassis);
  const tyre = byId(TYRES, setup.tyre);
  const battery = byId(BATTERIES, setup.battery);
  const mass = massOf(setup);
  const dampers = setup.dampers.map((d) => {
    const kg = byId(DAMPER_WEIGHTS, d.weight).mass * G;
    const side = Math.cbrt(kg / BRASS);
    return { mass: kg, at: xyz(d.x, d.y, d.z), stroke: d.stroke * MM, size: [side, side, side] as [number, number, number] };
  });
  return {
    // What is left for the chassis box once the dampers and weights have their share.
    mass: Math.max(mass.total - mass.dampers - mass.weights, 1) * G,
    size: [chassis.width * BOX_WIDTH_SHARE * MM, BOX_HEIGHT, chassis.length * MM],
    clearance: Math.max(MIN_CLEARANCE, (chassis.clearance + (tyre.diameter - chassis.tyre) / 2) * MM),
    tyreRadius: (tyre.diameter / 2) * MM,
    tyreWidth: tyre.width * MM,
    wheelbase: chassis.wheelbase * MM,
    tread: chassis.frontTread * MM,
    rearTread: chassis.rearTread * MM,
    gearRatio: setup.gearRatio,
    efficiency: EFFICIENCY,
    motor: motorLine(byId(MOTORS, setup.motor), battery.voltage),
    rollers: setup.rollers.flatMap((r) => {
      const kind = byId(ROLLER_KINDS, r.kind);
      const x = r.width / 2 - r.diameter / 2;
      const roller = { radius: (r.diameter / 2) * MM, height: kind.thickness * MM, friction: kind.friction, restitution: kind.restitution };
      return [
        { at: xyz(x, r.y, r.z), ...roller },
        { at: xyz(-x, r.y, r.z), ...roller },
      ];
    }),
    grip: byId(TYRE_KINDS, setup.tyreKind).grip,
    rollerFriction: ROLLER_KINDS[0].friction,
    rollerRestitution: ROLLER_KINDS[0].restitution,
    dampers,
    brakes: setup.brakes.map((b) => ({
      at: xyz(0, b.gap, b.z),
      size: [b.width * MM, b.length * MM],
      friction: byId(BRAKE_SPONGES, b.sponge).friction,
    })),
    weights: setup.weights.map((w) => ({ mass: w.mass * G, at: xyz(w.x, w.y, w.z) })),
  };
}

/** The machine a run takes when none is picked: the standard setup (#31). */
export const STANDARD_MACHINE: MachineSpec = specFromSetup(standardSetup());
