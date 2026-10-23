import { expect, it } from 'vitest';
import { layoutCourse } from './course';
import { chain } from './presets';
import { setPose, setLength } from './edit';
import { worldTracks } from './mesh';
import { supports, pieceHeights } from './height';

it('keeps old derived data intact and reads changed poses and lengths from new layouts (#87)', () => {
  const course = chain(['free-straight']);
  const before = layoutCourse(course);
  const tracks = structuredClone(worldTracks(before));
  expect(supports(before)).toEqual([]);
  const moved = setPose(setLength(course, 0, 540), 0, { pos: [-270, 220, -540], rot: [45, 0, 0] });
  const after = layoutCourse(moved);
  expect(pieceHeights(after)[0]).toEqual([220, 220]);
  expect(supports(after)).toHaveLength(2);
  expect(worldTracks(after)[0].samples.at(-1)!.elements).not.toEqual(worldTracks(before)[0].samples.at(-1)!.elements);
  expect(structuredClone(worldTracks(before))).toEqual(tracks);
  expect(supports(before)).toEqual([]);
  // Explicit track arrays must not return results computed for a different array.
  expect(supports(before, worldTracks(after))).toEqual(supports(after));
  expect(supports(before)).toEqual([]);
});
