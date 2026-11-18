import {
  BATTERIES,
  BRAKE_SPONGES,
  byId,
  CHASSIS,
  DAMPER_WEIGHTS,
  GEARS,
  motorLine,
  MOTORS,
  REGULATION,
  ROLLER_KINDS,
  ROLLER_SIZES,
  rollerMass,
  TYRE_KINDS,
  TYRES,
} from './parts';

// A machine as it is set up (#31): the parts picked and where they go. The
// rigid-body base items for the beta (owner 2026-11-08); moving parts other
// than mass dampers come later.
//
// Positions are mm from the middle of the chassis, on the road: x to the
// left, y up from the road, z forward (the parts' axes, spec "単位と座標").

/**
 * A pair of rollers, one each side, mirrored (owner 2026-11-18: entered as
 * numbers for now), or one on one side only, for rollers set unevenly
 * (owner 2026-11-19).
 */
export interface RollerPair {
  /** Only the left or the right one; both when not given. */
  side?: 'left' | 'right';
  /** Forward of the chassis middle (negative: behind). */
  z: number;
  /** Middle of the rollers above the road. */
  y: number;
  /** Across both rollers' outer edges; for one side only, twice its outer edge's distance from the middle. */
  width: number;
  /** Diameter, one of `ROLLER_SIZES`. */
  diameter: number;
  /** Id in `ROLLER_KINDS`. */
  kind: string;
}

/**
 * A mass damper (owner 2026-11-18: both ways): a weight that rides up and
 * down its shaft by `stroke`, or, with no stroke, a weight held fixed.
 */
export interface DamperSetup {
  /** Id in `DAMPER_WEIGHTS`. */
  weight: string;
  x: number;
  /** Bottom of its travel: the weight's middle above the road when it is down. */
  y: number;
  z: number;
  /** How far it can ride up its shaft, mm; 0 holds it fixed. */
  stroke: number;
}

/** A brake: a sponge pad on a stay under the chassis, across its middle. */
export interface BrakeSetup {
  /** Id in `BRAKE_SPONGES`. */
  sponge: string;
  /** Middle of the pad, forward of the chassis middle. */
  z: number;
  width: number;
  length: number;
  /** Underside of the pad above the road on the level. */
  gap: number;
}

/** A fixed weight (a nut, a plate) where it is fixed. */
export interface WeightSetup {
  mass: number;
  x: number;
  y: number;
  z: number;
}

export interface MachineSetup {
  name?: string;
  /** Ids in the parts lists. */
  chassis: string;
  motor: string;
  /** One of `GEARS`' ratios. */
  gearRatio: number;
  battery: string;
  tyre: string;
  tyreKind: string;
  /** The rear tyres, when they differ from the front ones (owner 2026-11-19). */
  rearTyre?: string;
  rearTyreKind?: string;
  rollers: RollerPair[];
  dampers: DamperSetup[];
  brakes: BrakeSetup[];
  weights: WeightSetup[];
  /** The whole machine weighed on scales, g; without it the mass is estimated from the parts. */
  measuredMass?: number;
}

const ROLLER_HEIGHT = 12; // provisional: about where the kits' stays hold them (#30)

/** Kit-like rollers on a chassis: a 13mm pair at each end, the regulation width across (#30, provisional). */
export function kitRollers(length: number): RollerPair[] {
  const end = length / 2 - 5;
  return [
    { z: end, y: ROLLER_HEIGHT, width: REGULATION.width, diameter: 13, kind: 'alu-bearing' },
    { z: -end, y: ROLLER_HEIGHT, width: REGULATION.width, diameter: 13, kind: 'alu-bearing' },
  ];
}

/**
 * The machine a new setup starts as: a Super-II kit, normal motor, alkaline
 * cells, on 26mm tyres (provisional: with the kit's 31mm ones the run is
 * too fast to lap the basic oval's lane change in every lane yet).
 */
export function standardSetup(): MachineSetup {
  const chassis = CHASSIS[0];
  return {
    chassis: chassis.id,
    motor: 'normal',
    gearRatio: chassis.gearRatio,
    battery: 'alkaline',
    tyre: 'small',
    tyreKind: 'rubber',
    rollers: kitRollers(chassis.length),
    dampers: [],
    brakes: [],
    weights: [],
  };
}

/** Common roller layouts to start from (owner 2026-11-18: presets for the usual ones). */
export const ROLLER_PRESETS: readonly { name: string; rollers: (length: number) => RollerPair[] }[] = [
  { name: 'キットのまま（前後 13mm）', rollers: kitRollers },
  {
    name: '前 2段・後ろ 2段（13mm）',
    rollers: (length) => {
      const end = length / 2 - 5;
      const pair = (z: number, y: number): RollerPair => ({ z, y, width: REGULATION.width, diameter: 13, kind: 'alu-bearing' });
      return [pair(end, 8), pair(end, 23), pair(-end, 8), pair(-end, 23)];
    },
  },
  {
    name: '前 19mm・後ろ 2段 13mm',
    rollers: (length) => {
      const end = length / 2 - 5;
      return [
        { z: end + 5, y: 10, width: REGULATION.width, diameter: 19, kind: 'plastic-bearing' },
        { z: -end, y: 8, width: REGULATION.width, diameter: 13, kind: 'alu-bearing' },
        { z: -end, y: 23, width: REGULATION.width, diameter: 13, kind: 'alu-bearing' },
      ];
    },
  },
];

/** The shaft the chassis takes motors for. */
export function motorsFor(chassisId: string) {
  const shaft = byId(CHASSIS, chassisId).shaft;
  return MOTORS.filter((m) => m.shaft === shaft);
}

/** Change the chassis, keeping what fits: a motor for its shaft (the first such) and the rest as it was. */
export function withChassis(setup: MachineSetup, chassisId: string): MachineSetup {
  const motors = motorsFor(chassisId);
  const motor = motors.some((m) => m.id === setup.motor) ? setup.motor : motors[0].id;
  return { ...setup, chassis: chassisId, motor };
}

/** Mass by part, g: estimated from the parts unless weighed. */
export interface MassBreakdown {
  /** The chassis build with batteries (select guide), less its own cells, plus the cells picked. */
  base: number;
  rollers: number;
  dampers: number;
  weights: number;
  /** The sum of the above. */
  estimated: number;
  /** What the physics uses: the measured mass if there is one, else the estimate. */
  total: number;
}

/** The select guide's builds come with alkaline cells (provisional, #30). */
const GUIDE_BATTERY = 'alkaline';
/** Rollers the guide's builds already carry: a 13mm aluminium-like pair at each end (provisional). */
const GUIDE_ROLLER_MASS = 4 * rollerMass(ROLLER_KINDS[0], 13);

export function massOf(setup: MachineSetup): MassBreakdown {
  const chassis = byId(CHASSIS, setup.chassis);
  const base = chassis.mass - byId(BATTERIES, GUIDE_BATTERY).mass + byId(BATTERIES, setup.battery).mass - GUIDE_ROLLER_MASS;
  const rollers = setup.rollers.reduce((m, r) => m + (r.side ? 1 : 2) * rollerMass(byId(ROLLER_KINDS, r.kind), r.diameter), 0);
  const dampers = setup.dampers.reduce((m, d) => m + byId(DAMPER_WEIGHTS, d.weight).mass, 0);
  const weights = setup.weights.reduce((m, w) => m + w.mass, 0);
  const estimated = base + rollers + dampers + weights;
  return { base, rollers, dampers, weights, estimated, total: setup.measuredMass ?? estimated };
}

/** Widest across the rollers, mm. */
export const rollerWidth = (setup: MachineSetup) => Math.max(0, ...setup.rollers.map((r) => r.width));

/** Top speed on the level with nothing holding it back, km/h: the motor's free speed through the gears and tyres (#25). */
export function freeSpeedKmh(setup: MachineSetup): number {
  const { freeRpm } = motorLine(byId(MOTORS, setup.motor), byId(BATTERIES, setup.battery).voltage);
  const tyre = byId(TYRES, setup.tyre).diameter / 1000;
  return ((freeRpm / setup.gearRatio) * Math.PI * tyre * 60) / 1000;
}

/** What is wrong with a setup, for the screen: the regulation and things that cannot be built. */
export function setupWarnings(setup: MachineSetup): string[] {
  const out: string[] = [];
  const chassis = byId(CHASSIS, setup.chassis);
  const width = rollerWidth(setup);
  if (width > REGULATION.width) out.push(`ローラーの幅が ${width}mm で、規定の ${REGULATION.width}mm を超えています`);
  const front = Math.max(chassis.length / 2, ...setup.rollers.map((r) => r.z + r.diameter / 2), ...setup.brakes.map((b) => b.z + b.length / 2));
  const back = Math.max(chassis.length / 2, ...setup.rollers.map((r) => -r.z + r.diameter / 2), ...setup.brakes.map((b) => -b.z + b.length / 2));
  if (front + back > REGULATION.length) out.push(`全長が ${Math.round(front + back)}mm で、規定の ${REGULATION.length}mm を超えています`);
  for (const b of setup.brakes) if (b.gap < REGULATION.clearance) out.push(`ブレーキの地上高が ${b.gap}mm で、規定の ${REGULATION.clearance}mm より低くなっています`);
  for (const r of setup.rollers) {
    if (!r.side && r.width < r.diameter * 2) out.push(`幅 ${r.width}mm のローラーは左右が重なります`);
    if (r.y < r.diameter / 2) out.push(`高さ ${r.y}mm の ${r.diameter}mm ローラーは路面にめり込みます`);
  }
  const mass = massOf(setup);
  if (mass.total < mass.dampers + mass.weights) out.push('実測の重さが、マスダンパーとおもりの合計より軽くなっています');
  return out;
}

/** Throws when a setup names a part that does not exist or holds a number that is not one (for setups read from URLs and saves). */
export function validateSetup(setup: MachineSetup): void {
  byId(CHASSIS, setup.chassis);
  byId(MOTORS, setup.motor);
  byId(BATTERIES, setup.battery);
  byId(TYRES, setup.tyre);
  byId(TYRE_KINDS, setup.tyreKind);
  if (setup.rearTyre !== undefined) byId(TYRES, setup.rearTyre);
  if (setup.rearTyreKind !== undefined) byId(TYRE_KINDS, setup.rearTyreKind);
  if (!GEARS.some((g) => g.ratio === setup.gearRatio)) throw new Error(`不明なギヤ比: ${setup.gearRatio}`);
  for (const r of setup.rollers) {
    byId(ROLLER_KINDS, r.kind);
    if (!ROLLER_SIZES.includes(r.diameter)) throw new Error(`不明なローラー径: ${r.diameter}`);
  }
  for (const d of setup.dampers) {
    byId(DAMPER_WEIGHTS, d.weight);
    if (d.stroke < 0) throw new Error('マスダンパーの動く幅が負です');
  }
  for (const b of setup.brakes) byId(BRAKE_SPONGES, b.sponge);
  const numbers = [
    setup.measuredMass ?? 1,
    ...setup.rollers.flatMap((r) => [r.z, r.y, r.width]),
    ...setup.dampers.flatMap((d) => [d.x, d.y, d.z, d.stroke]),
    ...setup.brakes.flatMap((b) => [b.z, b.width, b.length, b.gap]),
    ...setup.weights.flatMap((w) => [w.mass, w.x, w.y, w.z]),
  ];
  if (!numbers.every(Number.isFinite)) throw new Error('マシンの数値が正しくありません');
  if ((setup.measuredMass ?? 1) <= 0 || setup.weights.some((w) => w.mass <= 0)) throw new Error('重さは 0 より大きくしてください');
}
