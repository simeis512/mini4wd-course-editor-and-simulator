import { ATTACHMENT_CODES, CATALOG_VERSION, hasPart, PART_CODES } from './catalog';
import { validateCourse, type Attachment, type Course, type PieceRec } from './course';
import { isZeroBend } from './flex';

/**
 * Course ⇄ URL hash (spec 6): `#c=<format>.<payload>`, where the payload is
 * a compact binary course, deflate-raw compressed and base64url encoded.
 *
 * Format 5, all integers as LEB128 varints (signed ones zigzag encoded):
 *   catalog version
 *   flags: bit0 dir = -1, bit1 has name, bit2 has split marks,
 *          bit3 has ports left open on purpose, bit4 has attachments
 *   [name: byte length, UTF-8]
 *   piece count
 *   per piece:
 *     part code (index into PART_CODES)
 *     head: bits0-1 anchor (0 origin, 1 to, 2 free in world, 3 free from port),
 *           bit2 has variant, bit3 has bend, bit4 has twist, bit5 has shift,
 *           bit6 has length
 *     [variant]
 *     [port]                         unless origin
 *     [piece, port]                  to / free from port
 *     [pitch, yaw (0.1°)]            bend of a `to` joint (spec 16.5)
 *     [shift (lanes)]                sideways shift of a `to` joint (#60)
 *     [x, y, z (0.1 mm), yaw, pitch, roll (0.1°)]  free
 *     [twist (0.1°)]                 (spec 16.5)
 *     [length (mm)]                  of a home-made straight (#69)
 *   [split mark count, then piece, port for each]  when flagged
 *   [open-on-purpose mark count, then piece, port for each]  when flagged (#13)
 *   [attachment count, then for each: kind (index into ATTACHMENT_CODES),
 *    piece, lane, offset (mm), side (mm, signed),
 *    flags: bit0 reversed, bit1 on a fence, bit2 the right one]  when flagged (spec 4)
 *
 * Format 4 is the same without lengths and attachments, format 3 also without shifts,
 * format 2 also without the open-on-purpose marks, and format 1 without
 * bends and twists too, so all still read.
 */
export const FORMAT_VERSION = 5;
/** Older formats that still read. */
const READABLE_VERSIONS = [1, 2, 3, 4, FORMAT_VERSION];
export const HASH_KEY = 'c';

class Writer {
  bytes: number[] = [];
  uint(n: number): void {
    if (!Number.isInteger(n) || n < 0) throw new RangeError(`not a uint: ${n}`);
    while (n >= 0x80) {
      this.bytes.push((n % 0x80) | 0x80);
      n = Math.floor(n / 0x80);
    }
    this.bytes.push(n);
  }
  int(n: number): void {
    this.uint(n >= 0 ? n * 2 : -n * 2 - 1);
  }
  tenths(x: number): void {
    this.int(Math.round(x * 10));
  }
}

class Reader {
  pos = 0;
  constructor(private bytes: Uint8Array) {}
  uint(): number {
    let n = 0;
    let scale = 1;
    for (;;) {
      if (this.pos >= this.bytes.length) throw new Error('truncated course data');
      const b = this.bytes[this.pos++];
      n += (b & 0x7f) * scale;
      if (b < 0x80) return n;
      scale *= 0x80;
      if (scale > 2 ** 49) throw new Error('varint too long');
    }
  }
  int(): number {
    const u = this.uint();
    return u % 2 === 0 ? u / 2 : -(u + 1) / 2;
  }
  tenths(): number {
    return this.int() / 10;
  }
  take(n: number): Uint8Array {
    if (this.pos + n > this.bytes.length) throw new Error('truncated course data');
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
}

export function courseToBytes(course: Course): Uint8Array {
  const w = new Writer();
  w.uint(course.catalog);
  const cuts = course.cuts ?? [];
  const intended = course.intended ?? [];
  const attachments = course.attachments ?? [];
  w.uint((course.dir === -1 ? 1 : 0) | (course.name ? 2 : 0) | (cuts.length ? 4 : 0) | (intended.length ? 8 : 0) | (attachments.length ? 16 : 0));
  if (course.name) {
    const name = new TextEncoder().encode(course.name);
    w.uint(name.length);
    w.bytes.push(...name);
  }
  w.uint(course.pieces.length);
  for (const rec of course.pieces) {
    const code = PART_CODES.indexOf(rec.part);
    if (code < 0) throw new Error(`part has no code: ${rec.part}`);
    w.uint(code);
    const anchor = 'at' in rec ? 0 : 'to' in rec ? 1 : rec.free ? 3 : 2;
    const bend = 'to' in rec && !isZeroBend(rec.bend) ? rec.bend! : null;
    const shift = 'to' in rec ? (rec.shift ?? 0) : 0;
    const length = rec.length !== undefined ? 64 : 0;
    w.uint(anchor | (rec.variant !== undefined ? 4 : 0) | (bend ? 8 : 0) | (rec.twist ? 16 : 0) | (shift ? 32 : 0) | length);
    if (rec.variant !== undefined) w.uint(rec.variant);
    if ('port' in rec) w.uint(rec.port);
    if ('to' in rec) {
      w.uint(rec.to[0]);
      w.uint(rec.to[1]);
      if (bend) {
        w.tenths(bend.pitch ?? 0);
        w.tenths(bend.yaw ?? 0);
      }
      if (shift) w.int(shift);
    } else if ('free' in rec) {
      if (rec.free) {
        w.uint(rec.free[0]);
        w.uint(rec.free[1]);
      }
      for (const x of rec.pose.pos) w.tenths(x);
      for (const x of rec.pose.rot) w.tenths(x);
    }
    if (rec.twist) w.tenths(rec.twist);
    if (rec.length !== undefined) w.uint(rec.length);
  }
  for (const marks of [cuts, intended]) {
    if (!marks.length) continue;
    w.uint(marks.length);
    for (const [piece, port] of marks) {
      w.uint(piece);
      w.uint(port);
    }
  }
  if (attachments.length) {
    w.uint(attachments.length);
    for (const a of attachments) {
      const code = ATTACHMENT_CODES.indexOf(a.kind);
      if (code < 0) throw new Error(`attachment has no code: ${a.kind}`);
      for (const n of [code, a.piece, a.lane, Math.round(a.offset)]) w.uint(n);
      w.int(Math.round(a.side));
      w.uint((a.reverse ? 1 : 0) | (a.wall ? 2 : 0) | (a.wall === 'right' ? 4 : 0));
    }
  }
  return new Uint8Array(w.bytes);
}

export function courseFromBytes(bytes: Uint8Array): Course {
  const r = new Reader(bytes);
  const catalog = r.uint();
  if (catalog > CATALOG_VERSION) throw new Error('このコースは新しい版のアプリで作られています');
  const flags = r.uint();
  const course: Course = { v: 1, catalog: CATALOG_VERSION, pieces: [] };
  if (flags & 1) course.dir = -1;
  if (flags & 2) course.name = new TextDecoder().decode(r.take(r.uint()));
  const count = r.uint();
  for (let i = 0; i < count; i++) {
    const part = PART_CODES[r.uint()];
    if (!part) throw new Error(`piece ${i}: unknown part code`);
    const head = r.uint();
    const variant = head & 4 ? r.uint() : undefined;
    const anchor = head & 3;
    let rec: PieceRec;
    if (anchor === 0) {
      rec = { part, at: 'origin' };
    } else {
      const port = r.uint();
      if (anchor === 1) {
        rec = { part, port, to: [r.uint(), r.uint()] };
        if (head & 8) {
          const [pitch, yaw] = [r.tenths(), r.tenths()];
          rec.bend = {};
          if (pitch) rec.bend.pitch = pitch;
          if (yaw) rec.bend.yaw = yaw;
        }
        if (head & 32) rec.shift = r.int();
      } else {
        const free: [number, number] | null = anchor === 3 ? [r.uint(), r.uint()] : null;
        const pos: [number, number, number] = [r.tenths(), r.tenths(), r.tenths()];
        const rot: [number, number, number] = [r.tenths(), r.tenths(), r.tenths()];
        rec = { part, port, free, pose: { pos, rot } };
      }
    }
    if (variant !== undefined) rec.variant = variant;
    if (head & 16) rec.twist = r.tenths();
    if (head & 64) rec.length = r.uint();
    course.pieces.push(rec);
  }
  const marks = (): [number, number][] => Array.from({ length: r.uint() }, () => [r.uint(), r.uint()]);
  if (flags & 4) course.cuts = marks();
  if (flags & 8) course.intended = marks();
  if (flags & 16) {
    course.attachments = Array.from({ length: r.uint() }, () => {
      const kind = ATTACHMENT_CODES[r.uint()];
      if (!kind) throw new Error('unknown attachment code');
      const a: Attachment = { kind, piece: r.uint(), lane: r.uint(), offset: r.uint(), side: r.int() };
      const flags = r.uint();
      if (flags & 1) a.reverse = true;
      if (flags & 2) a.wall = flags & 4 ? 'right' : 'left';
      return a;
    });
  }
  if (r.pos !== bytes.length) throw new Error('unexpected data after course');
  validateCourse(course);
  return course;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Encode a course as the value of the `c` hash parameter. */
export async function encodeCourse(course: Course): Promise<string> {
  const packed = await pipe(courseToBytes(course), new CompressionStream('deflate-raw'));
  return `${FORMAT_VERSION}.${toBase64Url(packed)}`;
}

export async function decodeCourse(value: string): Promise<Course> {
  const dot = value.indexOf('.');
  const version = Number(value.slice(0, dot));
  if (dot < 0 || !Number.isInteger(version)) throw new Error('コースURLの形式が正しくありません');
  if (!READABLE_VERSIONS.includes(version)) throw new Error(`未対応のコース形式です（版 ${version}）`);
  const bytes = await pipe(fromBase64Url(value.slice(dot + 1)), new DecompressionStream('deflate-raw'));
  return courseFromBytes(bytes);
}

/** `#c=...` for a course, or an empty string for an empty course. */
export async function courseToHash(course: Course): Promise<string> {
  return course.pieces.length === 0 && !course.name ? '' : `#${HASH_KEY}=${await encodeCourse(course)}`;
}

/** The course in a location hash, or null when there is none. */
export async function courseFromHash(hash: string): Promise<Course | null> {
  const value = new URLSearchParams(hash.replace(/^#/, '')).get(HASH_KEY);
  return value ? decodeCourse(value) : null;
}

/** The course in a JSON course file (the course itself, pretty-printed); throws when it is not one. */
export function courseFromJson(text: string): Course {
  const data = JSON.parse(text) as Course;
  if (data?.v !== 1 || !Array.isArray(data.pieces)) throw new Error('コースのファイルではありません');
  for (const rec of data.pieces) if (!hasPart(rec.part)) throw new Error(`不明なパーツ: ${rec.part}`);
  validateCourse(data);
  return data;
}
