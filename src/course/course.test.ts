import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { addPiece, compatible, deletePiece, emptyCourse, flipPiece, layoutCourse, partCounts, setVariant } from './course';
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

describe('banks', () => {
  const up = (m: Matrix4) => new Vector3(0, 1, 0).transformDirection(m);
  const forward = (m: Matrix4) => new Vector3(0, 0, 1).transformDirection(m);
  const right = (m: Matrix4) => new Vector3(-1, 0, 0).transformDirection(m);
  const pos = (m: Matrix4) => new Vector3().setFromMatrixPosition(m);
  const sin20 = Math.sin((20 * Math.PI) / 180);

  /** Straight, bank approach, U-turn of four right-hand curves, bank approach reversed, straight. */
  function bankedUTurn() {
    let c = chain(['straight', 'bank-approach-20', 'curve45', 'curve45', 'curve45', 'curve45', 'bank-approach-20', 'straight']);
    for (const i of [2, 3, 4, 5, 6]) c = flipPiece(c, i);
    return layoutCourse(c);
  }

  it('ends the bank approach climbing at 20° without leaning', () => {
    const top = layoutCourse(chain(['straight', 'bank-approach-20'])).pieces[1].ports[1];
    expect(forward(top).y).toBeCloseTo(sin20, 9);
    expect(right(top).y).toBeCloseTo(0, 9);
  });

  it('banks the middle of the U-turn 20° with the inside low', () => {
    const layout = bankedUTurn();
    // Halfway round, after two curves.
    const mid = layout.pieces[3].ports[0]; // flipped, so port 0 is the far end
    expect(forward(mid).y).toBeCloseTo(0, 9);
    expect(right(mid).y).toBeCloseTo(-sin20, 9);
  });

  it('accepts the banked U-turn as buildable', () => {
    expect(bankedUTurn().problems).toEqual([]);
  });

  it('flags a bank approach put on the floor upside down', () => {
    const c = flipPiece(chain(['straight', 'bank-approach-20']), 1);
    expect(layoutCourse(c).problems).toEqual([{ kind: 'not-level', piece: 1, port: 0 }]);
  });

  it('does not join two bank approaches', () => {
    const layout = layoutCourse(chain(['straight', 'bank-approach-20', 'bank-approach-20']));
    expect(compatible(layout.pieces[1].part, 1, layout.pieces[2].part, 0)).toBe(false);
    expect(layout.problems).toContainEqual({ kind: 'cannot-join', piece: 2, port: 0 });
  });

  it('comes back down level at the height it started', () => {
    const layout = bankedUTurn();
    const start = layout.pieces[0].ports[0];
    const end = layout.pieces[7].ports[1];
    expect(up(end).angleTo(new Vector3(0, 1, 0))).toBeLessThan(1e-9);
    expect(forward(end).z).toBeCloseTo(-1, 9);
    expect(pos(end).y).toBeCloseTo(pos(start).y, 6);
  });
});

describe('slopes', () => {
  const up = (m: Matrix4) => new Vector3(0, 1, 0).transformDirection(m);
  const pos = (m: Matrix4) => new Vector3().setFromMatrixPosition(m);
  const levelAngle = (m: Matrix4) => up(m).angleTo(new Vector3(0, 1, 0));

  it('climbs 110 mm and ends level', () => {
    const layout = layoutCourse(chain(['straight', 'slope-a', 'slope-b', 'straight']));
    const start = layout.pieces[0].ports[0];
    const top = layout.pieces[3].ports[1];
    expect(pos(top).y - pos(start).y).toBeCloseTo(110, 6);
    expect(levelAngle(top)).toBeLessThan(1e-9);
    expect(layout.problems).toEqual([]);
  });

  it('comes back down to the floor with the pieces turned round', () => {
    // Up, along the top, then down: the upper piece first, the lower one reversed.
    let c = chain(['straight', 'slope-a', 'slope-b', 'straight', 'slope-b', 'slope-a', 'straight']);
    c = flipPiece(c, 5);
    const layout = layoutCourse(c);
    const end = layout.pieces[6].ports[1];
    expect(pos(end).y).toBeCloseTo(0, 6);
    expect(levelAngle(end)).toBeLessThan(1e-9);
    expect(layout.problems).toEqual([]);
  });

  it('flags the lower piece put on the floor the wrong way round', () => {
    const c = flipPiece(chain(['straight', 'slope-a']), 1);
    expect(layoutCourse(c).problems).toEqual([{ kind: 'not-level', piece: 1, port: 0 }]);
  });
});
