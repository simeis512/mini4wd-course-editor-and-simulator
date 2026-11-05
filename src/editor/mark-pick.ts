import { Vector3 } from 'three';
import { portKey, sameJoint, type Layout, type PortRef } from '../course/course';
import type { Selection } from './selection';

// Picking among marks that lie on top of each other (#146, owner
// 2026-11-05): open ports and joints under the pointer are candidates, and
// tapping the same place again moves on to the next one. Marks that share a
// place on the floor plan get a small count, so that it shows there is more
// than one. Both views use these.

/** A mark the pointer can pick: an open port or a joint. */
export type Mark = Extract<Selection, { kind: 'port' | 'joint' }>;

/** A mark under the pointer and how far it is from it, px. */
export interface MarkHit {
  mark: Mark;
  d: number;
}

/**
 * Marks at most this far apart on the floor plan, mm, count as one stack
 * (#146, provisional): where a loop comes back over its own start, say.
 */
export const STACK_MM = 30;

export function sameMark(a: Selection, b: Selection): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'port' && b.kind === 'port') return portKey(a.ref) === portKey(b.ref);
  if (a.kind === 'joint' && b.kind === 'joint') return sameJoint(a, b);
  return false;
}

/** The candidates in the order a tap goes through them: open ports first, then joints, nearest first in each. */
export function candidates(hits: readonly MarkHit[]): Mark[] {
  const rank = (h: MarkHit) => (h.mark.kind === 'port' ? 0 : 1);
  return [...hits].sort((x, y) => rank(x) - rank(y) || x.d - y.d).map((h) => h.mark);
}

/**
 * What a tap picks among the candidates: the one after the current
 * selection when it is one of them (round to the first again), else the
 * first; null when there are none, so that the views look further.
 */
export function cyclePick(marks: readonly Mark[], current: Selection): Mark | null {
  if (!marks.length) return null;
  const i = marks.findIndex((m) => sameMark(m, current));
  return marks[(i + 1) % marks.length];
}

/** A place where more than one mark lies, with the marks in tapping order and where to show the count (mm). */
export interface Stack {
  marks: Mark[];
  at: Vector3;
}

/** Where a mark is, mm: a joint at its first port. */
function markAt(layout: Layout, ref: PortRef): Vector3 {
  return new Vector3().setFromMatrixPosition(layout.pieces[ref.piece].ports[ref.port]);
}

/**
 * The places where marks lie on top of each other on the floor plan,
 * whatever their heights; `shown` leaves out pieces hidden by the level
 * filter. The highest mark of a stack is where its count goes.
 */
export function markStacks(layout: Layout, shown: (piece: number) => boolean = () => true): Stack[] {
  const all: { mark: Mark; at: Vector3 }[] = [
    ...layout.open.filter((r) => shown(r.piece)).map((ref) => ({ mark: { kind: 'port', ref } as Mark, at: markAt(layout, ref) })),
    ...layout.joints
      .filter((j) => shown(j.a.piece) || shown(j.b.piece))
      .map((j) => ({ mark: { kind: 'joint', a: j.a, b: j.b } as Mark, at: markAt(layout, j.a) })),
  ];
  const taken = new Set<number>();
  const stacks: Stack[] = [];
  all.forEach((_, i) => {
    if (taken.has(i)) return;
    const group = [i];
    // Grow the group with anything near any of its marks.
    for (let k = 0; k < group.length; k++) {
      all.forEach((o, j) => {
        if (taken.has(j) || group.includes(j)) return;
        const p = all[group[k]].at;
        if (Math.hypot(o.at.x - p.x, o.at.z - p.z) <= STACK_MM) group.push(j);
      });
    }
    for (const j of group) taken.add(j);
    if (group.length < 2) return;
    const members = group.map((j) => all[j]);
    const top = members.reduce((a, b) => (b.at.y > a.at.y ? b : a));
    // Tapping order: ports, then joints; nearness does not apply here, so keep the course's order.
    const marks = candidates(members.map((x, n) => ({ mark: x.mark, d: n })));
    stacks.push({ marks, at: top.at.clone() });
  });
  return stacks;
}

/** The count to show on a stack: how many marks, or which of them is selected. */
export function stackLabel(stack: Stack, selection: Selection): string {
  const i = stack.marks.findIndex((m) => sameMark(m, selection));
  return i < 0 ? `${stack.marks.length}` : `${i + 1}/${stack.marks.length}`;
}
