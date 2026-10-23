import { Line, Mesh, type Object3D } from 'three';

/** Release per-update geometries, retaining the shared road geometry/material caches (#87). */
export function disposeGeometries(root: Object3D, piece = false): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh || object instanceof Line)) return;
    if (piece && object.name !== 'supports' && object.name !== 'attachment') return;
    object.geometry.dispose();
  });
}
