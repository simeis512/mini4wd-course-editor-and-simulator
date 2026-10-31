import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { layoutCourse } from './course';
import { basicOval, chain } from './presets';
import { addStopper, newStopper } from './stoppers';
import { placeStart } from './timing';
import {
  boundsOf,
  fitsVolume,
  FLOOR_MARGIN,
  forEachTriangle,
  largestFit,
  modelSolids,
  printSolids,
  sizeOf,
  stlBinary,
  triangleCount,
  type ModelIncludes,
  type ModelSolid,
} from './model-export';
import { crc32, threeMf, threeMfModel } from './threemf';

const NONE: ModelIncludes = { supports: false, props: false, floor: false };
const ALL: ModelIncludes = { supports: true, props: true, floor: true };

/** A course with every kind of thing in it: raised road with supports, the start and timer, an open hose and a box. */
function busyCourse() {
  let c = basicOval();
  c = placeStart(c, 0, 100);
  c = addStopper(c, { kind: 'hose', points: [[0, -600], [400, -650], [800, -600]], color: 0 });
  c = addStopper(c, newStopper('box', -800, 0));
  return layoutCourse(c);
}

/** Each edge of a closed solid is shared by exactly two triangles, running opposite ways. */
function isClosed(geo: THREE.BufferGeometry): boolean {
  const edges = new Map<string, number>();
  forEachTriangle(geo, (_a, _b, _c, ...ids) => {
    for (let k = 0; k < 3; k++) {
      const key = `${ids[k]}>${ids[(k + 1) % 3]}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  });
  for (const [key, n] of edges) {
    const [a, b] = key.split('>');
    if (n !== 1 || edges.get(`${b}>${a}`) !== 1) return false;
  }
  return true;
}

/** Signed volume: positive when the faces point outwards. */
function volume(geo: THREE.BufferGeometry): number {
  let v = 0;
  forEachTriangle(geo, (a, b, c) => (v += a.dot(b.clone().cross(c)) / 6));
  return v;
}

describe('modelSolids (#89)', () => {
  it('always has the road and fences, and only adds supports, props and the floor when asked', () => {
    const layout = busyCourse();
    const bare = modelSolids(layout, NONE).map((s) => s.name);
    expect(bare.some((n) => n.includes('road'))).toBe(true);
    expect(bare.some((n) => n.includes('fence'))).toBe(true);
    expect(bare).not.toContain('supports');
    expect(bare).not.toContain('floor');
    const all = modelSolids(layout, ALL).map((s) => s.name);
    expect(all).toContain('supports');
    expect(all).toContain('floor');
    for (const prop of ['start', 'timer', 'stopper']) expect(all.some((n) => n.startsWith(prop))).toBe(true);
  });

  it('lays the floor board under everything, reaching past it on every side', () => {
    const layout = busyCourse();
    const solids = modelSolids(layout, ALL);
    const floor = solids.find((s) => s.name === 'floor')!;
    const rest = boundsOf(solids.filter((s) => s !== floor));
    floor.geometry.computeBoundingBox();
    const board = floor.geometry.boundingBox!;
    expect(board.max.y).toBeCloseTo(0);
    expect(board.min.x).toBeCloseTo(rest.min.x - FLOOR_MARGIN);
    expect(board.max.z).toBeCloseTo(rest.max.z + FLOOR_MARGIN);
  });
});

describe('printSolids (#89)', () => {
  const layout = busyCourse();
  const solids = printSolids(layout, ALL, 20);

  it('makes every solid closed and facing outwards, leaving out the flat stickers', () => {
    expect(solids.some((s) => s.name.startsWith('start'))).toBe(false);
    for (const s of solids) {
      expect(isClosed(s.geometry), s.name).toBe(true);
      expect(volume(s.geometry), s.name).toBeGreaterThan(0);
    }
  });

  it('stands Z up on the bed at the origin, shrunk to the scale', () => {
    const box = boundsOf(solids);
    expect(box.min.toArray().map((v) => Math.abs(v))).toEqual([0, 0, 0].map(() => expect.closeTo(0, 6)));
    const full = boundsOf(modelSolids(layout, ALL, 0.8 * 20)).getSize(new THREE.Vector3());
    const [x, y, z] = sizeOf(solids);
    expect(x).toBeCloseTo(full.x / 20, 3);
    expect(y).toBeCloseTo(full.z / 20, 3);
    expect(z).toBeCloseTo(full.y / 20, 3);
  });

  it('thickens the fences and road to the thinnest wall that prints', () => {
    const straight = printSolids(layoutCourse(chain(['straight'])), NONE, 20, 0.8);
    const thin = (s: ModelSolid) => Math.min(...sizeOf([s]));
    for (const s of straight) expect(thin(s), s.name).toBeGreaterThanOrEqual(0.8 - 1e-6);
    // The road's top rises, and the fences with it, so they still stand as tall above it.
    const fence = straight.find((s) => s.name.includes('fence'))!;
    const road = straight.find((s) => s.name.includes('road'))!;
    expect(boundsOf([fence]).max.z - boundsOf([road]).max.z).toBeCloseTo(50 / 20, 3);
  });

  it('keeps thick enough parts as they are', () => {
    const straight = layoutCourse(chain(['straight']));
    const at10 = sizeOf(printSolids(straight, NONE, 10, 0.1));
    const full = sizeOf(modelSolids(straight, NONE).map((s) => ({ ...s, geometry: s.geometry.clone() })));
    expect(at10[0]).toBeCloseTo(full[0] / 10, 3);
  });
});

describe('fitting the build volume (#89)', () => {
  it('fits turned a quarter on the bed, but never on its side', () => {
    expect(fitsVolume([300, 100, 10], [220, 320, 250])).toBe(true);
    expect(fitsVolume([300, 100, 10], [220, 220, 250])).toBe(false);
    expect(fitsVolume([100, 100, 300], [220, 220, 250])).toBe(false);
  });

  it('suggests the largest scale that fits', () => {
    const size = (n: number) => [3065 / n, 1445 / n, 150 / n];
    expect(largestFit(size, [220, 220, 250])).toBe(20);
    expect(largestFit(size, [350, 350, 350])).toBe(10);
    expect(largestFit(size, [50, 50, 50])).toBeNull();
  });
});

describe('files (#89)', () => {
  const solids = printSolids(layoutCourse(chain(['straight', 'curve45'])), NONE, 20);

  it('writes binary STL: a header, the count, then 50 bytes a triangle', () => {
    const stl = stlBinary(solids);
    const tris = solids.reduce((n, s) => n + triangleCount(s.geometry), 0);
    expect(stl.byteLength).toBe(84 + 50 * tris);
    expect(new DataView(stl).getUint32(80, true)).toBe(tris);
  });

  it('writes 3MF with one object and one base material per colour', () => {
    const xml = threeMfModel(solids);
    const colors = new Set(solids.map((s) => s.color + s.shade)).size;
    expect(xml.match(/<object /g)).toHaveLength(colors);
    expect(xml.match(/<base /g)).toHaveLength(colors);
    expect(xml).toContain('unit="millimeter"');
    const zip = threeMf(solids);
    expect([...zip.slice(0, 4)]).toEqual([0x50, 0x4b, 3, 4]);
    expect(new TextDecoder().decode(zip)).toContain('3D/3dmodel.model');
  });

  it('checks zip entries with the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});
