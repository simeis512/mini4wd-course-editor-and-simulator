import { CATALOG_VERSION, PART_CODES } from './catalog';
import { validateCourse, type Course, type PieceRec } from './course';

/**
 * Course ⇄ URL hash (spec 6): `#c=<format>.<payload>`, where the payload is
 * a compact binary course, deflate-raw compressed and base64url encoded.
 *
 * Format 1, all integers as LEB128 varints (signed ones zigzag encoded):
 *   catalog version
 *   flags: bit0 dir = -1, bit1 has name
 *   [name: byte length, UTF-8]
 *   piece count
 *   per piece:
 *     part code (index into PART_CODES)
 *     head: bits0-1 anchor (0 origin, 1 to, 2 free in world, 3 free from port), bit2 has variant
 *     [variant]
 *     [port]                         unless origin
 *     [piece, port]                  to / free from port
 *     [x, y, z (0.1 mm), yaw, pitch, roll (0.1°)]  free
 */
export const FORMAT_VERSION = 1;
const HASH_KEY = 'c';

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
  w.uint((course.dir === -1 ? 1 : 0) | (course.name ? 2 : 0));
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
    w.uint(anchor | (rec.variant !== undefined ? 4 : 0));
    if (rec.variant !== undefined) w.uint(rec.variant);
    if ('port' in rec) w.uint(rec.port);
    if ('to' in rec) {
      w.uint(rec.to[0]);
      w.uint(rec.to[1]);
    } else if ('free' in rec) {
      if (rec.free) {
        w.uint(rec.free[0]);
        w.uint(rec.free[1]);
      }
      for (const x of rec.pose.pos) w.tenths(x);
      for (const x of rec.pose.rot) w.tenths(x);
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
      } else {
        const free: [number, number] | null = anchor === 3 ? [r.uint(), r.uint()] : null;
        const pos: [number, number, number] = [r.tenths(), r.tenths(), r.tenths()];
        const rot: [number, number, number] = [r.tenths(), r.tenths(), r.tenths()];
        rec = { part, port, free, pose: { pos, rot } };
      }
    }
    if (variant !== undefined) rec.variant = variant;
    course.pieces.push(rec);
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
  if (version !== FORMAT_VERSION) throw new Error(`未対応のコース形式です（版 ${version}）`);
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
