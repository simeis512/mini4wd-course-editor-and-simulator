import type { PartDef, PortDef } from './part';
import { modelFor, type Pose } from './geometry';

// Measured models that replace a part's procedural geometry (spec 15).
// Only the switch and the metadata are here; converting STEP files and
// loading the meshes come with the first measured model (#23).

/** Metadata that comes with a measured model (spec 15.3). */
export interface PartModel {
  /** The PartDef id it stands in for. */
  part: string;
  version: number;
  /** Path of the display mesh (.glb). */
  visual: string;
  /** Path of the collision mesh (.glb): road and fence faces only. */
  collider: string;
  /**
   * Ports in model coordinates, placed where they were measured. Same ids,
   * order and lanes as the part's own, so courses join the same way.
   */
  ports: (PortDef & { anchor: Pose })[];
  /** Centreline of each lane, as points in model coordinates (mm). */
  laneCenterlines: [number, number, number][][];
  /** The STEP original and notes on the measuring. */
  source: string;
}

/** Where a part's shape comes from (spec 15.1). */
export type ShapeSource =
  | { kind: 'procedural' }
  /** `model` once its metadata has been loaded; until then the part is still swept. */
  | { kind: 'model'; path: string; model: PartModel | null };

export function shapeSource(part: PartDef): ShapeSource {
  if (!part.model) return { kind: 'procedural' };
  return { kind: 'model', path: part.model, model: modelFor(part.id) };
}

const isNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isVec3 = (x: unknown): x is [number, number, number] => Array.isArray(x) && x.length === 3 && x.every(isNumber);
const isPose = (x: unknown): x is Pose => {
  const p = x as Pose;
  return typeof p === 'object' && p !== null && isVec3(p.pos) && isVec3(p.rot);
};

/**
 * Check a model's metadata against the part it replaces and return it typed.
 * Throws when it does not fit: the ports must match the part's so that
 * every course still joins the same way (spec 15.1).
 */
export function parsePartModel(data: unknown, part: PartDef): PartModel {
  const m = data as PartModel;
  const fail = (why: string): never => {
    throw new Error(`model for ${part.id}: ${why}`);
  };
  if (typeof m !== 'object' || m === null) fail('not an object');
  if (m.part !== part.id) fail(`made for ${String(m.part)}`);
  if (!isNumber(m.version)) fail('no version');
  for (const key of ['visual', 'collider', 'source'] as const) if (typeof m[key] !== 'string') fail(`no ${key}`);
  if (!Array.isArray(m.ports) || m.ports.length !== part.ports.length) fail('ports differ from the part');
  m.ports.forEach((p, i) => {
    const own = part.ports[i];
    if (p.id !== own.id) fail(`port ${i} is ${String(p.id)}, not ${own.id}`);
    if (!isPose(p.anchor)) fail(`port ${own.id} has no pose`);
    if (!Array.isArray(p.lanes) || p.lanes.join() !== own.lanes.join()) fail(`port ${own.id} carries other lanes`);
  });
  if (!Array.isArray(m.laneCenterlines) || m.laneCenterlines.length !== part.lanes.length) fail('one centreline per lane needed');
  for (const line of m.laneCenterlines) if (!Array.isArray(line) || line.length < 2 || !line.every(isVec3)) fail('bad lane centreline');
  // The model's ports keep the part's kinds and partners; only where they sit comes from the model.
  return { ...m, ports: m.ports.map((p, i) => ({ ...part.ports[i], anchor: p.anchor })) };
}
