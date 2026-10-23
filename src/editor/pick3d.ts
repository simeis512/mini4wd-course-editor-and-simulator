import * as THREE from 'three';
import { JOINT_HIT, PORT_HIT, type Selection } from './selection';
import { MARKER_PICK_HEIGHT } from './marks3d';

/** Scene objects needed for picking, without owning view or gesture state (#93). */
export interface PickState {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  root: THREE.Group;
  markers: THREE.Group;
  pieces: THREE.Group[];
  props: THREE.Group[];
  toClient(world: THREE.Vector3): [number, number] | null;
}

export function raycaster(state: PickState, e: { clientX: number; clientY: number }): THREE.Raycaster {
  const r = state.canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, state.camera);
  return ray;
}

/**
 * What is under a point on the page and where: a point of the selected
 * hose, else the nearest piece, start line, timer or shown stopper.
 */
export function hitAt(state: PickState, e: { clientX: number; clientY: number }): { target: Selection; point: THREE.Vector3 } | null {
  const ray = raycaster(state, e);
  const handles = state.markers.children.filter((m) => m.userData.handle);
  const handle = ray.intersectObjects(handles, false)[0];
  if (handle) return { target: handle.object.userData.handle, point: handle.point };
  const props = state.props.filter((g) => g.visible);
  const hit = ray.intersectObjects([...state.pieces, ...props], true)[0];
  return hit ? { target: targetOf(hit.object), point: hit.point } : null;
}

/**
 * The port or joint marker nearest a point on the page, within the same
 * screen radius as the top view, so the small joint bars are as easy to
 * hit as in 2D. Ports come first. Fences of the marker's own pieces may
 * hide it; any other road in front does.
 */
export function markerNear(state: PickState, clientX: number, clientY: number): THREE.Object3D | null {
  state.root.updateMatrixWorld();
  const eye = state.camera.getWorldPosition(new THREE.Vector3());
  const ray = new THREE.Raycaster();
  for (const kind of ['port', 'joint'] as const) {
    let best: { m: THREE.Object3D; d: number } | null = null;
    for (const m of state.markers.children) {
      const data = m.userData[kind];
      if (!data) continue;
      const centre = m.localToWorld(new THREE.Vector3(0, MARKER_PICK_HEIGHT, 0));
      const q = state.toClient(centre);
      if (!q) continue;
      const d = Math.hypot(q[0] - clientX, q[1] - clientY);
      if (d >= (kind === 'port' ? PORT_HIT : JOINT_HIT) || (best && d >= best.d)) continue;
      const own = kind === 'port' ? [data.piece] : [data.a.piece, data.b.piece];
      const toward = centre.clone().sub(eye);
      ray.set(eye, toward.clone().normalize());
      ray.far = toward.length();
      const front = ray.intersectObjects(state.pieces, true).some((h) => !own.includes(pieceOf(h.object)));
      if (!front) best = { m, d };
    }
    if (best) return best.m;
  }
  return null;
}

function pieceOf(object: THREE.Object3D): number | null {
  let o: THREE.Object3D | null = object;
  while (o && o.userData.piece === undefined) o = o.parent;
  return o ? o.userData.piece : null;
}

/** The piece, start line, timer or stopper a mesh belongs to. */
function targetOf(object: THREE.Object3D): Selection {
  let o: THREE.Object3D | null = object;
  while (o && o.userData.piece === undefined && !o.userData.prop) o = o.parent;
  if (!o) return null;
  return o.userData.prop ?? { kind: 'piece', index: o.userData.piece };
}
