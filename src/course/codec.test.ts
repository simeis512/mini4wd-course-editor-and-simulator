import { describe, expect, it } from 'vitest';
import { courseFromBytes, courseFromHash, courseFromJson, courseToBytes, courseToHash, decodeCourse, encodeCourse } from './codec';
import { addAttachment, moveAttachment } from './attachments';
import { type Course, type Hose } from './course';
import { addStopper, newStopper } from './stoppers';
import { moveStart, placeStart, placeTimer } from './timing';
import { addPiece, deletePiece, flipPiece, markIntended, setLength, setShift, setVariant } from './edit';
import { splitJoint } from './joining';
import { basicOval } from './presets';
import { setTape } from './tape';

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
  c = moveStart(placeStart(c, 0, 100), { reverse: true });
  c = placeTimer(c, { piece: 2, offset: 40, side: 'right', everyLane: true });
  c = addStopper(c, { ...(newStopper('hose', -500, 300) as Hose), color: 2 });
  c = addStopper(c, { kind: 'hose', points: [[0, 0], [-30, 700]], color: 0 });
  c = addStopper(c, { kind: 'box', size: 2, x: 1200, z: -40, yaw: -37.5, upright: true });
  c = setTape(c, { floor: { kind: 'opp', width: 48, friction: 0.35 }, wall: { kind: 'cloth', width: 38, friction: 0.725, dividers: true } });
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
    expect(hash).toMatch(/^#c=9\.[A-Za-z0-9_-]+$/);
    expect(await courseFromHash(hash)).toEqual(c);
  });

  it('keeps floor tape alone, and reads format 7 links as having no tape (#133)', async () => {
    const c = setTape(basicOval(), { floor: { kind: 'curing', width: 50, friction: 0.5 } });
    expect(courseFromBytes(courseToBytes(c))).toEqual(c);
    const payload = (await encodeCourse(basicOval())).split('.')[1];
    expect((await decodeCourse(`7.${payload}`)).tape).toBeUndefined();
  });

  it('keeps wall tape off the rollers from format 9 on, and reads format 8 wall tape as it was (#133)', async () => {
    const wall = { kind: 'cloth', width: 50, friction: 0.6, dividers: true } as const;
    const short = setTape(basicOval(), { wall: { ...wall, shortInside: true } });
    expect(courseFromBytes(courseToBytes(short))).toEqual(short);
    const plain = setTape(basicOval(), { wall });
    const payload = (await encodeCourse(plain)).split('.')[1];
    expect((await decodeCourse(`8.${payload}`)).tape).toEqual({ wall });
    // Format 8 had no such flag.
    await expect(decodeCourse(`8.${(await encodeCourse(short)).split('.')[1]}`)).rejects.toThrow();
  });

  it('still reads format 1 to 5 links', async () => {
    // Each older format is the newer one without lengths, shifts, open-on-purpose marks, bends and twists in turn.
    const payload = (await encodeCourse(basicOval())).split('.')[1];
    for (const v of [1, 2, 3, 4, 5]) expect(await decodeCourse(`${v}.${payload}`)).toEqual(basicOval());
  });

  it('reads bends and twists of format 6 links in 0.1° steps, and keeps 0.01° from format 7 on (#86)', async () => {
    const c = sample();
    const rec = c.pieces.find((r) => 'to' in r)! as { bend?: { pitch?: number; yaw?: number }; twist?: number };
    rec.bend = { pitch: 0.12, yaw: -0.05 };
    rec.twist = 0.07;
    expect(courseFromBytes(courseToBytes(c))).toEqual(c);
    // The same numbers read as format 6 count tenths.
    const old = courseFromBytes(courseToBytes(c), 6).pieces[c.pieces.indexOf(rec as never)] as typeof rec;
    expect(old.bend).toEqual({ pitch: 1.2, yaw: -0.5 });
    expect(old.twist).toBeCloseTo(0.7);
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
