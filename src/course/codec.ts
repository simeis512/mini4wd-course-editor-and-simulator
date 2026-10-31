import { ATTACHMENT_CODES, CATALOG_VERSION, hasPart, PART_CODES } from './catalog';
import { validateCourse, type Attachment, type Course, type PieceRec, type Stopper } from './course';
import { isZeroBend } from './flex';
import { TAPE_KIND_ORDER, type JointTape, type TapeSpec, type WallFace } from './tape';

/**
 * Course ⇄ URL hash (spec 6): `#c=<format>.<payload>`, where the payload is
 * a compact binary course, deflate-raw compressed and base64url encoded.
 *
 * Format 8, all integers as LEB128 varints (signed ones zigzag encoded):
 *   catalog version
 *   flags: bit0 dir = -1, bit1 has name, bit2 has split marks,
 *          bit3 has ports left open on purpose, bit4 has attachments,
 *          bit5 has a start line, bit6 has a lap timer, bit7 has stoppers,
 *          bit8 has joint tape
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
 *     [pitch, yaw (0.01°)]           bend of a `to` joint (spec 16.5, #86)
 *     [shift (lanes)]                sideways shift of a `to` joint (#60)
 *     [x, y, z (0.1 mm), yaw, pitch, roll (0.1°)]  free
 *     [twist (0.01°)]                (spec 16.5, #86)
 *     [length (mm)]                  of a home-made straight (#69)
 *   [split mark count, then piece, port for each]  when flagged
 *   [open-on-purpose mark count, then piece, port for each]  when flagged (#13)
 *   [attachment count, then for each: kind (index into ATTACHMENT_CODES),
 *    piece, lane, offset (mm), side (mm, signed),
 *    flags: bit0 reversed, bit1 on a fence, bit2 the right one]  when flagged (spec 4)
 *   [start: piece, offset (mm), flags: bit0 reversed]  when flagged (#56)
 *   [timer: piece, offset (mm), flags: bit0 by the right fence, bit1 times every lane]  when flagged (#56)
 *   [stopper count, then for each: kind (0 hose, 1 box), then  when flagged (#53)
 *     hose: colour, flags (bit0 closed), point count, then x, z (mm, signed) for each
 *     box: size, flags (bit0 upright), x, z (mm, signed), yaw (0.1°)]
 *   [joint tape: flags (bit0 floor, bit1 walls), then for each: kind (index  when flagged (#133)
 *    into TAPE_KIND_ORDER), width (mm), friction (0.001); walls then face
 *    (0 inner, 1 outer, 2 both)]
 *
 * Format 7 is the same without the joint tape, format 6 is the same with bends and twists in 0.1° steps, format 5 also without the start, timer and stoppers,
 * format 4 also without lengths and attachments, format 3 also without shifts,
 * format 2 also without the open-on-purpose marks, and format 1 without
 * bends and twists too, so all still read.
 */
export const FORMAT_VERSION = 8;
/** Older formats that still read. */
const READABLE_VERSIONS = [1, 2, 3, 4, 5, 6, 7, FORMAT_VERSION];
/** Wall faces by their code in the URL (#133); append only. */
const WALL_FACE_CODES: readonly WallFace[] = ['inner', 'outer', 'both'];
/** The first format with bends and twists in 0.01° steps (#86). */
const FINE_ANGLES = 7;
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
  hundredths(x: number): void {
    this.int(Math.round(x * 100));
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
  hundredths(): number {
    return this.int() / 100;
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
  const stoppers = course.stoppers ?? [];
  w.uint(
    (course.dir === -1 ? 1 : 0) |
      (course.name ? 2 : 0) |
      (cuts.length ? 4 : 0) |
      (intended.length ? 8 : 0) |
      (attachments.length ? 16 : 0) |
      (course.start ? 32 : 0) |
      (course.timer ? 64 : 0) |
      (stoppers.length ? 128 : 0) |
      (course.tape ? 256 : 0),
  );
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
        w.hundredths(bend.pitch ?? 0);
        w.hundredths(bend.yaw ?? 0);
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
    if (rec.twist) w.hundredths(rec.twist);
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
  if (course.start) {
    const { piece, offset, reverse } = course.start;
    for (const n of [piece, Math.round(offset), reverse ? 1 : 0]) w.uint(n);
  }
  if (course.timer) {
    const { piece, offset, side, everyLane } = course.timer;
    for (const n of [piece, Math.round(offset), (side === 'right' ? 1 : 0) | (everyLane ? 2 : 0)]) w.uint(n);
  }
  if (stoppers.length) {
    w.uint(stoppers.length);
    for (const s of stoppers) {
      if (s.kind === 'hose') {
        for (const n of [0, s.color, s.closed ? 1 : 0, s.points.length]) w.uint(n);
        for (const [x, z] of s.points) {
          w.int(Math.round(x));
          w.int(Math.round(z));
        }
      } else {
        for (const n of [1, s.size, s.upright ? 1 : 0]) w.uint(n);
        w.int(Math.round(s.x));
        w.int(Math.round(s.z));
        w.tenths(s.yaw);
      }
    }
  }
  if (course.tape) {
    const { floor, wall } = course.tape;
    w.uint((floor ? 1 : 0) | (wall ? 2 : 0));
    for (const spec of [floor, wall]) {
      if (!spec) continue;
      w.uint(TAPE_KIND_ORDER.indexOf(spec.kind));
      w.uint(Math.round(spec.width));
      w.uint(Math.round(spec.friction * 1000));
    }
    if (wall) w.uint(WALL_FACE_CODES.indexOf(wall.face));
  }
  return new Uint8Array(w.bytes);
}

export function courseFromBytes(bytes: Uint8Array, version = FORMAT_VERSION): Course {
  const r = new Reader(bytes);
  /** A bend or twist, in the steps of `version`. */
  const angle = () => (version >= FINE_ANGLES ? r.hundredths() : r.tenths());
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
          const [pitch, yaw] = [angle(), angle()];
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
    if (head & 16) rec.twist = angle();
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
  if (flags & 32) {
    course.start = { piece: r.uint(), offset: r.uint() };
    if (r.uint() & 1) course.start.reverse = true;
  }
  if (flags & 64) {
    course.timer = { piece: r.uint(), offset: r.uint(), side: 'left' };
    const bits = r.uint();
    if (bits & 1) course.timer.side = 'right';
    if (bits & 2) course.timer.everyLane = true;
  }
  if (flags & 128) {
    course.stoppers = Array.from({ length: r.uint() }, (): Stopper => {
      const kind = r.uint();
      if (kind === 0) {
        const hose: Stopper = { kind: 'hose', color: r.uint(), points: [] };
        if (r.uint() & 1) hose.closed = true;
        hose.points = Array.from({ length: r.uint() }, (): [number, number] => [r.int(), r.int()]);
        return hose;
      }
      if (kind !== 1) throw new Error('unknown stopper kind');
      const box: Stopper = { kind: 'box', size: r.uint(), x: 0, z: 0, yaw: 0 };
      if (r.uint() & 1) box.upright = true;
      [box.x, box.z, box.yaw] = [r.int(), r.int(), r.tenths()];
      return box;
    });
  }
  if (flags & 256) {
    const which = r.uint();
    const spec = (): TapeSpec => {
      const kind = TAPE_KIND_ORDER[r.uint()];
      if (!kind) throw new Error('unknown tape kind');
      return { kind, width: r.uint(), friction: r.uint() / 1000 };
    };
    const tape: JointTape = {};
    if (which & 1) tape.floor = spec();
    if (which & 2) {
      const wall = spec();
      const face = WALL_FACE_CODES[r.uint()];
      if (!face) throw new Error('unknown tape face');
      tape.wall = { ...wall, face };
    }
    course.tape = tape;
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
  return courseFromBytes(bytes, version);
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
