import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { variantOf } from './catalog';
import type { Layout } from './course';
import { partStands } from './geometry';
import { supports } from './height';
import { attachmentGeometry, ATTACHMENT_COLOR, buildPartGeometry, buildSupportMesh, roadLift, SUPPORT_COLOR, sweepBox } from './mesh';
import { GLOBAL_SPEC } from './catalog';
import { buildPropMeshes } from './props-mesh';
import { stripBounds, tapeStrips } from './tape';
import { TAPE_COLORS } from './tape-mesh';

// The course as a 3D model file (#89): GLB for VRChat and other 3D tools,
// STL / 3MF for printing a miniature. Built from the same shapes as the 3D
// view, without anything that is only there for editing.

/** What goes into the file besides the road and fences, which always do (#89 決定事項). */
export interface ModelIncludes {
  /** The automatic supports under raised road (#11). Stands that come with a part are part of it and always go in. */
  supports: boolean;
  /** The start line, lap timer, hoses and boxes (#56, #53). */
  props: boolean;
  /** A board under everything. */
  floor: boolean;
  /** The joint tape (#133); left out unless asked for. */
  tape?: boolean;
}

/** One solid of the model, world millimetres (Y up), and its colour. */
export interface ModelSolid {
  name: string;
  /** The colour as sold, darkened by `shade` as in the 3D view. */
  color: string;
  shade: number;
  geometry: THREE.BufferGeometry;
}

/** How far the floor board reaches past everything on it, mm (#89, provisional). */
export const FLOOR_MARGIN = 50;
/** How thick the floor board is, mm (#89, provisional). */
export const FLOOR_THICKNESS = 5;
/** Board colour: plain grey, like a floor. */
export const FLOOR_COLOR = '#8a8f98';

/**
 * Every solid of the course, world mm. With `min` (mm, at full size) the
 * file is for printing: nothing is thinner than `min`, each solid is closed
 * (its vertices welded) and the flat start stickers are left out (#89).
 */
export function modelSolids(layout: Layout, includes: ModelIncludes, min?: number): ModelSolid[] {
  const print = min !== undefined;
  const thick = min ?? 0;
  const out: ModelSolid[] = [];
  /** `slabs`: the geometry is separate slabs of 12 triangles each (`buildSupportMesh`), each welded on its own. */
  const push = (name: string, color: string, shade: number, geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4, slabs = false) => {
    if (matrix) geometry.applyMatrix4(matrix);
    out.push({ name, color, shade, geometry: print ? (slabs ? weldEach(geometry, SLAB_VERTICES) : weld(geometry)) : geometry });
  };
  const lift = roadLift(thick);
  layout.pieces.forEach((pc, i) => {
    const color = variantOf(pc.part, pc.rec.variant).color;
    const { roads, fences } = buildPartGeometry(pc.geometry, true, thick);
    roads.forEach((g, n) => push(`piece-${i}-road-${n}`, color, 1, g, pc.matrix));
    fences.forEach((g, n) => push(`piece-${i}-fence-${n}`, color, 0.85, g, pc.matrix));
    const stands = partStands(pc.part, pc.geometry);
    if (stands.length) push(`piece-${i}-stands`, color, 0.9, buildSupportMesh(stands, undefined, thick).geometry, pc.matrix, true);
    layout.attachments.forEach((a, n) => {
      if (a.piece === i) push(`piece-${i}-washboard-${n}`, ATTACHMENT_COLOR, 1, attachmentGeometry(pc, a, lift), pc.matrix);
    });
  });
  if (includes.tape && layout.tape) {
    // As thick as anything else when printing, on the thickened road and fences.
    const size = { thickness: Math.max(thick, 0.2), lift, fenceHalf: Math.max(GLOBAL_SPEC.fenceThickness, thick) / 2 };
    tapeStrips(layout).forEach((s, n) => {
      const { x, y } = print ? stripBounds(s, size) : s;
      const spec = layout.tape![s.where]!;
      push(`piece-${s.piece}-tape-${s.where}-${n}`, TAPE_COLORS[spec.kind], 1, sweepBox(s.frames, x[0], x[1], y[0], y[1]), layout.pieces[s.piece].matrix);
    });
  }
  if (includes.supports) {
    const list = supports(layout);
    if (list.length) push('supports', SUPPORT_COLOR, 1, buildSupportMesh(list, undefined, thick).geometry, undefined, true);
  }
  if (includes.props) {
    for (const group of buildPropMeshes(layout)) {
      // The stickers are flat decals with nothing to print.
      if (print && group.name === 'start') continue;
      group.updateMatrixWorld(true);
      group.children.forEach((child, n) => {
        const mesh = child as THREE.Mesh;
        const color = (mesh.material as THREE.MeshStandardMaterial).color.getHexString();
        const geo = print ? thickened(mesh.geometry, thick) : mesh.geometry.clone();
        push(`${group.name}-${n}`, `#${color}`, 1, geo, mesh.matrixWorld);
      });
    }
  }
  if (includes.floor && out.length) {
    const box = boundsOf(out);
    const t = Math.max(FLOOR_THICKNESS, thick);
    const board = new THREE.BoxGeometry(box.max.x - box.min.x + 2 * FLOOR_MARGIN, t, box.max.z - box.min.z + 2 * FLOOR_MARGIN);
    board.translate((box.min.x + box.max.x) / 2, -t / 2, (box.min.z + box.max.z) / 2);
    push('floor', FLOOR_COLOR, 1, board);
  }
  return out;
}

/** Box of all the solids. */
export function boundsOf(solids: readonly ModelSolid[]): THREE.Box3 {
  const box = new THREE.Box3();
  for (const s of solids) {
    s.geometry.computeBoundingBox();
    box.union(s.geometry.boundingBox!);
  }
  return box;
}

/** One closed solid: only positions, shared corners welded into one vertex. */
function weld(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(geo.attributes)) if (name !== 'position') geo.deleteAttribute(name);
  return mergeVertices(geo, 1e-4);
}

/** Vertices of one slab of a support: 6 faces of 2 triangles. */
const SLAB_VERTICES = 36;

/**
 * Weld each run of `size` vertices of a non-indexed geometry on its own:
 * slabs that only touch stay separate closed solids, so no edge is shared
 * by more than two faces.
 */
function weldEach(geo: THREE.BufferGeometry, size: number): THREE.BufferGeometry {
  const pos = geo.getAttribute('position').array as Float32Array;
  const parts: THREE.BufferGeometry[] = [];
  for (let at = 0; at < pos.length; at += size * 3) {
    const part = new THREE.BufferGeometry();
    part.setAttribute('position', new THREE.BufferAttribute(pos.slice(at, at + size * 3), 3));
    parts.push(weld(part));
  }
  return mergeGeometries(parts);
}

/** A prop's box or hose, at least `min` mm thick, closed at the ends. */
function thickened(geo: THREE.BufferGeometry, min: number): THREE.BufferGeometry {
  if (geo instanceof THREE.BoxGeometry) {
    const { width, height, depth } = geo.parameters;
    return new THREE.BoxGeometry(Math.max(width, min), Math.max(height, min), Math.max(depth, min));
  }
  if (geo instanceof THREE.TubeGeometry) {
    const { path, tubularSegments, radius, radialSegments, closed } = geo.parameters;
    const r = Math.max(radius, min / 2);
    const tube = new THREE.TubeGeometry(path, tubularSegments, r, radialSegments, closed);
    // Still lying on the floor.
    tube.translate(0, r - radius, 0);
    return closed ? tube : capped(tube, radialSegments);
  }
  return geo.clone();
}

/** A tube with a flat cap at either end, so it is a closed solid. */
function capped(tube: THREE.TubeGeometry, radial: number): THREE.BufferGeometry {
  const flat = tube.toNonIndexed();
  const pos = flat.getAttribute('position');
  const src = tube.getAttribute('position');
  const ring = radial + 1;
  const rings = src.count / ring;
  const extra: number[] = [];
  const v = (i: number) => new THREE.Vector3().fromBufferAttribute(src, i);
  for (const [first, inward] of [[0, 1], [(rings - 1) * ring, -1]] as const) {
    const pts = Array.from({ length: radial }, (_, j) => v(first + j));
    const centre = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(radial);
    // Facing out of the tube: away from the next ring in.
    const out = centre.clone().sub(v(first + inward * ring)).normalize();
    for (let j = 0; j < radial; j++) {
      let [a, b] = [pts[j], pts[(j + 1) % radial]];
      const n = b.clone().sub(a).cross(centre.clone().sub(a));
      if (n.dot(out) < 0) [a, b] = [b, a];
      extra.push(a.x, a.y, a.z, b.x, b.y, b.z, centre.x, centre.y, centre.z);
    }
  }
  const all = new Float32Array(pos.count * 3 + extra.length);
  all.set(pos.array as Float32Array);
  all.set(extra, pos.count * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(all, 3));
  return geo;
}

/** Print scales offered, as 1 / n (#89 決定事項). */
export const PRINT_SCALES = [10, 20, 50] as const;
/** Thinnest wall a home printer makes, mm on the print (#89, provisional; a setting). */
export const PRINT_MIN_THICKNESS = 0.8;
/** A common printer's build volume, mm: width, depth, height (#89, provisional; a setting). */
export const BUILD_VOLUME: readonly [number, number, number] = [220, 220, 250];

/**
 * The solids for printing at 1 / `scale`, mm on the print: nothing thinner
 * than `minPrint` mm, Z up as printers expect, standing on Z = 0 with the
 * lowest X and Y at 0.
 */
export function printSolids(layout: Layout, includes: ModelIncludes, scale: number, minPrint = PRINT_MIN_THICKNESS): ModelSolid[] {
  const solids = modelSolids(layout, includes, minPrint * scale);
  // Y up to Z up, turning about X so nothing is mirrored; then shrink.
  const turn = new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(new THREE.Matrix4().makeScale(1 / scale, 1 / scale, 1 / scale));
  for (const s of solids) s.geometry.applyMatrix4(turn);
  const min = boundsOf(solids).min;
  for (const s of solids) s.geometry.translate(-min.x, -min.y, -min.z);
  return solids;
}

/** Size of the solids, mm: X, Y and Z. */
export function sizeOf(solids: readonly ModelSolid[]): [number, number, number] {
  const size = boundsOf(solids).getSize(new THREE.Vector3());
  return [size.x, size.y, size.z];
}

/** Whether a print of `size` fits the build volume, turned a quarter on the bed if need be. */
export function fitsVolume([x, y, z]: readonly number[], [w, d, h]: readonly number[]): boolean {
  return z <= h && ((x <= w && y <= d) || (x <= d && y <= w));
}

/** The largest of `PRINT_SCALES` (smallest n) whose print fits, given its size at each; null when none does. */
export function largestFit(sizeAt: (scale: number) => readonly number[], volume: readonly number[]): number | null {
  return PRINT_SCALES.find((n) => fitsVolume(sizeAt(n), volume)) ?? null;
}

/** The colour of a solid as shown, `#rrggbb`. */
export function shownColor(s: ModelSolid): string {
  return `#${new THREE.Color(s.color).multiplyScalar(s.shade).getHexString()}`;
}

/** Binary STL of all the solids (mm). */
export function stlBinary(solids: readonly ModelSolid[]): ArrayBuffer {
  const tris = solids.reduce((n, s) => n + triangleCount(s.geometry), 0);
  const buf = new ArrayBuffer(84 + 50 * tris);
  const view = new DataView(buf);
  const header = 'Mini4WD course (binary STL, mm)';
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i));
  view.setUint32(80, tris, true);
  let at = 84;
  const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const n = new THREE.Vector3();
  for (const s of solids) {
    forEachTriangle(s.geometry, (pa, pb, pc) => {
      a.copy(pa);
      b.copy(pb);
      c.copy(pc);
      n.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
      for (const v of [n, a, b, c]) {
        view.setFloat32(at, v.x, true);
        view.setFloat32(at + 4, v.y, true);
        view.setFloat32(at + 8, v.z, true);
        at += 12;
      }
      at += 2;
    });
  }
  return buf;
}

export function triangleCount(geo: THREE.BufferGeometry): number {
  return (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3;
}

/** Call `f` with the corners of each triangle. */
export function forEachTriangle(geo: THREE.BufferGeometry, f: (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ia: number, ib: number, ic: number) => void): void {
  const pos = geo.getAttribute('position');
  const index = geo.index;
  const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let t = 0; t < triangleCount(geo); t++) {
    const [ia, ib, ic] = [0, 1, 2].map((k) => (index ? index.getX(t * 3 + k) : t * 3 + k));
    f(a.fromBufferAttribute(pos, ia), b.fromBufferAttribute(pos, ib), c.fromBufferAttribute(pos, ic), ia, ib, ic);
  }
}
