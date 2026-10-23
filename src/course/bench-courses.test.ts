import { describe, expect, it } from 'vitest';
import { benchAddition, benchCourse, type BenchSize } from './bench-courses';
import { layoutCourse, validateCourse } from './course';
import { checkLaps } from './laps';
import { worldTracks } from './mesh';

describe('performance fixtures (#87)', () => {
  for (const [size, count] of [['S', 14], ['M', 60], ['L', 200]] as const) {
    it(`${size} is deterministic, valid and closed`, () => {
      const course = benchCourse(size);
      expect(course).toEqual(benchCourse(size));
      expect(course.pieces).toHaveLength(count);
      validateCourse(course);
      const layout = layoutCourse(course);
      expect(layout.open).toEqual([]);
      expect(layout.problems).toEqual([]);
      expect(checkLaps(layout)?.laps.every((l) => l.next !== null)).toBe(true);
    });
  }
  it('L includes crossings at different heights, hoses and boxes', () => {
    const course = benchCourse('L');
    expect(course.stoppers?.map((s) => s.kind)).toEqual(['hose', 'box', 'box']);
    const tracks = worldTracks(layoutCourse(course));
    // A raised copy follows the same X/Z road, and a perpendicular island crosses it.
    expect(tracks.some((t) => t.samples.some((f) => f.elements[13] >= 440))).toBe(true);
    const a = tracks[0].samples[0].elements;
    const b = tracks.find((t) => t.piece === 60)!.samples[0].elements;
    expect([a[12], a[14]]).toEqual([b[12], b[14]]);
    expect(b[13] - a[13]).toBeCloseTo(220);
  });
  for (const size of ['S', 'M', 'L'] as BenchSize[]) {
    it(`${size} measures adding one piece back to a cut course`, () => {
      const { course, next, at } = benchAddition(size);
      expect(next.pieces.length).toBe(course.pieces.length + 1);
      expect(layoutCourse(course).open).toContainEqual(at);
      expect(layoutCourse(next).open).toEqual([]);
    });
  }
});
