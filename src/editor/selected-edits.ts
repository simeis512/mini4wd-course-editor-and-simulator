import type { Matrix4 } from 'three';
import { addAttachment, moveAttachment, removeAttachment } from '../course/attachments';
import { movingGroup, type Course, type Layout } from '../course/course';
import {
  ANGLE_STEP, deletePiece, flipPiece, jointBend, jointShift, moveGroup, setBend, setLength,
  setPose, setShift, setTwist, setVariant, tidyCuts, turnAboutMiddle,
} from '../course/edit';
import type { Pose } from '../course/geometry';
import { closeLoop } from '../course/close-loop';
import { asLink, joinableNear, joinPorts, splitJoint } from '../course/joining';
import { raiseRun } from '../course/raise';
import type { Selection } from './selection';

/** Values read from controls, with no DOM access in selection dispatch (#93). */
export type SelectedAction =
  | { kind: 'flip' | 'delete' | 'split' | 'join' | 'close-loop' }
  | { kind: 'move'; by: Matrix4 }
  | { kind: 'rotate'; deg: number }
  | { kind: 'twist' | 'bend'; deg: number | null; by?: number }
  | { kind: 'shift'; by: number }
  | { kind: 'raise'; intoA: boolean; count: number; rise: number }
  | { kind: 'pose'; pose: Pose }
  | { kind: 'variant'; value: number }
  | { kind: 'length'; mm: number }
  | { kind: 'attachment-add'; attachment: Parameters<typeof addAttachment>[1] }
  | { kind: 'attachment-move'; index: number; to: Parameters<typeof moveAttachment>[2] }
  | { kind: 'attachment-remove'; index: number };

export interface SelectedContext {
  course: Course;
  layout: Layout;
  selection: Selection;
  moveAlone: boolean;
}

export interface SelectedEdit {
  course: Course;
  selection: Selection;
  /** Said to the user, e.g. why nothing changed. */
  message?: string;
}

/** The sides of a raise, with a joint that merely meets first stored as a link (spec 16.3). */
export function raiseSides(course: Course, selection: Selection, intoA: boolean) {
  if (selection?.kind !== 'joint') return null;
  const [from, into] = intoA ? [selection.b, selection.a] : [selection.a, selection.b];
  return { from, into, course: asLink(course, from, into) };
}

/** Dispatch by selection; course calculations remain in course, and the input stays unchanged. */
export function editSelection(context: SelectedContext, action: SelectedAction): SelectedEdit | null {
  const { course, layout, selection: s, moveAlone } = context;
  if (!s) return null;
  const keep = (next: Course): SelectedEdit => ({ course: next, selection: s });
  if (s.kind === 'joint') {
    if (action.kind === 'split') return { course: splitJoint(course, s.a, s.b), selection: { kind: 'port', ref: s.b } };
    if (action.kind === 'bend') {
      const linked = asLink(course, s.a, s.b);
      const bend = jointBend(linked, s.a, s.b);
      return keep(setBend(linked, s.a, s.b, { ...bend, pitch: (action.deg ?? bend.pitch ?? 0) + (action.by ?? 0) }));
    }
    if (action.kind === 'shift') {
      const linked = asLink(course, s.a, s.b);
      const next = setShift(linked, s.a, s.b, jointShift(linked, s.a, s.b) + action.by);
      return next !== linked ? keep(next) : null;
    }
    if (action.kind === 'raise') {
      const sides = raiseSides(course, s, action.intoA)!;
      return keep(raiseRun(sides.course, sides.from, sides.into, action.count, action.rise));
    }
  }
  if (s.kind === 'port' && action.kind === 'join') {
    const other = joinableNear(layout, s.ref);
    return other ? { course: joinPorts(course, s.ref, other), selection: { kind: 'joint', a: s.ref, b: other } } : null;
  }
  if (s.kind !== 'piece') return null;
  const move = (by: Matrix4) => keep(tidyCuts(moveGroup(course, movingGroup(layout, s.index, moveAlone), by)));
  switch (action.kind) {
    case 'flip': return keep(flipPiece(course, s.index));
    case 'delete': return { course: deletePiece(course, s.index), selection: null };
    case 'move': return move(action.by);
    case 'rotate': return move(turnAboutMiddle(layout.pieces[s.index], action.deg));
    case 'twist': return keep(setTwist(course, s.index, (action.deg ?? course.pieces[s.index].twist ?? 0) + (action.by ?? 0)));
    case 'pose': return keep(setPose(course, s.index, action.pose));
    case 'variant': return keep(setVariant(course, s.index, action.value));
    case 'length': return keep(setLength(course, s.index, action.mm));
    case 'close-loop': {
      const result = closeLoop(course, s.index, ANGLE_STEP);
      if (result.ok) return { ...keep(result.course), message: `ループを閉じました（いちばん大きい折れ・ねじれ ${result.largest.toFixed(2)}°）` };
      if (result.reason === 'no-ends') return { ...keep(course), message: '開いた口がちょうど 2 つのときだけ閉じられます' };
      return { ...keep(course), message: `閉じられません（あと ${result.distance.toFixed(1)}mm／${result.angle.toFixed(2)}°）` };
    }
    case 'attachment-add': return keep(addAttachment(course, action.attachment, s.index));
    case 'attachment-move': return keep(moveAttachment(course, action.index, action.to));
    case 'attachment-remove': return keep(removeAttachment(course, action.index));
    default: return null;
  }
}
