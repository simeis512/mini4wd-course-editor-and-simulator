import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { GLOBAL_SPEC } from '../course/catalog';
import { MM } from '../course/mesh';
import type { Block } from '../course/blocks';
import type { FallZone, SimCourse, TriMesh } from '../course/sim-course';

/** What a course collider is, kept in the world's own lookup. */
export type CourseColliderKind = 'road' | 'fences' | 'props' | 'fall' | 'floor';

export interface CourseColliders {
  body: RAPIER.RigidBody;
  /** What each collider is, by its handle; fall zones also give the zone. */
  kinds: Map<number, { kind: CourseColliderKind; zone?: FallZone }>;
}

/** A trimesh scaled from millimetres to the world's metres. */
function trimesh(mesh: TriMesh): RAPIER.ColliderDesc | null {
  if (!mesh.indices.length) return null;
  const vertices = mesh.vertices.map((v) => v * MM);
  // The pieces' boxes meet edge to edge; merging and fixing internal edges keeps wheels from catching on the seams,
  // and with the faces' outward sides known a roller pressed into a fence is pushed back out the side it came in.
  const flags = RAPIER.TriMeshFlags.MERGE_DUPLICATE_VERTICES | RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES | RAPIER.TriMeshFlags.ORIENTED;
  return RAPIER.ColliderDesc.trimesh(vertices, mesh.indices, flags);
}

/** A box centred on its frame, scaled from millimetres to metres. */
function cuboid({ frame, size }: Pick<Block, 'frame' | 'size'>): RAPIER.ColliderDesc {
  const pos = new Vector3();
  const rot = new Quaternion();
  frame.decompose(pos, rot, new Vector3());
  const [x, y, z] = size.map((s) => (s * MM) / 2);
  return RAPIER.ColliderDesc.cuboid(x, y, z)
    .setTranslation(pos.x * MM, pos.y * MM, pos.z * MM)
    .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
}

/** How far the floor reaches past the course on every side, m. */
const FLOOR_MARGIN = 5;
const FLOOR_THICKNESS = 0.1;

/** The box round some vertices in X and Z, mm; null when there are none. */
function floorSpan(lists: readonly Float32Array[]): [number, number, number, number] | null {
  let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const vertices of lists) {
    for (let i = 0; i < vertices.length; i += 3) {
      x0 = Math.min(x0, vertices[i]);
      x1 = Math.max(x1, vertices[i]);
      z0 = Math.min(z0, vertices[i + 2]);
      z1 = Math.max(z1, vertices[i + 2]);
    }
  }
  return x0 <= x1 ? [x0, z0, x1, z1] : null;
}

/**
 * Put a course into a physics world (spec 9, #26): the road, fences and
 * props as fixed trimeshes, each fall zone as a sensor box, and the floor
 * the road lies on (#27: touching it is coming off the course). Rapier
 * must be initialised (`createPhysicsWorld`).
 */
export function addCourseColliders(world: RAPIER.World, course: SimCourse): CourseColliders {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const kinds: CourseColliders['kinds'] = new Map();
  for (const kind of ['road', 'fences', 'props'] as const) {
    const desc = trimesh(course[kind]);
    if (desc) kinds.set(world.createCollider(desc, body).handle, { kind });
  }
  for (const zone of course.fallZones) kinds.set(world.createCollider(cuboid(zone).setSensor(true), body).handle, { kind: 'fall', zone });
  const span = floorSpan([course.road.vertices, course.fences.vertices, course.props.vertices]);
  if (span) {
    const [x0, z0, x1, z1] = span.map((v) => v * MM);
    // Its top is under the road slab, where the road lies on it.
    const top = -GLOBAL_SPEC.roadThickness * MM;
    const desc = RAPIER.ColliderDesc.cuboid((x1 - x0) / 2 + FLOOR_MARGIN, FLOOR_THICKNESS / 2, (z1 - z0) / 2 + FLOOR_MARGIN)
      .setTranslation((x0 + x1) / 2, top - FLOOR_THICKNESS / 2, (z0 + z1) / 2);
    kinds.set(world.createCollider(desc, body).handle, { kind: 'floor' });
  }
  return { body, kinds };
}
