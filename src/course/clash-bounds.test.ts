import { expect, it } from 'vitest';
import { findClashes } from './clash';
import { layoutCourse, type Course, type PieceRec } from './course';

/** Dense, seeded poses exercise sloping/twisted roads and multi-track parts (#87). */
function crowded(seed: number): Course {
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const parts = ['straight', 'wave', 'curve45', 'slope', 'bridge-approach', 'lane-change-center', 'free-straight'];
  const pieces = Array.from({ length: 35 }, (_, i): PieceRec => ({
    part: parts[i % parts.length],
    port: 0,
    free: null,
    pose: {
      pos: [Math.round(random() * 1600 - 800), Math.round(random() * 250), Math.round(random() * 1600 - 800)],
      rot: [Math.round(random() * 360), Math.round(random() * 60 - 30), Math.round(random() * 40 - 20)],
    },
    twist: Math.round(random() * 6 - 3),
    ...(parts[i % parts.length] === 'free-straight' ? { length: Math.round(10 + random() * 530) } : {}),
  }));
  return { v: 1, catalog: 1, pieces };
}

for (const seed of [87, 2026, 512]) {
  it(`keeps every clash and its order for dense tilted roads (seed ${seed})`, () => {
    const clashes = findClashes(layoutCourse(crowded(seed)));
    expect(clashes.some((c) => c.kind === 'interference')).toBe(true);
    expect(clashes.some((c) => c.kind === 'clearance')).toBe(true);
    expect(clashes).toMatchSnapshot();
  });
}
