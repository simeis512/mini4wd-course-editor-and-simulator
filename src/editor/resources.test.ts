import { expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { disposeGeometries } from './resources';

it('releases regenerated geometry while keeping cached roads and shared materials alive (#87)', () => {
  const group = new Group();
  const material = new MeshBasicMaterial();
  const road = new Mesh(new BoxGeometry(), material);
  const stand = new Mesh(new BoxGeometry(), material);
  stand.name = 'supports';
  group.add(road, stand);
  const disposeRoad = vi.spyOn(road.geometry, 'dispose');
  const disposeStand = vi.spyOn(stand.geometry, 'dispose');
  const disposeMaterial = vi.spyOn(material, 'dispose');
  disposeGeometries(group, true);
  expect(disposeRoad).not.toHaveBeenCalled();
  expect(disposeStand).toHaveBeenCalledOnce();
  expect(disposeMaterial).not.toHaveBeenCalled();
  disposeGeometries(road);
  expect(disposeRoad).toHaveBeenCalledOnce();
});
