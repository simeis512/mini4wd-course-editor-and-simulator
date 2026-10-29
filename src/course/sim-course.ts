import * as THREE from 'three';
import { GLOBAL_SPEC, portLaneOffsets } from './catalog';
import { offsetFrame, type Block } from './blocks';
import type { Layout, PortRef } from './course';
import { checkLaps } from './laps';
import { attachmentGeometry, buildPartGeometry } from './mesh';
import { buildPropMeshes } from './props-mesh';

// What the simulator needs from a course (spec 9, #26): collision meshes
// swept the same way as the editor's 3D view, a centreline per lane and the
// fall zones past the open ports. All in world millimetres like the rest of
// `course`; the simulator scales to metres.

/** Triangles for a trimesh collider: X, Y, Z per vertex and three vertex indices per triangle, world mm. */
export interface TriMesh {
  vertices: Float32Array;
  indices: Uint32Array;
}

/** One lane followed round from the start of the laps (spec 9: lap timing, running the wrong way, camera). */
export interface SimLane {
  /** The lane it starts in, as the start port's lane (`Lap.lane`). */
  lane: number;
  /** The lane it comes back to the start in; null when the lane breaks off. */
  next: number | null;
  /** Lane centre on the road surface, world mm. */
  points: THREE.Vector3[];
  /** Distance along the lane to each point, mm. */
  distances: number[];
  length: number;
}

/**
 * A box past an open port, or past lanes that end at a joint (#60): a
 * machine that gets into it has run off the end of the road (spec 9).
 */
export interface FallZone {
  at: PortRef;
  /** The part's lanes at the port it covers. */
  lanes: number[];
  /** Left open on purpose, such as a jump's take-off (#13): the simulator may let a machine fly over. */
  intended: boolean;
  /** Centred on `frame` like a `Block`: X across, Y up the port, Z out of the port. */
  frame: THREE.Matrix4;
  size: [number, number, number];
}

export interface SimCourse {
  /** Roads and the washboards on them: what the tyres run on. */
  road: TriMesh;
  /** Outer fences and lane dividers: what the rollers run against. */
  fences: TriMesh;
  /** The lap timer and the hoses and boxes on the floor (#56, #53). */
  props: TriMesh;
  lanes: SimLane[];
  fallZones: FallZone[];
}

/** How far a fall zone reaches out of its port, mm (spec 9, provisional). */
export const FALL_ZONE_LENGTH = 150;
/** How high a fall zone reaches above its port's road, mm: twice the fence (spec 9, provisional). */
export const FALL_ZONE_ABOVE = 2 * GLOBAL_SPEC.fenceHeight;

/** Merge geometries, each moved by its matrix, into one trimesh. */
export function toTriMesh(parts: readonly { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[]): TriMesh {
  let vertexCount = 0;
  let indexCount = 0;
  for (const { geometry } of parts) {
    const n = geometry.getAttribute('position').count;
    vertexCount += n;
    indexCount += geometry.index ? geometry.index.count : n;
  }
  const vertices = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);
  const p = new THREE.Vector3();
  let v = 0;
  let k = 0;
  for (const { geometry, matrix } of parts) {
    const pos = geometry.getAttribute('position');
    const base = v;
    for (let i = 0; i < pos.count; i++, v++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      vertices.set([p.x, p.y, p.z], v * 3);
    }
    if (geometry.index) for (let i = 0; i < geometry.index.count; i++) indices[k++] = base + geometry.index.getX(i);
    else for (let i = 0; i < pos.count; i++) indices[k++] = base + i;
  }
  return { vertices, indices };
}

/** Every mesh under some objects, with the matrix that places it in the world. */
function meshesOf(objects: readonly THREE.Object3D[]): { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[] {
  const out: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[] = [];
  for (const o of objects) {
    o.updateMatrixWorld(true);
    o.traverse((m) => {
      if (m instanceof THREE.Mesh) out.push({ geometry: m.geometry, matrix: m.matrixWorld });
    });
  }
  return out;
}

/**
 * The fall zone past some lanes of a port: across those lanes and their
 * fences, from the floor below the port up to `FALL_ZONE_ABOVE`.
 */
export function fallZone(layout: Layout, at: PortRef, lanes: readonly number[], intended: boolean): FallZone {
  const pc = layout.pieces[at.piece];
  const port = pc.ports[at.port];
  const rights = portLaneOffsets(pc.part.ports[at.port])
    .filter((o) => lanes.includes(o.lane))
    .map((o) => o.right);
  const { lanePitch, fenceThickness } = GLOBAL_SPEC;
  const halfLane = (lanePitch + fenceThickness) / 2;
  const [lo, hi] = rights.length ? [Math.min(...rights) - halfLane, Math.max(...rights) + halfLane] : [-halfLane, halfLane];
  // Down to the floor, however high the port is.
  const below = Math.max(0, new THREE.Vector3().setFromMatrixPosition(port).y);
  const frame = offsetFrame(port, (lo + hi) / 2, (FALL_ZONE_ABOVE - below) / 2, FALL_ZONE_LENGTH / 2);
  return { at, lanes: [...lanes], intended, frame, size: [hi - lo, FALL_ZONE_ABOVE + below, FALL_ZONE_LENGTH] };
}

/** Where a point is along a lane: the nearest spot on its centre, how far along that is and how far off to the side. */
export interface LaneSpot {
  /** Distance along the lane, mm. */
  along: number;
  /** Distance from the lane centre, mm. */
  off: number;
  /** Index of the segment it falls on (points `segment` to `segment + 1`). */
  segment: number;
}

/**
 * The nearest spot on a lane's centre to a point (lap timing, running the
 * wrong way, camera; spec 9). With `within`, only from `from` to `to` mm
 * along the lane, so a point near where the lane passes over itself keeps
 * to the stretch it is on (#112).
 */
export function laneSpot(lane: Pick<SimLane, 'points' | 'distances'>, p: THREE.Vector3, within?: { from: number; to: number }): LaneSpot {
  const { points, distances } = lane;
  if (points.length === 1) return { along: 0, off: p.distanceTo(points[0]), segment: 0 };
  let best: LaneSpot = { along: 0, off: Infinity, segment: 0 };
  const ab = new THREE.Vector3();
  const ap = new THREE.Vector3();
  const q = new THREE.Vector3();
  for (let i = 0; i < points.length - 1; i++) {
    if (within && (distances[i + 1] < within.from || distances[i] > within.to)) continue;
    ab.subVectors(points[i + 1], points[i]);
    const len2 = ab.lengthSq();
    const t = len2 > 0 ? THREE.MathUtils.clamp(ap.subVectors(p, points[i]).dot(ab) / len2, 0, 1) : 0;
    q.copy(points[i]).addScaledVector(ab, t);
    const off = q.distanceTo(p);
    if (off < best.off) best = { along: distances[i] + t * (distances[i + 1] - distances[i]), off, segment: i };
  }
  if (within) best.along = THREE.MathUtils.clamp(best.along, within.from, within.to);
  return best;
}

/**
 * Each lane the simulator runs in, with distances along it: from the start
 * line's piece the way its arrows point (#28), or with no start line from
 * the start of the laps (`checkLaps`) the way the course runs.
 */
export function simLanes(layout: Layout, dir: 1 | -1): SimLane[] {
  const start = layout.start && layout.pieces[layout.start.piece] ? layout.start : null;
  // Over jumps too: a machine flies on to where it lands.
  const check = start ? checkLaps(layout, start.reverse ? -1 : 1, { jumps: true, from: start.piece }) : checkLaps(layout, dir, { jumps: true });
  if (!check) return [];
  return check.laps.map(({ lane, next, points }) => {
    // Pieces meet end to end, so drop the repeated point at each joint.
    const pts = points.filter((p, i) => i === 0 || p.distanceToSquared(points[i - 1]) > 1e-6);
    const distances = [0];
    for (let i = 1; i < pts.length; i++) distances.push(distances[i - 1] + pts[i].distanceTo(pts[i - 1]));
    return { lane, next, points: pts, distances, length: distances[distances.length - 1] };
  });
}

/**
 * The course as the simulator sees it (spec 9, #26). Pieces are always
 * swept from their centrelines, with their bends and twists (spec 16.6),
 * even where a measured model is shown in the editor (spec 15).
 */
export function simCourse(layout: Layout, dir: 1 | -1 = 1): SimCourse {
  const road: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[] = [];
  const fences: typeof road = [];
  layout.pieces.forEach((pc, i) => {
    // Open-ended, so where pieces meet there is no end face for a wheel or roller to catch on.
    const geo = buildPartGeometry(pc.geometry, false);
    for (const geometry of geo.roads) road.push({ geometry, matrix: pc.matrix });
    for (const geometry of geo.fences) fences.push({ geometry, matrix: pc.matrix });
    for (const a of layout.attachments) if (a.piece === i) road.push({ geometry: attachmentGeometry(pc, a), matrix: pc.matrix });
  });
  // The start stickers and the timer's tape lie flat on the road and stop nothing (#110).
  const props = buildPropMeshes(layout).filter((g) => g.userData.prop?.kind !== 'start');
  for (const g of props) g.remove(...g.children.filter((m) => m.name === 'tape'));
  const zones = [
    ...layout.open.map((at) => {
      const intended = layout.intended.some((r) => r.piece === at.piece && r.port === at.port);
      return fallZone(layout, at, layout.pieces[at.piece].part.ports[at.port].lanes, intended);
    }),
    ...layout.deadEnds.map((d) => fallZone(layout, { piece: d.piece, port: d.port }, d.lanes, d.intended)),
  ];
  return {
    road: toTriMesh(road),
    fences: toTriMesh(fences),
    props: toTriMesh(meshesOf(props)),
    lanes: simLanes(layout, dir),
    fallZones: zones,
  };
}

/** Whether a point (world mm) is inside a fall zone, or a block. */
export function insideBox(box: Pick<Block, 'frame' | 'size'>, p: THREE.Vector3): boolean {
  const local = p.clone().applyMatrix4(box.frame.clone().invert());
  return Math.abs(local.x) <= box.size[0] / 2 && Math.abs(local.y) <= box.size[1] / 2 && Math.abs(local.z) <= box.size[2] / 2;
}

/** The point `along` mm along a lane's centre. */
export function pointAlong(lane: Pick<SimLane, 'points' | 'distances'>, along: number): THREE.Vector3 {
  const { points, distances } = lane;
  for (let i = 1; i < points.length; i++) {
    if (distances[i] >= along || i === points.length - 1) {
      const span = distances[i] - distances[i - 1];
      const t = span > 0 ? THREE.MathUtils.clamp((along - distances[i - 1]) / span, 0, 1) : 0;
      return points[i - 1].clone().lerp(points[i], t);
    }
  }
  return points[0].clone();
}
