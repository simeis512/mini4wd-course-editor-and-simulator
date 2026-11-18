import { fromBase64Url, pipe, Reader, toBase64Url, Writer } from '../course/packing';
import { BATTERIES, BRAKE_SPONGES, CHASSIS, DAMPER_WEIGHTS, GEARS, MOTORS, ROLLER_KINDS, ROLLER_SIZES, TYRE_KINDS, TYRES } from './parts';
import { validateSetup, type MachineSetup, type RollerPair } from './setup';

const SIDES = [undefined, 'left', 'right'] as const;

/**
 * Machine setup ⇄ URL hash (#31): `#m=<format>.<payload>`, apart from the
 * course's `#c=` (owner 2026-11-08: separate machine and course URLs). The
 * payload is binary, deflate-raw compressed and base64url encoded like the
 * course's.
 *
 * Format 1, integers as LEB128 varints, signed ones zigzag encoded; parts
 * as their place in the lists in parts.ts (which only grow at the end):
 *   flags: bit0 has name, bit1 has measured mass, bit2 has rear tyres of their own
 *   [name: byte length, UTF-8]
 *   chassis, motor, gear, battery, tyre, tyre kind
 *   [measured mass (0.1 g)]
 *   [rear tyre, rear tyre kind]
 *   roller pair count, then for each: side (0 both, 1 left, 2 right), z, y, width (0.1 mm), size, kind
 *   damper count, then for each: weight, x, y, z, stroke (0.1 mm)
 *   brake count, then for each: sponge, z, width, length, gap (0.1 mm)
 *   weight count, then for each: mass (0.1 g), x, y, z (0.1 mm)
 *
 * New items go at the end of the format with a flag bit or a new version,
 * so older URLs still open (#31 decision 2026-11-08).
 */
export const MACHINE_FORMAT_VERSION = 1;
const READABLE_VERSIONS = [MACHINE_FORMAT_VERSION];
export const MACHINE_HASH_KEY = 'm';

function index<T>(list: readonly T[], match: (t: T) => boolean, what: string): number {
  const i = list.findIndex(match);
  if (i < 0) throw new Error(`unknown ${what}`);
  return i;
}

function at<T>(list: readonly T[], i: number): T {
  const t = list[i];
  if (t === undefined) throw new Error('不明なパーツがあります（新しい版のアプリで作られたマシンかもしれません）');
  return t;
}

export function setupToBytes(setup: MachineSetup): Uint8Array {
  const w = new Writer();
  const name = setup.name ? new TextEncoder().encode(setup.name) : null;
  const rear = setup.rearTyre !== undefined || setup.rearTyreKind !== undefined;
  w.uint((name ? 1 : 0) | (setup.measuredMass !== undefined ? 2 : 0) | (rear ? 4 : 0));
  if (name) {
    w.uint(name.length);
    w.bytes.push(...name);
  }
  w.uint(index(CHASSIS, (c) => c.id === setup.chassis, 'chassis'));
  w.uint(index(MOTORS, (m) => m.id === setup.motor, 'motor'));
  w.uint(index(GEARS, (g) => g.ratio === setup.gearRatio, 'gear'));
  w.uint(index(BATTERIES, (b) => b.id === setup.battery, 'battery'));
  w.uint(index(TYRES, (t) => t.id === setup.tyre, 'tyre'));
  w.uint(index(TYRE_KINDS, (t) => t.id === setup.tyreKind, 'tyre kind'));
  if (setup.measuredMass !== undefined) w.uint(Math.round(setup.measuredMass * 10));
  if (rear) {
    w.uint(index(TYRES, (t) => t.id === (setup.rearTyre ?? setup.tyre), 'tyre'));
    w.uint(index(TYRE_KINDS, (t) => t.id === (setup.rearTyreKind ?? setup.tyreKind), 'tyre kind'));
  }
  w.uint(setup.rollers.length);
  for (const r of setup.rollers) {
    w.uint(SIDES.indexOf(r.side));
    for (const v of [r.z, r.y, r.width]) w.tenths(v);
    w.uint(index(ROLLER_SIZES, (d) => d === r.diameter, 'roller size'));
    w.uint(index(ROLLER_KINDS, (k) => k.id === r.kind, 'roller'));
  }
  w.uint(setup.dampers.length);
  for (const d of setup.dampers) {
    w.uint(index(DAMPER_WEIGHTS, (k) => k.id === d.weight, 'damper'));
    for (const v of [d.x, d.y, d.z, d.stroke]) w.tenths(v);
  }
  w.uint(setup.brakes.length);
  for (const b of setup.brakes) {
    w.uint(index(BRAKE_SPONGES, (k) => k.id === b.sponge, 'brake'));
    for (const v of [b.z, b.width, b.length, b.gap]) w.tenths(v);
  }
  w.uint(setup.weights.length);
  for (const g of setup.weights) {
    w.uint(Math.round(g.mass * 10));
    for (const v of [g.x, g.y, g.z]) w.tenths(v);
  }
  return Uint8Array.from(w.bytes);
}

export function setupFromBytes(bytes: Uint8Array): MachineSetup {
  const r = new Reader(bytes);
  const flags = r.uint();
  const setup: MachineSetup = {
    ...(flags & 1 ? { name: new TextDecoder().decode(r.take(r.uint())) } : {}),
    chassis: at(CHASSIS, r.uint()).id,
    motor: at(MOTORS, r.uint()).id,
    gearRatio: at(GEARS, r.uint()).ratio,
    battery: at(BATTERIES, r.uint()).id,
    tyre: at(TYRES, r.uint()).id,
    tyreKind: at(TYRE_KINDS, r.uint()).id,
    rollers: [],
    dampers: [],
    brakes: [],
    weights: [],
  };
  if (flags & 2) setup.measuredMass = r.uint() / 10;
  if (flags & 4) {
    setup.rearTyre = at(TYRES, r.uint()).id;
    setup.rearTyreKind = at(TYRE_KINDS, r.uint()).id;
  }
  for (let n = r.uint(); n > 0; n--) {
    const sideCode = r.uint();
    if (sideCode >= SIDES.length) throw new Error('ローラーの左右が正しくありません');
    const side = SIDES[sideCode];
    const [z, y, width] = [r.tenths(), r.tenths(), r.tenths()];
    const pair: RollerPair = { z, y, width, diameter: at(ROLLER_SIZES, r.uint()), kind: at(ROLLER_KINDS, r.uint()).id };
    setup.rollers.push(side ? { side, ...pair } : pair);
  }
  for (let n = r.uint(); n > 0; n--) {
    const weight = at(DAMPER_WEIGHTS, r.uint()).id;
    const [x, y, z, stroke] = [r.tenths(), r.tenths(), r.tenths(), r.tenths()];
    setup.dampers.push({ weight, x, y, z, stroke });
  }
  for (let n = r.uint(); n > 0; n--) {
    const sponge = at(BRAKE_SPONGES, r.uint()).id;
    const [z, width, length, gap] = [r.tenths(), r.tenths(), r.tenths(), r.tenths()];
    setup.brakes.push({ sponge, z, width, length, gap });
  }
  for (let n = r.uint(); n > 0; n--) {
    const mass = r.uint() / 10;
    const [x, y, z] = [r.tenths(), r.tenths(), r.tenths()];
    setup.weights.push({ mass, x, y, z });
  }
  if (r.pos !== bytes.length) throw new Error('unexpected data after machine');
  validateSetup(setup);
  return setup;
}

/** Encode a setup as the value of the `m` hash parameter. */
export async function encodeSetup(setup: MachineSetup): Promise<string> {
  const packed = await pipe(setupToBytes(setup), new CompressionStream('deflate-raw'));
  return `${MACHINE_FORMAT_VERSION}.${toBase64Url(packed)}`;
}

export async function decodeSetup(value: string): Promise<MachineSetup> {
  const dot = value.indexOf('.');
  const version = Number(value.slice(0, dot));
  if (dot < 0 || !Number.isInteger(version)) throw new Error('マシンURLの形式が正しくありません');
  if (!READABLE_VERSIONS.includes(version)) throw new Error(`未対応のマシン形式です（版 ${version}）`);
  const bytes = await pipe(fromBase64Url(value.slice(dot + 1)), new DecompressionStream('deflate-raw'));
  return setupFromBytes(bytes);
}

/** `#m=...` for a setup. */
export async function setupToHash(setup: MachineSetup): Promise<string> {
  return `#${MACHINE_HASH_KEY}=${await encodeSetup(setup)}`;
}

/** The `m` value in a location hash, or null when there is none. */
export function machineValueOf(hash: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, '')).get(MACHINE_HASH_KEY);
}
