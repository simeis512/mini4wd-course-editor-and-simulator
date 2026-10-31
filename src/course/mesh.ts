import * as THREE from 'three';
import { GLOBAL_SPEC, laneOffset, variantOf } from './catalog';
import { attachmentShape } from './attachments';
import type { Attachment, Layout, PlacedPiece } from './course';
import { Twist } from './flex';
import { partGeometry, partStands, pointOnFrame, STAND_BEAM, STAND_DEPTH, STAND_LEG, type PartGeometry, type Stand } from './geometry';
import { shapeSource } from './model';
import { changedPieces } from './layout-diff';

/** Scene units are metres; course data is in millimetres. */
export const MM = 0.001;

const { lanePitch, fenceHeight, fenceThickness, roadThickness } = GLOBAL_SPEC;

/** Cross-section of the lanes a part covers (spec 3.2); offsets are from the centreline, + right. */
export interface CrossSection {
  /** Outside edges of the outer fences. */
  left: number;
  right: number;
  /** Fence centres: the outer fences and the dividers. */
  fences: number[];
}

export function crossSection(lanes: readonly number[]): CrossSection {
  const fences = new Set<number>();
  for (const l of lanes) {
    fences.add(laneOffset(l) - lanePitch / 2);
    fences.add(laneOffset(l) + lanePitch / 2);
  }
  const sorted = [...fences].sort((a, b) => a - b);
  return {
    left: sorted[0] - fenceThickness / 2,
    right: sorted[sorted.length - 1] + fenceThickness / 2,
    fences: sorted,
  };
}

/** Points `x` mm right of and `y` mm above each frame: one edge of a track. */
export function trackEdge(frames: readonly THREE.Matrix4[], x: number, y = 0): THREE.Vector3[] {
  return frames.map((f) => pointOnFrame(f, x, y));
}

/** A track's road seen from above as a closed loop at height `y`: the left edge, then the right edge back. */
export function roadOutline(frames: readonly THREE.Matrix4[], section: CrossSection, y = 0): THREE.Vector3[] {
  return [...trackEdge(frames, section.left, y), ...trackEdge(frames, section.right, y).reverse()];
}

/** One stretch of road of a placed piece, in world millimetres. */
export interface WorldTrack {
  piece: number;
  /** Which of the part's tracks: 0 is its main centreline. */
  index: number;
  /** Centreline samples, world frames. */
  samples: THREE.Matrix4[];
  section: CrossSection;
}

/** Every stretch of road of a piece, placed in the world. */
export function pieceTracks(pc: PlacedPiece, piece: number): WorldTrack[] {
  return pc.geometry.tracks.map((track, index) => ({
    piece,
    index,
    samples: track.samples.map((s) => pc.matrix.clone().multiply(s)),
    section: crossSection(track.lanes),
  }));
}

const tracksCache = new WeakMap<Layout, WorldTrack[]>();

/** Every stretch of road, shared read-only for this immutable layout's lifetime (#87). */
export function worldTracks(layout: Layout, previous?: Layout | null): WorldTrack[] {
  let tracks = tracksCache.get(layout);
  if (!tracks) {
    const old = previous && tracksCache.get(previous);
    const changed = old && changedPieces(previous!, layout);
    const byPiece = new Map<number, WorldTrack[]>();
    for (const track of old ?? []) {
      const list = byPiece.get(track.piece) ?? [];
      list.push(track);
      byPiece.set(track.piece, list);
    }
    tracks = layout.pieces.flatMap((pc, i) => old && !changed!.has(i) ? byPiece.get(i)! : pieceTracks(pc, i));
    tracksCache.set(layout, tracks);
  }
  return tracks;
}

/** Whether the point (x, z) lies inside a polygon given in X/Z. */
export function insidePolygon(x: number, z: number, poly: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Half the width of `laneCount` lanes side by side, to the outside of the outer fences. */
export function halfWidth(laneCount: number): number {
  return (laneCount * lanePitch + fenceThickness) / 2;
}

/**
 * Sweep a rectangle (lateral `x0..x1`, height `y0..y1`) along the frames;
 * `y1` may give the top at each frame. Each side gets its own vertices so
 * the corners stay sharp. Without `caps` the ends are left open, as where
 * pieces meet end to end.
 */
function sweepBox(frames: THREE.Matrix4[], x0: number, x1: number, y0: number, y1: number | readonly number[], caps = true): THREE.BufferGeometry {
  const top = (i: number) => (typeof y1 === 'number' ? y1 : y1[i]);
  // Corners anticlockwise when looking along the centreline; null height is the top.
  const corners: [number, number | null][] = [
    [x0, y0],
    [x1, y0],
    [x1, null],
    [x0, null],
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  const p = new THREE.Vector3();
  const n = frames.length;
  for (let side = 0; side < 4; side++) {
    const [ax, ay] = corners[side];
    const [bx, by] = corners[(side + 1) % 4];
    const base = positions.length / 3;
    frames.forEach((f, i) => {
      pointOnFrame(f, ax, ay ?? top(i), p);
      positions.push(p.x, p.y, p.z);
      pointOnFrame(f, bx, by ?? top(i), p);
      positions.push(p.x, p.y, p.z);
    });
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  for (const [i, flip] of caps ? ([
    [0, true],
    [n - 1, false],
  ] as const) : []) {
    const base = positions.length / 3;
    for (const [x, y] of corners) {
      pointOnFrame(frames[i], x, y ?? top(i), p);
      positions.push(p.x, p.y, p.z);
    }
    if (flip) indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * How far the road's top rises when it is made at least `min` mm thick
 * (for printing, #89): it grows upwards from its underside, so the supports
 * and the floor still meet it, and the fences and washboards rise with it.
 */
export const roadLift = (min: number) => Math.max(0, min - roadThickness);

/**
 * Road and fence meshes swept along a part's (or twisted piece's) geometry,
 * in part-local millimetres; open-ended without `caps`. With `min`, no road
 * or fence is thinner than `min` mm (#89).
 */
export function buildPartGeometry(geo: PartGeometry, caps = true, min = 0): { roads: THREE.BufferGeometry[]; fences: THREE.BufferGeometry[] } {
  const roads: THREE.BufferGeometry[] = [];
  const fences: THREE.BufferGeometry[] = [];
  const lift = roadLift(min);
  const fenceHalf = Math.max(fenceThickness, min) / 2;
  for (const { samples, lanes } of geo.tracks) {
    const section = crossSection(lanes);
    roads.push(sweepBox(samples, section.left, section.right, -roadThickness, lift, caps));
    for (const x of section.fences) {
      fences.push(sweepBox(samples, x - fenceHalf, x + fenceHalf, 0, fenceHeight + lift, caps));
    }
  }
  return { roads, fences };
}

const partGeometryCache = new WeakMap<PartGeometry, ReturnType<typeof buildPartGeometry>>();

/** `buildPartGeometry`, built once per geometry and shared read-only. */
function sharedPartGeometry(geo: PartGeometry): ReturnType<typeof buildPartGeometry> {
  let out = partGeometryCache.get(geo);
  if (!out) {
    out = buildPartGeometry(geo);
    partGeometryCache.set(geo, out);
  }
  return out;
}
const materialCache = new Map<string, THREE.MeshStandardMaterial>();

/** `doubleSided` for stands, whose slabs' winding follows the road. */
export function material(color: string, shade: number, doubleSided = false): THREE.MeshStandardMaterial {
  const key = `${color}/${shade}/${doubleSided}`;
  let m = materialCache.get(key);
  if (!m) {
    const c = new THREE.Color(color);
    c.multiplyScalar(shade);
    m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, side: doubleSided ? THREE.DoubleSide : THREE.FrontSide });
    materialCache.set(key, m);
  }
  return m;
}

/**
 * Display meshes of measured models (spec 15), by part id, in part-local
 * millimetres. Loading them comes with the first measured model (#23).
 */
export type ModelVisuals = ReadonlyMap<string, THREE.Object3D>;

/** A measured model's display mesh for a piece, twisted with it (spec 16.2). */
function modelMesh(visual: THREE.Object3D, pc: PlacedPiece): THREE.Object3D {
  const twist = pc.rec.twist ?? 0;
  const out = visual.clone();
  if (!twist) return out;
  const t = new Twist(partGeometry(pc.part).samples, twist);
  out.updateMatrixWorld(true);
  out.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    // Bend the vertices in model coordinates, then put the mesh back in its own.
    const geo = (o.geometry as THREE.BufferGeometry).clone().applyMatrix4(o.matrixWorld);
    t.deform(geo.getAttribute('position') as THREE.BufferAttribute);
    geo.applyMatrix4(o.matrixWorld.clone().invert());
    geo.computeVertexNormals();
    o.geometry = geo;
  });
  return out;
}

/** One group per piece, placed in world millimetres; the caller scales to metres. */
export function buildCourseMeshes(layout: Layout, visuals: ModelVisuals = new Map()): THREE.Group[] {
  return layout.pieces.map((_, i) => buildPieceMesh(layout, i, visuals));
}

/** Build only a changed piece; callers retain the other groups (#92). */
export function buildPieceMesh(layout: Layout, i: number, visuals: ModelVisuals = new Map()): THREE.Group {
  const pc = layout.pieces[i];
  const color = variantOf(pc.part, pc.rec.variant).color;
  const group = new THREE.Group();
  group.name = `piece-${i}`;
  group.userData.piece = i;
  const source = shapeSource(pc.part);
  const visual = source.kind === 'model' && source.model ? visuals.get(pc.part.id) : undefined;
  if (visual) {
    group.add(modelMesh(visual, pc));
  } else {
    // Procedural, also while a measured model is not loaded (spec 15.1).
    const geo = sharedPartGeometry(pc.geometry);
    for (const r of geo.roads) group.add(new THREE.Mesh(r, material(color, 1)));
    for (const f of geo.fences) {
      const fence = new THREE.Mesh(f, material(color, 0.85));
      // Found by name to be seen through from the side camera (#136).
      fence.name = 'fence';
      group.add(fence);
    }
  }
  // Stands that come with the part are part of the piece, in its colour (#11).
  const stands = partStands(pc.part, pc.geometry);
  if (stands.length) group.add(buildSupportMesh(stands, material(color, 0.9, true)));
  for (const a of layout.attachments) if (a.piece === i) group.add(attachmentMesh(pc, a));
  group.matrixAutoUpdate = false;
  group.matrix.copy(pc.matrix);
  return group;
}

/** Washboards are red, as sold (69572). */
export const ATTACHMENT_COLOR = '#e5483f';
/** How far a washboard is drawn sunk into the road, mm, so its underside never shows through (cosmetic). */
const ATTACHMENT_SINK = 0.5;

/** A washboard on its piece, part-local: a plate on the road, sloping down to thin tabs at its ends; `lift` mm higher on a thickened road (#89). */
export function attachmentGeometry(pc: PlacedPiece, a: Attachment, lift = 0): THREE.BufferGeometry {
  const { frames, tops, half } = attachmentShape(pc, a);
  return sweepBox(frames, -half, half, lift - ATTACHMENT_SINK, lift ? tops.map((t) => t + lift) : tops);
}

function attachmentMesh(pc: PlacedPiece, a: Attachment): THREE.Mesh {
  const mesh = new THREE.Mesh(attachmentGeometry(pc, a), material(ATTACHMENT_COLOR, 1));
  mesh.name = 'attachment';
  return mesh;
}

/** Automatic supports are wood-coloured (#11). */
export const SUPPORT_COLOR = '#b89a6e';

/** Push a slab: the four-cornered face `face`, pushed `half` both ways along `along`. */
function pushSlab(positions: number[], face: THREE.Vector3[], along: THREE.Vector3, half: number): void {
  const d = along.clone().multiplyScalar(half);
  const back = face.map((v) => v.clone().sub(d));
  const front = face.map((v) => v.clone().add(d));
  const tris: THREE.Vector3[] = [];
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, e: THREE.Vector3) => tris.push(a, b, c, a, c, e);
  quad(back[0], back[3], back[2], back[1]);
  quad(front[0], front[1], front[2], front[3]);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(back[i], back[j], front[j], front[i]);
  }
  // Wind every face outwards (for printing, #89), whichever way the face and `along` go.
  let volume = 0;
  for (let t = 0; t < tris.length; t += 3) volume += tris[t].dot(tris[t + 1].clone().cross(tris[t + 2]));
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = volume < 0 ? [tris[t], tris[t + 2], tris[t + 1]] : [tris[t], tris[t + 1], tris[t + 2]];
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
}

/**
 * Each support as a frame: a leg from the floor under either edge of the
 * road and a crossbar under the road between them, standing on y = 0.
 * All in one geometry, in the stands' own coordinates. With `min`, no slab
 * is thinner than `min` mm (#89).
 */
export function buildSupportMesh(list: readonly Stand[], mat = material(SUPPORT_COLOR, 1, true), min = 0): THREE.Mesh {
  const positions: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (const { left, right, along, depth: d = STAND_DEPTH } of list) {
    const depth = Math.max(d, min);
    // Across the road, level, from the left edge to the right.
    const across = right.clone().sub(left).setY(0).normalize();
    const floor = (v: THREE.Vector3) => new THREE.Vector3(v.x, 0, v.z);
    const leg = across.clone().multiplyScalar(Math.max(STAND_LEG, min));
    const beam = up.clone().multiplyScalar(Math.max(STAND_BEAM, min));
    const l2 = left.clone().add(leg);
    const r2 = right.clone().sub(leg);
    pushSlab(positions, [floor(left), floor(l2), l2, left], along, depth / 2);
    pushSlab(positions, [floor(r2), floor(right), right, r2], along, depth / 2);
    pushSlab(positions, [l2.clone().sub(beam), r2.clone().sub(beam), r2, l2], along, depth / 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'supports';
  return mesh;
}
