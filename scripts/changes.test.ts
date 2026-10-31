import { describe, expect, it } from 'vitest';
import { bump, checkPr, compile, formatVersion, parseFragment } from './changes.mjs';

const fragment = (head: string, body = '- 追加：横から見る視点') => `---\n${head}\n---\n\n${body}\n`;

describe('changelog fragments (#137)', () => {
  it('reads the type, the URL format and the lines', () => {
    expect(parseFragment(fragment('type: feat\nurl-format: 8'))).toEqual({ type: 'feat', urlFormat: 8, lines: ['追加：横から見る視点'] });
    expect(parseFragment(fragment('type: none', ''))).toEqual({ type: 'none', urlFormat: null, lines: [] });
  });

  it('refuses unknown types, lines of no kind, and a feat that says nothing', () => {
    expect(() => parseFragment(fragment('type: docs'))).toThrow(/type/);
    expect(() => parseFragment(fragment('type: fix', '- 直した'))).toThrow(/追加／修正/);
    expect(() => parseFragment(fragment('type: feat', ''))).toThrow(/1 行以上/);
    expect(() => parseFragment('- 追加：x')).toThrow(/---/);
  });

  it('bumps the minor for a feature, the patch for a fix, nothing otherwise', () => {
    expect(bump('0.29.3', 'feat')).toBe('0.30.0');
    expect(bump('0.29.3', 'fix')).toBe('0.29.4');
    expect(bump('0.29.3', 'none')).toBe('0.29.3');
  });
});

describe('compile (#137)', () => {
  const start = compile('', '0.1.0', [{ pr: 2, type: 'feat', urlFormat: null, lines: ['追加：最初'] }], '2026-10-16');

  it('puts the newest version first, oldest PR first, with its date and PR', () => {
    const { text, version } = compile(start.text, start.version, [
      { pr: 12, type: 'fix', urlFormat: null, lines: ['修正：あと'] },
      { pr: 10, type: 'feat', urlFormat: 8, lines: ['追加：さき'] },
    ], '2026-11-01');
    expect(version).toBe('0.3.1');
    const heads = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(heads).toEqual(['v0.3.1（2026-11-01）', 'v0.3.0（2026-11-01）', 'v0.2.0（2026-10-16）']);
    expect(text).toContain('- 追加：さき（#10）\n- 共有 URL：形式を 8 にしました');
    expect(text.startsWith('# 更新履歴')).toBe(true);
  });

  it('adds lines with no new version to the newest one, and leaves no trace of the rest', () => {
    const { text, version } = compile(start.text, start.version, [
      { pr: 5, type: 'none', urlFormat: null, lines: ['その他：速くなりました'] },
      { pr: 6, type: 'none', urlFormat: null, lines: [] },
    ], '2026-11-01');
    expect(version).toBe('0.2.0');
    expect(text).toContain('- 追加：最初（#2）\n- その他：速くなりました（#5）\n');
    expect(text).not.toContain('#6');
    // Compiling again does not pile up blank lines.
    expect(compile(text, version, [], 'x').text).toBe(text);
  });
});

describe('checkPr (#137)', () => {
  const base = { pr: '9', changed: ['src/a.ts'], fragment: fragment('type: feat'), oldFormat: 7, newFormat: 7 };

  it('needs a fragment when code users see changes, not for documents only', () => {
    expect(checkPr(base)).toEqual([]);
    expect(checkPr({ ...base, fragment: null })[0]).toMatch(/changes\/9\.md がありません/);
    expect(checkPr({ ...base, fragment: null, changed: ['README.md', 'docs/perf.md'] })).toEqual([]);
  });

  it('needs the new URL format written when FORMAT_VERSION changes', () => {
    expect(checkPr({ ...base, newFormat: 8 })[0]).toMatch(/url-format: 8/);
    expect(checkPr({ ...base, newFormat: 8, fragment: fragment('type: feat\nurl-format: 8') })).toEqual([]);
  });

  it('finds FORMAT_VERSION in the codec', () => {
    expect(formatVersion('export const FORMAT_VERSION = 7;')).toBe(7);
  });
});
