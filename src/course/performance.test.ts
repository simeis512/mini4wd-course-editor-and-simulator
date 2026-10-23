import { expect, it } from 'vitest';
import { benchAddition, type BenchSize } from './bench-courses';
import { layoutCourse } from './course';
import { worldTracks } from './mesh';
import { supports, pieceHeights } from './height';
import { findClashes } from './clash';
import { stopperContacts } from './stopper-contact';
import { checkLaps } from './laps';
import { courseToBytes, encodeCourse } from './codec';

/** Compact golden hashes of the full results, captured before optimizing (#87). */
async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

for (const size of ['S', 'M', 'L'] as BenchSize[]) {
  it(`${size}: preserves checks, geometry and saved data across one-piece addition (#87)`, async () => {
    const { course, next } = benchAddition(size);
    const results = [];
    for (const c of [course, next]) {
      const layout = layoutCourse(c);
      results.push({
        tracks: await digest(worldTracks(layout)),
        supports: await digest(supports(layout)),
        heights: await digest(pieceHeights(layout)),
        clashes: await digest(findClashes(layout)),
        contacts: await digest(stopperContacts(layout)),
        laps: await digest(checkLaps(layout)),
        bytes: await digest(courseToBytes(c)),
        url: await encodeCourse(c),
      });
    }
    expect(results).toMatchSnapshot();
  }, 30000);
}
