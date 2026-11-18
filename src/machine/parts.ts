// The parts a machine is set up from (#31, #30). Lengths in mm, masses in g.
//
// Every figure here is provisional (#30): taken from Tamiya's product pages
// and chassis select guide as gathered on branch docs/25-machine-research-design
// (docs/machine-parts/stock/*.csv, checked 2026-10-25), or, where nothing was
// published, a guess. They are replaced as parts are measured.
//
// Each list is saved in machine URLs by position: only ever add to the end
// (like PART_CODES for courses).

export type MotorShaft = 'single' | 'dual';

export interface ChassisPart {
  id: string;
  name: string;
  shaft: MotorShaft;
  length: number;
  width: number;
  wheelbase: number;
  frontTread: number;
  rearTread: number;
  /** Mass of the select guide's example build, with batteries (provisional: what it includes is not stated, #30). */
  mass: number;
  /** Clearance with its own tyres. */
  clearance: number;
  /** Diameter of the tyres it comes with, which the clearance is for (provisional, from the guide's tyre type). */
  tyre: number;
  /** Gear ratio it comes with. */
  gearRatio: number;
}

/** From Tamiya's chassis select guide (https://www.tamiya.com/japan/cms/mini4wd_chassis_select.html, #30). */
export const CHASSIS: readonly ChassisPart[] = [
  { id: 'super-2', name: 'スーパーII', shaft: 'single', length: 150, width: 97, wheelbase: 80, frontTread: 64, rearTread: 64, mass: 115, clearance: 5.3, tyre: 31, gearRatio: 4.2 },
  { id: 'ar', name: 'AR', shaft: 'single', length: 155, width: 97, wheelbase: 82, frontTread: 67, rearTread: 67, mass: 123.5, clearance: 5, tyre: 31, gearRatio: 4.2 },
  { id: 'vs', name: 'VS', shaft: 'single', length: 145, width: 90, wheelbase: 80, frontTread: 64, rearTread: 69, mass: 113.8, clearance: 5, tyre: 31, gearRatio: 4.2 },
  { id: 'vz', name: 'VZ', shaft: 'single', length: 158, width: 98, wheelbase: 80, frontTread: 59.5, rearTread: 65.5, mass: 108.3, clearance: 2.5, tyre: 26, gearRatio: 3.5 },
  { id: 'fm-a', name: 'FM-A', shaft: 'single', length: 150, width: 97, wheelbase: 83, frontTread: 59.5, rearTread: 59.5, mass: 117, clearance: 2.5, tyre: 26, gearRatio: 3.5 },
  { id: 'super-xx', name: 'スーパーXX', shaft: 'single', length: 153, width: 98, wheelbase: 84, frontTread: 70, rearTread: 70, mass: 119, clearance: 1.9, tyre: 24, gearRatio: 3.5 },
  { id: 'ma', name: 'MA', shaft: 'dual', length: 156, width: 97, wheelbase: 80, frontTread: 59.5, rearTread: 59.5, mass: 125.9, clearance: 2.2, tyre: 26, gearRatio: 3.5 },
  { id: 'ms', name: 'MS（N-02）', shaft: 'dual', length: 152, width: 92, wheelbase: 80, frontTread: 67, rearTread: 69, mass: 124.7, clearance: 4, tyre: 31, gearRatio: 4 },
  { id: 'me', name: 'ME', shaft: 'dual', length: 156, width: 97, wheelbase: 80, frontTread: 60, rearTread: 66, mass: 117, clearance: 2.5, tyre: 26, gearRatio: 3.5 },
];

export interface MotorPart {
  id: string;
  name: string;
  shaft: MotorShaft;
  /** The catalogue's recommended load torque, mN·m, and the speed there, rpm: not the free speed or the stall torque (#30). */
  loadTorque: [number, number];
  loadRpm: [number, number];
}

/**
 * From each motor's product page (#30). The normal motor's range is a guess
 * around the 12,000 rpm and 0.6–0.8 mN·m used for it so far (provisional).
 */
export const MOTORS: readonly MotorPart[] = [
  { id: 'normal', name: 'ノーマルモーター', shaft: 'single', loadTorque: [0.6, 0.8], loadRpm: [11000, 13000] },
  { id: 'torque-2', name: 'トルクチューン2', shaft: 'single', loadTorque: [1.6, 2], loadRpm: [12300, 14700] },
  { id: 'rev-2', name: 'レブチューン2', shaft: 'single', loadTorque: [1.2, 1.5], loadRpm: [13400, 15200] },
  { id: 'atomic-2', name: 'アトミックチューン2', shaft: 'single', loadTorque: [1.5, 1.8], loadRpm: [12700, 14900] },
  { id: 'light-dash', name: 'ライトダッシュ', shaft: 'single', loadTorque: [1.3, 1.9], loadRpm: [14600, 17800] },
  { id: 'hyper-dash-3', name: 'ハイパーダッシュ3', shaft: 'single', loadTorque: [1.4, 1.9], loadRpm: [17200, 21200] },
  { id: 'power-dash', name: 'パワーダッシュ', shaft: 'single', loadTorque: [1.5, 2], loadRpm: [19900, 23600] },
  { id: 'sprint-dash', name: 'スプリントダッシュ', shaft: 'single', loadTorque: [1.3, 1.8], loadRpm: [20700, 27200] },
  { id: 'torque-2-pro', name: 'トルクチューン2 PRO', shaft: 'dual', loadTorque: [1.7, 2.1], loadRpm: [12200, 14400] },
  { id: 'rev-2-pro', name: 'レブチューン2 PRO', shaft: 'dual', loadTorque: [1.2, 1.5], loadRpm: [13200, 14900] },
  { id: 'atomic-2-pro', name: 'アトミックチューン2 PRO', shaft: 'dual', loadTorque: [1.6, 1.8], loadRpm: [12300, 14500] },
  { id: 'light-dash-pro', name: 'ライトダッシュ PRO', shaft: 'dual', loadTorque: [1.3, 1.9], loadRpm: [14600, 17800] },
  { id: 'hyper-dash-pro', name: 'ハイパーダッシュ PRO', shaft: 'dual', loadTorque: [1.4, 1.9], loadRpm: [17200, 21200] },
  { id: 'mach-dash-pro', name: 'マッハダッシュ PRO', shaft: 'dual', loadTorque: [1.3, 1.8], loadRpm: [20000, 24500] },
];

/** Gear ratios sold (motor turns per tyre turn), with their usual names (#30). */
export const GEARS: readonly { ratio: number; name: string }[] = [
  { ratio: 5, name: '5:1（ノーマル）' },
  { ratio: 4.2, name: '4.2:1（ハイスピード）' },
  { ratio: 4, name: '4:1（ハイスピード）' },
  { ratio: 3.7, name: '3.7:1（ハイスピードEX）' },
  { ratio: 3.5, name: '3.5:1（超速）' },
];

export interface BatteryPart {
  id: string;
  name: string;
  /** Two cells in series, V: nominal, not under load (provisional, #30). */
  voltage: number;
  /** Both cells, g. */
  mass: number;
}

/** Two AA cells. Alkaline mass is a guess; Neo-Champ is about 19 g a cell (#30). */
export const BATTERIES: readonly BatteryPart[] = [
  { id: 'alkaline', name: 'アルカリ電池', voltage: 3, mass: 46 },
  { id: 'neo-champ', name: 'ネオチャンプ（ニッケル水素）', voltage: 2.4, mass: 38 },
];

export interface TyrePart {
  id: string;
  name: string;
  diameter: number;
  /** Width, mm (provisional: not published, #30). */
  width: number;
}

export const TYRES: readonly TyrePart[] = [
  { id: 'large', name: '大径 31mm', diameter: 31, width: 11 },
  { id: 'large-low', name: '大径ローハイト 31mm', diameter: 31, width: 9 },
  { id: 'small', name: '小径 26mm', diameter: 26, width: 11 },
  { id: 'small-low', name: '小径ローハイト 26mm', diameter: 26, width: 9 },
  { id: 'small-narrow', name: '小径ナロー 24mm', diameter: 24, width: 8 },
];

/** What the tyres are made of, and how hard they grip: road push per newton pressed on it (provisional: unmeasured, #30). */
export const TYRE_KINDS: readonly { id: string; name: string; grip: number }[] = [
  { id: 'rubber', name: 'ゴム（ノーマル）', grip: 1 },
  { id: 'hard', name: 'ハード', grip: 0.85 },
  { id: 'super-hard', name: 'スーパーハード', grip: 0.7 },
  { id: 'low-friction', name: 'ローフリクション', grip: 0.5 },
];

/** Roller diameters sold, mm (#30). */
export const ROLLER_SIZES: readonly number[] = [9, 11, 13, 17, 19, 8, 12];

export interface RollerKind {
  id: string;
  name: string;
  /** Drag along the fence, as a friction coefficient (provisional: unmeasured, #29). */
  friction: number;
  restitution: number;
  /** Mass of one 13mm roller, g; others scale with the diameter squared (provisional: 15437 is 1.7 g a pair, #30). */
  mass13: number;
  /** Thickness, mm (provisional: owner 2026-11-19, about 2 mm on real rollers). */
  thickness: number;
}

export const ROLLER_KINDS: readonly RollerKind[] = [
  { id: 'alu-bearing', name: 'アルミ（ベアリング）', friction: 0.01, restitution: 0.2, mass13: 0.85, thickness: 2 },
  { id: 'plastic-bearing', name: 'プラ（ベアリング）', friction: 0.015, restitution: 0.25, mass13: 0.5, thickness: 2.5 },
  { id: 'plastic', name: 'プラ（軸受けなし）', friction: 0.05, restitution: 0.25, mass13: 0.4, thickness: 2.5 },
  { id: 'rubber-ring', name: 'ゴムリング付き', friction: 0.3, restitution: 0.1, mass13: 0.9, thickness: 3 },
];

/**
 * A mass damper weight's shape, mm: a cylinder standing on its shaft, or a
 * square bar lying along the machine (length front to back).
 */
export type DamperShape = { kind: 'cylinder'; diameter: number; height: number } | { kind: 'bar'; width: number; height: number; length: number };

/**
 * The weights of mass dampers (#30). Masses and the square and slim ones'
 * sizes are Tamiya's; the round ones' sizes are guesses from their mass
 * as brass (provisional).
 */
export const DAMPER_WEIGHTS: readonly { id: string; name: string; mass: number; shape: DamperShape }[] = [
  { id: 'round', name: 'マスダンパー（丸）', mass: 4.7, shape: { kind: 'cylinder', diameter: 10, height: 7 } },
  { id: 'heavy', name: 'マスダンパー ヘビー', mass: 8.8, shape: { kind: 'cylinder', diameter: 12, height: 9 } },
  { id: 'square-8', name: 'スクエア 8mm', mass: 14.9, shape: { kind: 'bar', width: 8, height: 8, length: 32 } },
  { id: 'square-6', name: 'スクエア 6mm', mass: 8.3, shape: { kind: 'bar', width: 6, height: 6, length: 32 } },
  { id: 'square-short-8', name: 'スクエアショート 8mm', mass: 6.6, shape: { kind: 'bar', width: 8, height: 8, length: 14 } },
  { id: 'square-short-6', name: 'スクエアショート 6mm', mass: 3.6, shape: { kind: 'bar', width: 6, height: 6, length: 14 } },
  { id: 'slim-long', name: 'スリム ロング', mass: 3, shape: { kind: 'cylinder', diameter: 7, height: 11.5 } },
  { id: 'slim-short', name: 'スリム ショート', mass: 1.5, shape: { kind: 'cylinder', diameter: 7, height: 5.5 } },
];

/** Brake sponges, and how hard they grip the road (provisional: unmeasured, #30). */
export const BRAKE_SPONGES: readonly { id: string; name: string; friction: number }[] = [
  { id: 'white', name: 'ホワイト', friction: 0.9 },
  { id: 'mild-blue', name: 'マイルド（ブルー）', friction: 0.6 },
];

/** Regulation limits (Tamiya official rules): widest and longest machine, lowest clearance, mm. */
export const REGULATION = { width: 105, length: 165, clearance: 1 };

/**
 * A motor's straight torque–speed line (owner 2026-10-27, #25): one point
 * at the middle of the recommended load torque and of its speed, the free
 * speed `FREE_RPM_RATIO` times that speed, and the stall torque where the
 * line through both meets zero speed. At the battery's `voltage` both scale
 * from the catalogue's `CATALOGUE_VOLTAGE`.
 */
export const FREE_RPM_RATIO = 1.25; // provisional (#25 comment 2026-10-27)
/** The voltage the catalogue figures are taken at, V (provisional: the top of the 2.4–3 V the pages give). */
export const CATALOGUE_VOLTAGE = 3;

export function motorLine(motor: MotorPart, voltage = CATALOGUE_VOLTAGE): { freeRpm: number; stallTorque: number } {
  const mid = (r: [number, number]) => (r[0] + r[1]) / 2;
  const torque = mid(motor.loadTorque) / 1000;
  const rpm = mid(motor.loadRpm);
  const freeRpm = rpm * FREE_RPM_RATIO;
  const stallTorque = (torque * freeRpm) / (freeRpm - rpm);
  const k = voltage / CATALOGUE_VOLTAGE;
  return { freeRpm: freeRpm * k, stallTorque: stallTorque * k };
}

/** Mass of one roller, g. */
export function rollerMass(kind: RollerKind, diameter: number): number {
  return kind.mass13 * (diameter / 13) ** 2;
}

export function byId<T extends { id: string }>(list: readonly T[], id: string): T {
  const found = list.find((p) => p.id === id);
  if (!found) throw new Error(`不明なパーツ: ${id}`);
  return found;
}
