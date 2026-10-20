import * as THREE from 'three';
import { GLOBAL_SPEC, laneOffset, variantOf, type PartDef } from './catalog';
import type { Layout, PlacedPiece } from './course';
import { partGeometry, pointOnFrame } from './geometry';

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
  /** Centreline samples, world frames. */
  samples: THREE.Matrix4[];
  section: CrossSection;
}

/** Every stretch of road of a piece, placed in the world. */
export function pieceTracks(pc: PlacedPiece, piece: number): WorldTrack[] {
  return partGeometry(pc.part).tracks.map((track) => ({
    piece,
    samples: track.samples.map((s) => pc.matrix.clone().multiply(s)),
    section: crossSection(track.lanes),
  }));
}

/** Every stretch of road of the course, piece by piece. */
export function worldTracks(layout: Layout): WorldTrack[] {
  return layout.pieces.flatMap((pc, i) => pieceTracks(pc, i));
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
 * Sweep a rectangle (lateral `x0..x1`, height `y0..y1`) along the frames.
 * Each side gets its own vertices so the corners stay sharp.
 */
function sweepBox(frames: THREE.Matrix4[], x0: number, x1: number, y0: number, y1: number): THREE.BufferGeometry {
  // Corners anticlockwise when looking along the centreline.
  const corners: [number, number][] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  const p = new THREE.Vector3();
  const n = frames.length;
  for (let side = 0; side < 4; side++) {
    const [ax, ay] = corners[side];
    const [bx, by] = corners[(side + 1) % 4];
    const base = positions.length / 3;
    for (const f of frames) {
      pointOnFrame(f, ax, ay, p);
      positions.push(p.x, p.y, p.z);
      pointOnFrame(f, bx, by, p);
      positions.push(p.x, p.y, p.z);
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  for (const [f, flip] of [
    [frames[0], true],
    [frames[n - 1], false],
  ] as const) {
    const base = positions.length / 3;
    for (const [x, y] of corners) {
      pointOnFrame(f, x, y, p);
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

/** Road and fence geometry of a part in part-local millimetres. */
export function buildPartGeometry(part: PartDef): { roads: THREE.BufferGeometry[]; fences: THREE.BufferGeometry[] } {
  const roads: THREE.BufferGeometry[] = [];
  const fences: THREE.BufferGeometry[] = [];
  for (const { samples, lanes } of partGeometry(part).tracks) {
    const section = crossSection(lanes);
    roads.push(sweepBox(samples, section.left, section.right, -roadThickness, 0));
    for (const x of section.fences) {
      fences.push(sweepBox(samples, x - fenceThickness / 2, x + fenceThickness / 2, 0, fenceHeight));
    }
  }
  return { roads, fences };
}

const partGeometryCache = new Map<string, ReturnType<typeof buildPartGeometry>>();
const materialCache = new Map<string, THREE.MeshStandardMaterial>();

function material(color: string, shade: number): THREE.MeshStandardMaterial {
  const key = `${color}/${shade}`;
  let m = materialCache.get(key);
  if (!m) {
    const c = new THREE.Color(color);
    c.multiplyScalar(shade);
    m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 });
    materialCache.set(key, m);
  }
  return m;
}

/** One group per piece, placed in world millimetres; the caller scales to metres. */
export function buildCourseMeshes(layout: Layout): THREE.Group[] {
  return layout.pieces.map((pc, i) => {
    if (pc.part.model) {
      // Measured models (spec 15) are not loaded yet; fall back to the sweep.
      console.warn(`model for ${pc.part.id} not loaded yet: ${pc.part.model}`);
    }
    let geo = partGeometryCache.get(pc.part.id);
    if (!geo) {
      geo = buildPartGeometry(pc.part);
      partGeometryCache.set(pc.part.id, geo);
    }
    const color = variantOf(pc.part, pc.rec.variant).color;
    const group = new THREE.Group();
    group.name = `piece-${i}`;
    group.userData.piece = i;
    for (const r of geo.roads) group.add(new THREE.Mesh(r, material(color, 1)));
    for (const f of geo.fences) group.add(new THREE.Mesh(f, material(color, 0.85)));
    group.matrixAutoUpdate = false;
    group.matrix.copy(pc.matrix);
    return group;
  });
}
