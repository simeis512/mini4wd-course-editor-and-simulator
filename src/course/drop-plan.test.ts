import { expect, it } from 'vitest';
import { dropJoin, planDrop, type PaletteItem } from './add';
import { benchAddition } from './bench-courses';
import { addPiece } from './edit';

for (const item of [{ part: 'straight' }, { part: 'free-straight' }, { template: 'lane-change' }, { template: 'loop-left' }] as PaletteItem[]) {
  it(`reuses drag targets without changing the chosen course: ${JSON.stringify(item)}`, () => {
    const { course, x, z } = benchAddition('M');
    const original = structuredClone(course);
    const plan = planDrop(course, item);
    for (const [dx, dz, reach] of [[0, 0, 150], [200, 0, 400], [0, -400, 600], [2000, 2000, 150]]) {
      expect(dropJoin(course, item, x + dx, z + dz, reach, plan)).toEqual(dropJoin(course, item, x + dx, z + dz, reach));
    }
    // Editing or changing the palette item invalidates alternatives from the old drag.
    const next = addPiece(course, 'straight', plan.candidates[0] ? { piece: 0, port: 0 } : null);
    expect(dropJoin(next, item, x, z, 150, plan)).toEqual(dropJoin(next, item, x, z, 150));
    const other = { part: 'wave' };
    expect(dropJoin(course, other, x, z, 150, plan)).toEqual(dropJoin(course, other, x, z, 150));
    expect(course).toEqual(original);
  });
}
