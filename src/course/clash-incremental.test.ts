import { expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { findClashes } from './clash';
import { layoutCourse, type Course, type Layout } from './course';
import { addPiece, setPose, setVariant } from './edit';
import { worldTracks } from './mesh';

function crossing(height: number): Course {
  return {
    v: 1, catalog: 1,
    pieces: [
      { part: 'straight', port: 0, free: null, pose: { pos: [0, 0, 0], rot: [0, 0, 0] } },
      { part: 'straight', port: 0, free: null, pose: { pos: [-270, height, 270], rot: [90, 0, 0] } },
    ],
  };
}

function check(course: Course, previous: Layout): Layout {
  const next = layoutCourse(course, previous);
  const snapshot = JSON.stringify(findClashes(previous));
  expect(findClashes(next, previous)).toEqual(findClashes(layoutCourse(course)));
  expect(JSON.stringify(findClashes(previous))).toBe(snapshot);
  return next;
}

it('updates interference, clearance and empty results as roads move, then undo (#101)', () => {
  const course = crossing(0);
  let previous = layoutCourse(course);
  expect(findClashes(previous)[0]?.kind).toBe('interference');
  for (const height of [70, 150, 40, 0, 70]) {
    previous = check(crossing(height), previous);
    expect(findClashes(previous).map((c) => c.kind)).toEqual(
      height >= 80 ? [] : [height >= 50 ? 'clearance' : 'interference'],
    );
  }
  previous = check(setPose(course, 1, { pos: [4000, 0, 0], rot: [0, 0, 0] }), previous);
  expect(findClashes(previous)).toEqual([]);
  check(course, previous);
});

it.each([0, 70, 150])('reuses unchanged positive/negative tests after colour edits, height %i (#101)', (height) => {
  let course = addPiece(crossing(height), 'straight', null);
  course = setPose(course, 2, { pos: [0, 300, 0], rot: [0, 0, 0] });
  const previous = layoutCourse(course);
  const original = findClashes(previous);
  expect(original.map((c) => c.kind)).toEqual(height >= 80 ? [] : [height >= 50 ? 'clearance' : 'interference']);
  const next = layoutCourse(setVariant(course, 0, 1), previous);
  worldTracks(next, previous);
  const transform = vi.spyOn(Vector3.prototype, 'applyMatrix4');
  try {
    expect(findClashes(next, previous)).toEqual(original);
    // Preparing solids or testing sample points would transform vectors.
    expect(transform).not.toHaveBeenCalled();
  } finally {
    transform.mockRestore();
  }
});

it('rechecks joint exclusions even when every road is unchanged (#101)', () => {
  const course = crossing(40);
  const previous = layoutCourse(course);
  expect(findClashes(previous).map((c) => c.kind)).toEqual(['interference']);
  const joined = {
    ...previous,
    joints: [{ a: { piece: 0, port: 0 }, b: { piece: 1, port: 0 }, kind: 'link' as const, shift: 0 }],
  };
  const fullJoined = { ...layoutCourse(course), joints: joined.joints };
  const expected = findClashes(fullJoined);
  expect(expected.map((c) => c.kind)).toEqual(['clearance']);
  expect(findClashes(joined, previous)).toEqual(expected);
  const unjoined = { ...joined, joints: [] };
  expect(findClashes(unjoined, joined)).toEqual(findClashes(layoutCourse(course)));

  // A pair first visited as joined must still test interference after unlinking.
  const firstJoined = { ...layoutCourse(course), joints: joined.joints };
  findClashes(firstJoined);
  expect(findClashes({ ...firstJoined, joints: [] }, firstJoined)).toEqual(findClashes(previous));
});

it('falls back to full tests without a warmed previous layout or shared tracks (#101)', () => {
  const previous = layoutCourse(crossing(0));
  check(crossing(70), previous);
  const next = layoutCourse(crossing(150), previous);
  worldTracks(next);
  expect(findClashes(next, previous)).toEqual(findClashes(layoutCourse(crossing(150))));
  expect(findClashes(layoutCourse({ v: 1, catalog: 1, pieces: [] }), next)).toEqual([]);
});

it.each([0, 70])('keeps cached coordinates private, height %i (#101)', (height) => {
  const course = crossing(height);
  const previous = layoutCourse(course);
  const expected = findClashes(layoutCourse(course));
  const result = findClashes(previous);
  result[0].at.set(12345, 12345, 12345);
  expect(findClashes(previous)).toEqual(expected);
  const next = layoutCourse(setVariant(course, 0, 1), previous);
  expect(findClashes(next, previous)).toEqual(expected);
});
