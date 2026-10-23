import { describe, test } from 'vitest';
import { benchAddition, type BenchSize } from './bench-courses';
import { layoutCourse } from './course';
import { worldTracks } from './mesh';
import { findClashes } from './clash';
import { stopperContacts } from './stopper-contact';
import { supports, pieceHeights } from './height';
import { checkLaps } from './laps';
import { encodeCourse } from './codec';
import { joinPart, dropJoin } from './add';

for (const size of ['S', 'M', 'L'] as BenchSize[]) {
  describe(size, () => {
    const { course, at, next, x, z } = benchAddition(size);
    const calls = { worldTracks, findClashes, stopperContacts, supports, pieceHeights, checkLaps };
    // Fixed counts bound total setup time even for a no-op (no stoppers in S/M).
    const options = { time: 0, warmupTime: 0, iterations: 20, warmupIterations: 3 };
    test('layoutCourse', async ({ bench }) => {
      await bench('layoutCourse', () => { layoutCourse(next); }).run(options);
    });
    for (const [name, call] of Object.entries(calls)) {
      test(name, async ({ bench }) => {
        let layout = layoutCourse(next);
        // Fresh data per iteration, with setup outside the timed section (#87).
        await bench(name, { beforeEach: () => { layout = layoutCourse(next); } }, () => { call(layout); }).run(options);
      }, 60000);
    }
    test('encodeCourse', async ({ bench }) => {
      await bench('encodeCourse', async () => { await encodeCourse(next); }).run(options);
    });
    test('joinPart', async ({ bench }) => {
      await bench('joinPart', () => { joinPart(course, 'straight', at); }).run(options);
    });
    test('dropJoin', async ({ bench }) => {
      await bench('dropJoin', () => { dropJoin(course, { part: 'straight' }, x, z, 150); }).run(options);
    });
  });
}
