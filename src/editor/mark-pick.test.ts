import { describe, expect, it } from 'vitest';
import { layoutCourse } from '../course/course';
import { chain } from '../course/presets';
import { joinTemplate } from '../course/templates';
import { candidates, cyclePick, markStacks, sameMark, stackLabel, type Mark } from './mark-pick';

const port = (piece: number, p = 1): Mark => ({ kind: 'port', ref: { piece, port: p } });
const joint = (a: number, b: number): Mark => ({ kind: 'joint', a: { piece: a, port: 1 }, b: { piece: b, port: 0 } });

describe('picking marks on top of each other (#146)', () => {
  it('goes through open ports first, then joints, nearest first', () => {
    const order = candidates([
      { mark: joint(1, 2), d: 2 },
      { mark: port(5), d: 9 },
      { mark: joint(3, 4), d: 1 },
      { mark: port(6), d: 4 },
    ]);
    expect(order).toEqual([port(6), port(5), joint(3, 4), joint(1, 2)]);
  });

  it('moves on to the next one when tapped again, round to the first', () => {
    const marks = [port(0), joint(1, 2), joint(3, 4)];
    expect(cyclePick(marks, null)).toEqual(port(0));
    expect(cyclePick(marks, { kind: 'piece', index: 1 })).toEqual(port(0));
    expect(cyclePick(marks, port(0))).toEqual(joint(1, 2));
    // A joint is the same whichever way round.
    expect(cyclePick(marks, { kind: 'joint', a: { piece: 2, port: 0 }, b: { piece: 1, port: 1 } })).toEqual(joint(3, 4));
    expect(cyclePick(marks, joint(3, 4))).toEqual(port(0));
    expect(cyclePick([], port(0))).toBeNull();
    expect(sameMark(port(0), port(0, 0))).toBe(false);
  });

  it('finds where a loop comes back over its own start and counts the marks there', () => {
    const joined = joinTemplate(chain(['straight']), 'loop-left', { piece: 0, port: 1 })!;
    const layout = layoutCourse(joined.course);
    const stacks = markStacks(layout);
    expect(stacks).toHaveLength(1);
    const [s] = stacks;
    // The loop's open end above, and the joint of the straight and the loop below.
    expect(s.marks.map((m) => m.kind)).toEqual(['port', 'joint']);
    expect(s.at.y).toBeGreaterThan(50);
    expect(stackLabel(s, null)).toBe('2');
    expect(stackLabel(s, s.marks[1])).toBe('2/2');
    // Hidden by the level filter, the loop's pieces leave no stack.
    expect(markStacks(layout, (piece) => piece === 0)).toHaveLength(0);
    // In 3D the open end stands above the joint, so they are not on top of each other (#158).
    expect(markStacks(layout, undefined, true)).toHaveLength(0);
    // Nothing on top of anything on a plain chain.
    expect(markStacks(layoutCourse(chain(['straight', 'straight', 'straight'])))).toHaveLength(0);
  });

  it('in 3D still counts marks that meet in space (#158)', () => {
    // A second straight on the same spot: its open ports meet the first's at the same height.
    const course = chain(['straight']);
    course.pieces.push({ ...course.pieces[0] });
    const layout = layoutCourse(course);
    const solid = markStacks(layout, undefined, true);
    expect(solid.length).toBeGreaterThan(0);
    expect(solid).toHaveLength(markStacks(layout).length);
  });
});
