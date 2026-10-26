import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { dropJoin, itemSpot } from './add';
import { getPart, LEVEL_HEIGHT } from './catalog';
import { findClashes } from './clash';
import { emptyCourse, layoutCourse, type Course } from './course';
import { chain } from './presets';
import { addedBounds, addFreeTemplate, joinTemplate, TEMPLATES } from './templates';

const forward = (c: Course, piece: number, port: number) =>
  new Vector3(0, 0, 1).transformDirection(layoutCourse(c).pieces[piece].ports[port]);
const at = (c: Course, piece: number, port: number) => new Vector3().setFromMatrixPosition(layoutCourse(c).pieces[piece].ports[port]);
/** The far port of the last piece, the template's way out. */
const way = (c: Course, port: number) => ({ piece: c.pieces.length - 1, port: 1 - port });

describe('templates', () => {
  it('are made of parts in the catalogue', () => {
    for (const t of TEMPLATES) for (const p of t.pieces) expect(() => getPart(p.part)).not.toThrow();
  });

  it('join a straight in one go and build with real parts', () => {
    for (const t of TEMPLATES) {
      const joined = joinTemplate(chain(['straight']), t.id, { piece: 0, port: 1 })!;
      expect(joined.course.pieces).toHaveLength(1 + t.pieces.length);
      const layout = layoutCourse(joined.course);
      expect(layout.problems, t.id).toEqual([]);
      expect(findClashes(layout), t.id).toEqual([]);
    }
  });

  it('closes the lane change over its bridge and goes on straight ahead', () => {
    const { course, port } = joinTemplate(chain(['straight']), 'lane-change', { piece: 0, port: 1 })!;
    const layout = layoutCourse(course);
    // Both bridge approaches' upper ports meet the centre's.
    expect(layout.closures).toHaveLength(2);
    expect(layout.open).toHaveLength(2);
    const out = way(course, port);
    // Port frames face out of their piece: the way out faces on the way the straight did.
    expect(forward(course, 0, 1).dot(forward(course, out.piece, out.port))).toBeCloseTo(1, 6);
  });

  it('turns the banks round to come back level, each its own way', () => {
    const turns = ['bank-left', 'bank-right'].map((id) => {
      const { course, port } = joinTemplate(chain(['straight']), id, { piece: 0, port: 1 })!;
      const out = way(course, port);
      expect(at(course, out.piece, out.port).y).toBeCloseTo(0, 6);
      // Facing back the way it came.
      expect(forward(course, out.piece, out.port).z).toBeCloseTo(-1, 6);
      return at(course, out.piece, out.port).x;
    });
    // Left turns towards +X (screen left is world +X).
    expect(turns[0]).toBeGreaterThan(0);
    expect(turns[1]).toBeLessThan(0);
  });

  it('raises a loop joined to a port so it climbs over itself', () => {
    const { course, port } = joinTemplate(chain(['straight']), 'loop-right', { piece: 0, port: 1 })!;
    const out = way(course, port);
    expect(at(course, out.piece, out.port).y).toBeCloseTo(LEVEL_HEIGHT, -1);
    // Level again, heading on the way it came in.
    expect(forward(course, out.piece, out.port).dot(forward(course, 0, 1))).toBeCloseTo(1, 2);
  });

  it('does not join where its first part cannot', () => {
    // A bank approach's low end does not meet another's low end (#116).
    const c = chain(['bank-approach-20']);
    expect(joinTemplate(c, 'bank-left', { piece: 0, port: 0 })).toBeNull();
  });

  it('adds on its own centred on a point, a loop still climbing over itself', () => {
    const c = addFreeTemplate(emptyCourse(), 'loop-left', 300, -200);
    const [x0, x1, z0, z1] = addedBounds(c, 0);
    expect((x0 + x1) / 2).toBeCloseTo(300, 0);
    expect((z0 + z1) / 2).toBeCloseTo(-200, 0);
    const layout = layoutCourse(c);
    expect(layout.open).toHaveLength(2);
    expect(at(c, 0, 0).y).toBeCloseTo(0, 6);
    expect(at(c, 7, 1).y).toBeCloseTo(LEVEL_HEIGHT, -1);
    expect(findClashes(layout)).toEqual([]);
  });

  it('adds every template on its own as it would join a port', () => {
    for (const t of TEMPLATES) {
      const c = addFreeTemplate(chain(['straight']), t.id, 2000, 0);
      expect(c.pieces, t.id).toHaveLength(1 + t.pieces.length);
      expect(layoutCourse(c).problems, t.id).toEqual([]);
    }
  });

  it('keeps clear of the pieces there when added on its own', () => {
    const course = chain(['straight', 'straight']);
    const [x, z] = itemSpot(course, { template: 'lane-change' }, 0, 0);
    const c = addFreeTemplate(course, 'lane-change', x, z);
    expect(findClashes(layoutCourse(c))).toEqual([]);
  });

  it('joins when dropped by an open port', () => {
    const course = chain(['straight']);
    const joined = joinTemplate(course, 'bank-left', { piece: 0, port: 1 })!.course;
    const [x0, x1, z0, z1] = addedBounds(joined, 1);
    const dropped = dropJoin(course, { template: 'bank-left' }, (x0 + x1) / 2 + 20, (z0 + z1) / 2, 150);
    expect(dropped).toEqual(joined);
  });
});
