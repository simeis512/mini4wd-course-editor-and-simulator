import { describe, expect, it } from 'vitest';
import { isNewer, markSeen, parseChangelog, updateMark } from './changelog';

const LOG = `# 更新履歴

前書き

## v0.2.0（2026-10-20）

- 追加：二つ目（#3）
- 修正：直した（#4）

## v0.1.0（2026-10-16）

- 追加：最初（#2）
`;

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('changelog (#137)', () => {
  it('reads the versions newest first with their lines', () => {
    expect(parseChangelog(LOG)).toEqual([
      { version: '0.2.0', date: '2026-10-20', lines: ['追加：二つ目（#3）', '修正：直した（#4）'] },
      { version: '0.1.0', date: '2026-10-16', lines: ['追加：最初（#2）'] },
    ]);
  });

  it('compares versions part by part', () => {
    expect(isNewer('0.10.0', '0.9.3')).toBe(true);
    expect(isNewer('0.9.3', '0.9.3')).toBe(false);
    expect(isNewer('0.9.2', '0.9.3')).toBe(false);
    expect(isNewer('1.0.0', '0.29.0')).toBe(true);
  });

  it('marks the "i" button only after an update, until the panel is opened', () => {
    const s = memory();
    expect(updateMark('0.29.0', s)).toBe(false);
    expect(updateMark('0.29.0', s)).toBe(false);
    expect(updateMark('0.30.0', s)).toBe(true);
    markSeen('0.30.0', s);
    expect(updateMark('0.30.0', s)).toBe(false);
  });
});
