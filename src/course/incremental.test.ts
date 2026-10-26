import { expect, it } from 'vitest';
import { Matrix4 } from 'three';
import { benchAddition, benchCourse, type BenchSize } from './bench-courses';
import { layoutCourse, type Course, type Layout } from './course';
import { addPiece, deletePiece, flipPiece, moveGroup, setPose, setTwist, setVariant } from './edit';
import { supports } from './height';
import { worldTracks } from './mesh';
import { stopperContacts } from './stopper-contact';
import { findClashes } from './clash';

/** Compare to a fresh full calculation, including coordinate/order equality (#92). */
function check(course: Course, previous: Layout): Layout {
  const next = layoutCourse(course, previous);
  const tracks = worldTracks(next, previous);
  const actual = supports(next, tracks, previous);
  const contacts = stopperContacts(next, previous);
  const clashes = findClashes(next, previous);
  const full = layoutCourse(course);
  expect(next).toEqual(full);
  expect(tracks).toEqual(worldTracks(full));
  expect(actual).toEqual(supports(full));
  expect(contacts).toEqual(stopperContacts(full));
  expect(clashes).toEqual(findClashes(full));
  return next;
}

for (const size of ['S', 'M', 'L'] as BenchSize[]) {
  it(`${size}: incremental addition, deletion, movement, twist and undo equal full calculation (#92)`, () => {
    const { course, next } = benchAddition(size);
    const original = layoutCourse(course);
    let previous = original;
    supports(previous);
    stopperContacts(previous);
    findClashes(previous);
    const snapshot = JSON.stringify(previous);
    const oldSupports = JSON.stringify(supports(previous));
    previous = check(next, previous);
    previous = check(course, previous);
    expect(JSON.stringify(original)).toBe(snapshot);
    const moved = moveGroup(course, new Set([0]), new Matrix4().makeTranslation(125, 30, -70));
    previous = check(moved, previous);
    previous = check(setTwist(moved, 2, 2.5), previous);
    previous = check(flipPiece(course, 3), previous);
    previous = check(deletePiece(course, 2), previous);
    previous = check(course, previous);
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(JSON.stringify(supports(original))).toBe(oldSupports);
    expect(JSON.stringify(supports(previous))).toBe(oldSupports);
  }, 30000);
}

it('reuses untouched tracks and supports across a distant edit and colour changes (#92)', () => {
  const course = benchCourse('L');
  const before = layoutCourse(course);
  const oldTracks = worldTracks(before);
  const oldSupports = supports(before);
  const next = check(setVariant(course, 0, 1), before);
  expect(worldTracks(next).every((t, i) => t === oldTracks[i])).toBe(true);
  expect(supports(next).every((s, i) => s === oldSupports[i])).toBe(true);
  const far = check(addPiece(course, 'straight', null), next);
  expect(worldTracks(far).slice(0, oldTracks.length)).toEqual(oldTracks);
});

it('propagates lower-road/stand changes through stacked supports, even when a stand disappears (#92)', () => {
  let course: Course = { v: 1, catalog: 1, pieces: [] };
  for (const [x, y, z, yaw] of [[0, 0, 0, 0], [0, 150, 0, 0], [0, 300, 0, 20], [50, 450, 20, -20]]) {
    course = addPiece(course, 'straight', null);
    course = setPose(course, course.pieces.length - 1, { pos: [x, y, z], rot: [yaw, 0, 0] });
  }
  let previous = layoutCourse(course);
  supports(previous);
  const initialUpper = JSON.stringify(supports(previous).filter((s) => s.piece > 0));
  let propagated = false;
  for (const x of [70, 250, 500, 0, -100, 0]) {
    const moved = setPose(course, 0, { pos: [x, 0, 30], rot: [30, 0, 0] });
    previous = check(moved, previous);
    propagated ||= JSON.stringify(supports(previous).filter((s) => s.piece > 0)) !== initialUpper;
    previous = check(course, previous);
  }
  expect(propagated).toBe(true);
  previous = check(deletePiece(course, 1), previous);
  check(course, previous);
});

it('updates contacts when stoppers and timer change, and honours explicit tracks (#92)', () => {
  const course = benchCourse('L');
  let previous = layoutCourse(course);
  supports(previous);
  stopperContacts(previous);
  const next = structuredClone(course);
  next.stoppers!.push({ kind: 'box', size: 0, x: 0, z: 0, yaw: 0 });
  next.timer = { piece: 0, offset: 100, side: 'right' };
  previous = check(next, previous);
  const changed = structuredClone(next);
  changed.stoppers!.splice(0, 1);
  changed.timer!.side = 'left';
  previous = check(changed, previous);
  const tracks = worldTracks(previous).map((t) => ({ ...t, samples: t.samples.map((s) => s.clone()) }));
  expect(supports(previous, tracks, previous)).toEqual(supports(layoutCourse(changed)));
});
