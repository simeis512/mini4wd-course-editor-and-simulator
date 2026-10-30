import { describe, expect, it } from 'vitest';
import { fileName } from './share';

describe('fileName', () => {
  it('names files after the course, or "course" when it has no name', () => {
    expect(fileName('春のオーバル')).toBe('春のオーバル');
    expect(fileName('')).toBe('course');
    expect(fileName()).toBe('course');
  });

  it('replaces characters file systems refuse', () => {
    expect(fileName('A/B: "C"?')).toBe('A_B_ _C__');
    expect(fileName(' / ')).toBe('_');
  });
});
