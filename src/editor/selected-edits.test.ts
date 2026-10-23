import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { anchorFrame, layoutCourse, type Course } from '../course/course';
import { freeRec, setShift } from '../course/edit';
import { matrixToPose } from '../course/geometry';
import { chain } from '../course/presets';
import { editSelection, raiseSides, type SelectedAction } from './selected-edits';
import type { Selection } from './selection';

function edit(course: Course, selection: Selection, action: SelectedAction, moveAlone = false) {
  return editSelection({ course, selection, layout: layoutCourse(course), moveAlone }, action);
}

const joint = { kind: 'joint', a: { piece: 0, port: 1 }, b: { piece: 1, port: 0 } } as const;
const piece: Selection = { kind: 'piece', index: 0 };

describe('selection edit routing', () => {
  it('ignores commands for other selection kinds, without creating an undo entry', () => {
    const course = chain(['straight', 'straight']);
    for (const selection of [null, { kind: 'start' }, joint] as Selection[]) {
      expect(edit(course, selection, { kind: 'flip' })).toBeNull();
    }
    expect(edit(course, piece, { kind: 'bend', deg: 3 })).toBeNull();
    expect(edit(course, { kind: 'port', ref: { piece: 0, port: 0 } }, { kind: 'join' })).toBeNull();
  });

  it('moves the connected group or just the selected piece without mutating history', () => {
    const course = chain(['straight', 'straight']);
    const before = structuredClone(course);
    const original = layoutCourse(course);
    const action: SelectedAction = { kind: 'move', by: new Matrix4().makeTranslation(100, 110, 50) };
    for (const alone of [false, true]) {
      const result = edit(course, piece, action, alone)!;
      expect(result.selection).toEqual(piece);
      const moved = layoutCourse(result.course);
      for (const index of [0, 1]) {
        const delta = new Vector3().setFromMatrixPosition(moved.pieces[index].matrix)
          .sub(new Vector3().setFromMatrixPosition(original.pieces[index].matrix));
        expect(delta.distanceTo(alone && index === 1 ? new Vector3() : new Vector3(100, 110, 50))).toBeLessThan(1e-6);
      }
    }
    expect(course).toEqual(before);
  });

  it('splits to the second open port and joins back with the joint selected', () => {
    const course = chain(['straight', 'straight']);
    const split = edit(course, joint, { kind: 'split' })!;
    expect(split.selection).toEqual({ kind: 'port', ref: { piece: 1, port: 0 } });
    expect(layoutCourse(split.course).split).toHaveLength(2);
    const joined = edit(split.course, split.selection, { kind: 'join' })!;
    expect(joined.selection).toEqual({ kind: 'joint', a: { piece: 1, port: 0 }, b: { piece: 0, port: 1 } });
    expect(layoutCourse(joined.course).open).toHaveLength(2);
    expect(layoutCourse(joined.course).split).toHaveLength(0);
  });

  it('links meeting free pieces before bending their selected joint', () => {
    const course = chain(['straight', 'straight']);
    course.pieces[1] = freeRec(course.pieces[1], null, matrixToPose(anchorFrame(layoutCourse(course), 1)));
    const result = edit(course, joint, { kind: 'bend', deg: null, by: 0.5 })!;
    expect(result.course.pieces[1]).toMatchObject({ to: [0, 1], bend: { pitch: 0.5 } });
    expect(result.selection).toEqual(joint);
    expect(course.pieces[1]).not.toHaveProperty('to');
  });

  it('does not commit a shift that would disconnect every lane', () => {
    const course = setShift(chain(['straight', 'straight']), joint.a, joint.b, 2);
    expect(edit(course, joint, { kind: 'shift', by: 1 })).toBeNull();
  });

  it('keeps absolute and incremental twist edits on the same selection', () => {
    const course = chain(['straight']);
    const first = edit(course, piece, { kind: 'twist', deg: 2 })!;
    const next = edit(first.course, first.selection, { kind: 'twist', deg: null, by: -0.5 })!;
    expect(next.course.pieces[0].twist).toBe(1.5);
    expect(next.selection).toEqual(piece);
    expect(course.pieces[0].twist).toBeUndefined();
  });

  it('reverses the preview and raise together when the direction control changes', () => {
    const course = chain(['straight', 'straight', 'straight', 'straight']);
    for (const intoA of [false, true]) {
      const sides = raiseSides(course, joint, intoA)!;
      expect(sides.into.piece).toBe(intoA ? 0 : 1);
      expect(sides.from.piece).toBe(intoA ? 1 : 0);
      const result = edit(course, joint, { kind: 'raise', intoA, count: 1, rise: 20 })!;
      expect(result.selection).toEqual(joint);
      expect(result.course).not.toBe(course);
    }
    expect(raiseSides(course, piece, false)).toBeNull();
  });

  it('clears selection when deleting a piece while retaining the rest of the course', () => {
    const course = chain(['straight', 'straight']);
    const result = edit(course, piece, { kind: 'delete' })!;
    expect(result.selection).toBeNull();
    expect(result.course.pieces).toHaveLength(1);
    expect(course.pieces).toHaveLength(2);
  });
});
