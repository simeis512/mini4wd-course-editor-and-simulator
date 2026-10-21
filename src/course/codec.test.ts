import { describe, expect, it } from 'vitest';
import { courseFromBytes, courseFromHash, courseFromJson, courseToBytes, courseToHash, decodeCourse, encodeCourse } from './codec';
import { addAttachment, moveAttachment } from './attachments';
import { type Course } from './course';
import { addPiece, deletePiece, flipPiece, markIntended, setLength, setShift, setVariant } from './edit';
import { splitJoint } from './joining';
import { basicOval } from './presets';

function sample(): Course {
  let c = basicOval();
  c = setVariant(c, 4, 1);
  c = flipPiece(c, 2);
  c = deletePiece(c, 6);
  c = splitJoint(c, { piece: 0, port: 1 }, { piece: 1, port: 0 });
  c = markIntended(c, { piece: 1, port: 0 }, true);
  c = setShift(c, { piece: 2, port: 1 }, { piece: 3, port: 0 }, -1);
  c = addPiece(c, 'free-straight', null, 1);
  c = setLength(c, c.pieces.length - 1, 123);
  c = addAttachment(c, 'washboard-10', 3, 2, 50);
  c = moveAttachment(c, 0, { reverse: true, side: 10 });
  c = moveAttachment(addAttachment(c, 'washboard-5', 3, 0, 300), 1, { wall: 'right' });
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
    expect(hash).toMatch(/^#c=5\.[A-Za-z0-9_-]+$/);
    expect(await courseFromHash(hash)).toEqual(c);
  });

  it('still reads format 1 to 4 links', async () => {
    // Each older format is the newer one without lengths, shifts, open-on-purpose marks, bends and twists in turn.
    const payload = (await encodeCourse(basicOval())).split('.')[1];
    for (const v of [1, 2, 3, 4]) expect(await decodeCourse(`${v}.${payload}`)).toEqual(basicOval());
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

describe('courseFromJson', () => {
  it('reads a course file back', () => {
    const c = sample();
    expect(courseFromJson(JSON.stringify(c, null, 2))).toEqual(c);
  });

  it('rejects files that are not courses', () => {
    expect(() => courseFromJson('{"v":2,"pieces":[]}')).toThrow('コースのファイルではありません');
    expect(() => courseFromJson('null')).toThrow('コースのファイルではありません');
    expect(() => courseFromJson('not json')).toThrow();
  });

  it('rejects unknown parts and broken references', () => {
    const unknown = { ...sample(), pieces: [{ part: 'no-such-part', at: 'origin' }] };
    expect(() => courseFromJson(JSON.stringify(unknown))).toThrow('不明なパーツ: no-such-part');
    const c = sample();
    const broken = { ...c, pieces: [...c.pieces, { part: c.pieces[0].part, port: 0, to: [99, 0] }] };
    expect(() => courseFromJson(JSON.stringify(broken))).toThrow('refers to piece 99');
  });

  it('rejects lengths a part cannot have', () => {
    const c = sample();
    const long = { ...c, pieces: [...c.pieces, { part: 'free-straight', port: 0, free: null, pose: { pos: [0, 0, 0], rot: [0, 0, 0] }, length: 9999 }] };
    expect(() => courseFromJson(JSON.stringify(long))).toThrow('cannot be 9999mm long');
    const fixed = { ...c, pieces: [...c.pieces, { part: 'straight', port: 0, free: null, pose: { pos: [0, 0, 0], rot: [0, 0, 0] }, length: 100 }] };
    expect(() => courseFromJson(JSON.stringify(fixed))).toThrow('cannot be 100mm long');
  });
});
