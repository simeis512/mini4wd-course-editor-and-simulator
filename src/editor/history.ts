/** Undo and redo over whole states: each edit records the state it replaced. */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(private limit: number) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }

  /** Remember `current` as an edit replaces it; anything undone is gone. */
  record(current: T): void {
    this.past.push(current);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  /** The state before `current`, or undefined when there is none. */
  undo(current: T): T | undefined {
    const prev = this.past.pop();
    if (prev !== undefined) this.future.push(current);
    return prev;
  }

  /** The state undone from `current`, or undefined when there is none. */
  redo(current: T): T | undefined {
    const next = this.future.pop();
    if (next !== undefined) this.past.push(current);
    return next;
  }
}
