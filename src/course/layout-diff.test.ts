import { expect, it } from 'vitest';
import { Matrix4 } from 'three';
import { layoutCourse } from './course';
import { changedPieces } from './layout-diff';
import { addPiece, deletePiece, moveGroup, setTwist, setVariant } from './edit';
import { chain } from './presets';

it('compares geometry and placement across cloned records, additions and removals (#92)', () => {
  const course = chain(['straight', 'curve45', 'straight']);
  const before = layoutCourse(course);
  expect([...changedPieces(before, layoutCourse(structuredClone(course)))]).toEqual([]);
  expect([...changedPieces(before, layoutCourse(setVariant(course, 0, 1)))]).toEqual([]);
  expect([...changedPieces(before, layoutCourse(addPiece(course, 'straight', null)))]).toEqual([3]);
  expect([...changedPieces(before, layoutCourse(deletePiece(course, 2)))]).toEqual([2]);
  expect([...changedPieces(before, layoutCourse(setTwist(course, 1, 2)))]).toEqual([1, 2]);
  const moved = moveGroup(course, new Set([0, 1, 2]), new Matrix4().makeTranslation(10, 0, 0));
  expect([...changedPieces(before, layoutCourse(moved))]).toEqual([0, 1, 2]);
});
