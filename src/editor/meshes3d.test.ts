import { expect, it, vi } from 'vitest';
import { Group, Mesh } from 'three';
import { benchAddition } from '../course/bench-courses';
import { layoutCourse } from '../course/course';
import { deletePiece, setPose, setVariant } from '../course/edit';
import { addAttachment } from '../course/attachments';
import { chain } from '../course/presets';
import { buildPropMeshes } from '../course/props-mesh';
import { buildCourseMeshes, buildSupportMesh } from '../course/mesh';
import { supports } from '../course/height';
import { CourseMeshes } from './meshes3d';

const positions = (root: Group | Mesh): number[] => {
  const out: number[] = [];
  root.traverse((object) => {
    if (object instanceof Mesh) out.push(...object.geometry.getAttribute('position').array);
  });
  return out;
};

it('retains unchanged groups/support meshes, matches full geometry and releases replaced objects (#92)', () => {
  const errors = vi.spyOn(console, 'error');
  const { course, next } = benchAddition('L');
  const root = new Group();
  const meshes = new CourseMeshes(root);
  const before = meshes.update(layoutCourse(course));
  const props = [...meshes.props];
  const stands = root.children.filter((o) => o.name === 'supports') as Mesh[];
  const first = stands[stands.length - 1];
  const retained = vi.spyOn(first.geometry, 'dispose');
  const after = meshes.update(layoutCourse(next));
  expect(after.slice(0, before.length).every((p, i) => p === before[i])).toBe(true);
  expect(root.children).toContain(first);
  expect(retained).not.toHaveBeenCalled();
  expect(meshes.props.every((p, i) => p === props[i])).toBe(true);
  const full = buildCourseMeshes(layoutCourse(next));
  after.forEach((mesh, i) => {
    expect(positions(mesh)).toEqual(positions(full[i]));
    expect(mesh.matrix).toEqual(full[i].matrix);
    expect(mesh.userData.piece).toBe(i);
  });
  const allStandPositions = root.children.filter((o) => o.name === 'supports').sort((a, b) => a.userData.supportPiece - b.userData.supportPiece).flatMap((o) => positions(o as Mesh));
  expect(allStandPositions).toEqual(positions(buildSupportMesh(supports(layoutCourse(next)))));
  const coloured = meshes.update(layoutCourse(setVariant(next, 0, 1)));
  expect(coloured[0]).not.toBe(after[0]);
  expect(coloured[1]).toBe(after[1]);
  const attached = meshes.update(layoutCourse(addAttachment(next, 'washboard-5', 1)));
  expect(attached[1]).not.toBe(coloured[1]);
  const attachment = attached[1].children.find((o) => o.name === 'attachment') as Mesh;
  const released = vi.spyOn(attachment.geometry, 'dispose');
  meshes.update(layoutCourse(deletePiece(next, 1)));
  expect(released).toHaveBeenCalledOnce();
  meshes.update(layoutCourse({ ...course, pieces: [], stoppers: [] }));
  expect(root.children).toHaveLength(0);
  expect(retained).toHaveBeenCalledOnce();
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

it('updates start/timer meshes when their road moves and releases changed stopper geometry (#92)', () => {
  const course = chain(['straight']);
  course.start = { piece: 0, offset: 100 };
  course.timer = { piece: 0, offset: 300, side: 'left' };
  course.stoppers = [{ kind: 'box', size: 0, x: 100, z: 100, yaw: 0 }];
  const meshes = new CourseMeshes(new Group());
  meshes.update(layoutCourse(course));
  const before = meshes.props;
  const geometry = (before[2].children[0] as Mesh).geometry;
  const disposed = vi.spyOn(geometry, 'dispose');
  const moved = setPose(course, 0, { pos: [100, 150, 200], rot: [20, 0, 0] });
  const layout = layoutCourse(moved);
  meshes.update(layout);
  expect(meshes.props[0]).not.toBe(before[0]);
  expect(meshes.props[1]).not.toBe(before[1]);
  buildPropMeshes(layout).forEach((mesh, i) => expect(positions(meshes.props[i])).toEqual(positions(mesh)));
  expect(disposed).toHaveBeenCalledOnce();
});
