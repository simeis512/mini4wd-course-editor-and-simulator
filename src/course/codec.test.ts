import { describe, expect, it } from 'vitest';
import { courseFromBytes, courseFromHash, courseToBytes, courseToHash, decodeCourse, encodeCourse } from './codec';
import { deletePiece, flipPiece, setVariant, type Course } from './course';
import { basicOval } from './presets';

function sample(): Course {
  let c = basicOval();
  c = setVariant(c, 4, 1);
  c = flipPiece(c, 2);
  c = deletePiece(c, 6);
  return { ...c, name: 'テストコース', dir: -1 };
}

describe('codec', () => {
  it('round-trips through bytes', () => {
    const c = sample();
    expect(courseFromBytes(courseToBytes(c))).toEqual(c);
  });

  it('round-trips through the URL hash', async () => {
    const c = sample();
    const hash = await courseToHash(c);
    expect(hash).toMatch(/^#c=1\.[A-Za-z0-9_-]+$/);
    expect(await courseFromHash(hash)).toEqual(c);
  });

  it('keeps the basic oval short', async () => {
    const value = await encodeCourse(basicOval());
    expect(value.length).toBeLessThan(70);
  });

  it('returns null when the hash has no course', async () => {
    expect(await courseFromHash('')).toBeNull();
    expect(await courseFromHash('#x=1')).toBeNull();
  });

  it('rejects broken data', async () => {
    await expect(decodeCourse('9.AAAA')).rejects.toThrow();
    await expect(decodeCourse('1.AAAA')).rejects.toThrow();
    // A piece pointing forwards at a later piece.
    const bad = courseToBytes(basicOval());
    const tampered = courseToBytes({ ...basicOval(), pieces: [{ part: 'straight', port: 0, to: [3, 0] }] });
    expect(() => courseFromBytes(tampered)).toThrow();
    expect(() => courseFromBytes(bad.subarray(0, bad.length - 1))).toThrow();
  });
});
