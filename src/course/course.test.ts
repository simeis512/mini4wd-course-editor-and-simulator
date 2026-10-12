import { describe, expect, it } from 'vitest';
import { addPiece, deletePiece, emptyCourse, flipPiece, layoutCourse, partCounts, setVariant } from './course';
import { facingError } from './geometry';
import { basicOval, chain } from './presets';

describe('layoutCourse', () => {
  it('closes the basic oval with no error', () => {
    const layout = layoutCourse(basicOval());
    expect(layout.open).toEqual([]);
    expect(layout.closures).toHaveLength(1);
    const [c] = layout.closures;
    expect([c.a, c.b]).toContainEqual({ piece: 0, port: 0 });
    expect(c.distance).toBeLessThan(0.01);
    expect(c.angle).toBeLessThan(0.01);
  });

  it('closes a ring of eight curves', () => {
    const layout = layoutCourse(chain(Array(8).fill('curve45')));
    expect(layout.open).toEqual([]);
    expect(layout.closures).toHaveLength(1);
  });

  it('leaves a gap beyond tolerance open', () => {
    // Seven curves leave a 45° gap.
    const layout = layoutCourse(chain(Array(7).fill('curve45')));
    expect(layout.closures).toEqual([]);
    expect(layout.open).toHaveLength(2);
  });
});

describe('editing', () => {
  it('adds pieces at the origin and then onto a port', () => {
    let c = addPiece(emptyCourse(), 'straight', null);
    c = addPiece(c, 'curve45', { piece: 0, port: 1 });
    expect(c.pieces).toEqual([
      { part: 'straight', at: 'origin' },
      { part: 'curve45', port: 0, to: [0, 1] },
    ]);
  });

  it('turns a left curve into a right curve by flipping', () => {
    const left = layoutCourse(chain(['straight', 'curve45']));
    const right = layoutCourse(flipPiece(chain(['straight', 'curve45']), 1));
    const end = (l: typeof left) => l.open.find((r) => r.piece === 1)!;
    const lp = left.pieces[1].ports[end(left).port];
    const rp = right.pieces[1].ports[end(right).port];
    // Mirror images about the straight's centreline (x = 0).
    expect(lp.elements[12]).toBeCloseTo(-rp.elements[12], 6);
    expect(lp.elements[14]).toBeCloseTo(rp.elements[14], 6);
  });

  it('keeps pieces hanging off a flipped piece attached', () => {
    const c = flipPiece(chain(['straight', 'curve45', 'straight']), 1);
    expect(c.pieces[1]).toMatchObject({ port: 1 });
    expect(c.pieces[2]).toMatchObject({ to: [1, 0] });
    const layout = layoutCourse(c);
    const err = facingError(layout.pieces[1].ports[0], layout.pieces[2].ports[0]);
    expect(err.distance).toBeLessThan(1e-6);
  });

  it('leaves pieces after a deleted one where they were', () => {
    const before = layoutCourse(basicOval());
    const after = deletePiece(basicOval(), 3);
    expect(after.pieces).toHaveLength(13);
    expect(after.pieces[3]).toMatchObject({ part: 'curve45', free: null });
    const layout = layoutCourse(after);
    for (let i = 3; i < 13; i++) {
      const was = before.pieces[i + 1].matrix.elements;
      layout.pieces[i].matrix.elements.forEach((x, k) => expect(x).toBeCloseTo(was[k], 0));
    }
    // The far end still closes onto the start, and the gap is left open.
    expect(layout.closures).toHaveLength(1);
    expect(layout.open).toEqual([
      { piece: 2, port: 1 },
      { piece: 3, port: 0 },
    ]);
  });

  it('stores only non-default variants', () => {
    let c = setVariant(chain(['curve45']), 0, 1);
    expect(c.pieces[0].variant).toBe(1);
    c = setVariant(c, 0, 0);
    expect(c.pieces[0]).not.toHaveProperty('variant');
  });

  it('counts parts', () => {
    expect(Object.fromEntries(partCounts(basicOval()))).toEqual({ straight: 5, wave: 1, curve45: 8 });
  });
});
