import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { MM } from '../course/mesh';
import type { FallZone, SimCourse, TriMesh } from '../course/sim-course';

/** What a course collider is, kept in the world's own lookup. */
export type CourseColliderKind = 'road' | 'fences' | 'props' | 'fall';

export interface CourseColliders {
  body: RAPIER.RigidBody;
  /** What each collider is, by its handle; fall zones also give the zone. */
  kinds: Map<number, { kind: CourseColliderKind; zone?: FallZone }>;
}

/** A trimesh scaled from millimetres to the world's metres. */
function trimesh(mesh: TriMesh): RAPIER.ColliderDesc | null {
  if (!mesh.indices.length) return null;
  const vertices = mesh.vertices.map((v) => v * MM);
  // The pieces' boxes meet edge to edge; merging and fixing internal edges keeps wheels from catching on the seams.
  const flags = RAPIER.TriMeshFlags.MERGE_DUPLICATE_VERTICES | RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES;
  return RAPIER.ColliderDesc.trimesh(vertices, mesh.indices, flags);
}

/**
 * Put a course into a physics world (spec 9, #26): the road, fences and
 * props as fixed trimeshes and each fall zone as a sensor box. Rapier must
 * be initialised (`createPhysicsWorld`).
 */
export function addCourseColliders(world: RAPIER.World, course: SimCourse): CourseColliders {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const kinds: CourseColliders['kinds'] = new Map();
  for (const kind of ['road', 'fences', 'props'] as const) {
    const desc = trimesh(course[kind]);
    if (desc) kinds.set(world.createCollider(desc, body).handle, { kind });
  }
  const pos = new Vector3();
  const rot = new Quaternion();
  const scale = new Vector3();
  for (const zone of course.fallZones) {
    zone.frame.decompose(pos, rot, scale);
    const [x, y, z] = zone.size.map((s) => (s * MM) / 2);
    const desc = RAPIER.ColliderDesc.cuboid(x, y, z)
      .setTranslation(pos.x * MM, pos.y * MM, pos.z * MM)
      .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
      .setSensor(true);
    kinds.set(world.createCollider(desc, body).handle, { kind: 'fall', zone });
  }
  return { body, kinds };
}
