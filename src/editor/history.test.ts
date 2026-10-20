import { describe, expect, it } from 'vitest';
import { History } from './history';

describe('History', () => {
  it('undoes and redoes edits in order', () => {
    const h = new History<number>(10);
    h.record(1);
    h.record(2);
    expect(h.undo(3)).toBe(2);
    expect(h.undo(2)).toBe(1);
    expect(h.undo(1)).toBeUndefined();
    expect(h.redo(1)).toBe(2);
    expect(h.redo(2)).toBe(3);
    expect(h.canRedo).toBe(false);
  });

  it('forgets what was undone once a new edit is made', () => {
    const h = new History<number>(10);
    h.record(1);
    h.undo(2);
    h.record(1);
    expect(h.canRedo).toBe(false);
  });

  it('keeps at most `limit` states', () => {
    const h = new History<number>(2);
    for (const n of [1, 2, 3]) h.record(n);
    expect(h.undo(4)).toBe(3);
    expect(h.undo(3)).toBe(2);
    expect(h.canUndo).toBe(false);
  });
});
