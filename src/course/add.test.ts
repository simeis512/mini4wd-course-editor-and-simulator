import { describe, expect, it } from 'vitest';
import { dropJoin, joinPart, nextOpenPort } from './add';
import { emptyCourse, layoutCourse, type Course } from './course';
import { addFreePiece, addPiece, footprint, setPose } from './edit';
import { chain } from './presets';

/** Middle of the last piece's footprint, world X/Z. */
const middle = (c: Course): [number, number] => {
  const layout = layoutCourse(c);
  const [x0, x1, z0, z1] = footprint(layout.pieces[layout.pieces.length - 1]);
  return [(x0 + x1) / 2, (z0 + z1) / 2];
};

describe('joinPart', () => {
  it('joins a part to an open port', () => {
    const joined = joinPart(chain(['straight']), 'curve45', { piece: 0, port: 1 });
    expect(joined?.port).toBe(0);
    expect(joined?.course.pieces[1]).toEqual({ part: 'curve45', port: 0, to: [0, 1] });
  });

  it('keeps the way round asked for', () => {
    const joined = joinPart(chain(['straight']), 'curve45', { piece: 0, port: 1 }, 1);
    expect(joined?.port).toBe(1);
    expect(joined?.course.pieces[1]).toEqual({ part: 'curve45', port: 1, to: [0, 1] });
  });

  it('turns a bank approach so its floor end lies on the level', () => {
    const climbing = joinPart(chain(['straight']), 'bank-approach-20', { piece: 0, port: 1 });
    expect(climbing?.port).toBe(0);
    expect(layoutCourse(climbing!.course).problems).toEqual([]);
  });

  it('refuses parts that cannot join', () => {
    expect(joinPart(chain(['bank-approach-20']), 'bank-approach-20', { piece: 0, port: 1 })).toBeNull();
    expect(joinPart(chain(['straight']), 'lane-change-center', { piece: 0, port: 1 })).toBeNull();
  });
});

describe('nextOpenPort', () => {
  it('is the far end of a piece just added', () => {
    expect(nextOpenPort(addPiece(emptyCourse(), 'straight', null), 0)).toEqual({ piece: 0, port: 1 });
    expect(nextOpenPort(chain(['straight', 'curve45']), 0)).toEqual({ piece: 1, port: 1 });
  });

  it('is nothing when the piece closes the loop', () => {
    const circle = chain(['curve45', 'curve45', 'curve45', 'curve45', 'curve45', 'curve45', 'curve45', 'curve45']);
    expect(nextOpenPort(circle, 0)).toBeNull();
  });
});

describe('dropJoin', () => {
  const course = chain(['straight']);

  it('joins a part dropped about where it would sit on an open port', () => {
    const [x, z] = middle(joinPart(course, 'straight', { piece: 0, port: 1 })!.course);
    const next = dropJoin(course, 'straight', undefined, x + 30, z - 30, 150);
    expect(next?.pieces[1]).toEqual({ part: 'straight', port: 0, to: [0, 1] });
  });

  it('joins nothing when dropped far from every open port', () => {
    expect(dropJoin(course, 'straight', undefined, 5000, 5000, 150)).toBeNull();
  });

  it('prefers the end that closes a gap', () => {
    // Seven curves leave one gap: the eighth closes it from either end.
    const seven = chain(['curve45', 'curve45', 'curve45', 'curve45', 'curve45', 'curve45', 'curve45']);
    const closing = joinPart(seven, 'curve45', { piece: 6, port: 1 })!.course;
    const [x, z] = middle(closing);
    const next = dropJoin(seven, 'curve45', undefined, x, z, 150);
    expect(layoutCourse(next!).open).toEqual([]);
  });
});

describe('fitLength (#69)', () => {
  /** A straight, and another placed on its own `gap` mm beyond it, facing it. */
  const gapped = (gap: number, side = 0) => {
    const c = addPiece(emptyCourse(), 'straight', null);
    return setPose(addFreePiece(c, 'straight', 0, 0, 0), 1, { pos: [side, 0, 540 + gap], rot: [0, 0, 0] });
  };

  it('makes a home-made straight joined to a port just long enough to close the gap ahead', () => {
    const joined = joinPart(gapped(333.4), 'free-straight', { piece: 0, port: 1 })!;
    expect(joined.course.pieces[2].length).toBe(333);
    const layout = layoutCourse(joined.course);
    expect(layout.open).toHaveLength(2);
    expect(layout.closures.some((c) => [c.a, c.b].some((r) => r.piece === 2))).toBe(true);
  });

  it('keeps its usual length when no port lines up within its reach', () => {
    for (const c of [gapped(700), gapped(300, 50)]) {
      const joined = joinPart(c, 'free-straight', { piece: 0, port: 1 })!;
      expect(joined.course.pieces[2]).not.toHaveProperty('length');
    }
  });
});
