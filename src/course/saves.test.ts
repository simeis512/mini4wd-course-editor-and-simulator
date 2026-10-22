import { describe, expect, it } from 'vitest';
import { carriedOver, cleanName, defaultSaveName, namesFor, offerResume, SAVE_NAME_MAX, sortSaves, uniqueName, type SavedCourse } from './saves';

const saved = (id: string, savedAt: number): SavedCourse => ({ id, name: id, data: '', savedAt, pieceCount: 1 });

describe('saved course names', () => {
  it('trims, folds spaces and cuts long names', () => {
    expect(cleanName('  my   oval ')).toBe('my oval');
    expect(cleanName('   ')).toBe('');
    expect([...cleanName('あ'.repeat(100))]).toHaveLength(SAVE_NAME_MAX);
  });

  it('numbers a name that is already taken', () => {
    expect(uniqueName('oval', [])).toBe('oval');
    expect(uniqueName('oval', ['oval'])).toBe('oval (2)');
    expect(uniqueName('oval', ['oval', 'oval (2)'])).toBe('oval (3)');
  });

  it("offers the course's name, else the date", () => {
    const day = new Date(2026, 9, 2);
    expect(defaultSaveName('Shop course', day, [])).toBe('Shop course');
    expect(defaultSaveName(undefined, day, [])).toBe('コース 2026/10/02');
    expect(defaultSaveName('', day, ['コース 2026/10/02'])).toBe('コース 2026/10/02 (2)');
  });
});

describe('saved course list', () => {
  it('lists the newest first', () => {
    expect(sortSaves([saved('a', 1), saved('b', 3), saved('c', 2)]).map((s) => s.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('offering to resume', () => {
  const left = { data: 'x', savedAt: 1, pieceCount: 4 };
  it('asks when the last session left a course and the URL has none', () => {
    expect(offerResume(left, false, 'fresh')).toBe(true);
  });
  it('does not ask over a course in the URL, an empty course or the fresh start', () => {
    expect(offerResume(left, true, 'fresh')).toBe(false);
    expect(offerResume(undefined, false, 'fresh')).toBe(false);
    expect(offerResume({ ...left, pieceCount: 0 }, false, 'fresh')).toBe(false);
    expect(offerResume(left, false, 'x')).toBe(false);
  });
});

describe('namesFor', () => {
  const saves = [
    { ...saved('a', 1), name: 'オーバル', data: 'X' },
    { ...saved('b', 3), name: '練習', data: 'Y' },
    { ...saved('c', 2), name: '練習', data: 'X' },
  ];

  it('takes the save the course is first', () => {
    expect(namesFor(saves, 'a', 'Y').current).toBe('オーバル');
  });

  it('else the newest save holding the same course', () => {
    expect(namesFor(saves, null, 'X').current).toBe('練習');
    expect(namesFor(saves, 'gone', 'Z').current).toBe('');
  });

  it('lists every name once, newest first', () => {
    expect(namesFor(saves, null, '').names).toEqual(['練習', 'オーバル']);
  });
});

describe('carriedOver', () => {
  const autosave = { data: 'X', savedAt: 1, pieceCount: 3, savedId: 'a', dirty: true };

  it('keeps the save and its unsaved changes when the URL holds the course the last session left', () => {
    expect(carriedOver(autosave, 'X')).toEqual({ savedId: 'a', dirty: true });
    expect(carriedOver({ ...autosave, savedId: undefined }, 'X')).toEqual({ savedId: null, dirty: true });
    expect(carriedOver({ ...autosave, dirty: undefined }, 'X')).toEqual({ savedId: 'a', dirty: false });
  });

  it('carries nothing for any other course', () => {
    expect(carriedOver(autosave, 'Y')).toEqual({ savedId: null, dirty: false });
    expect(carriedOver(undefined, 'X')).toEqual({ savedId: null, dirty: false });
  });
});
