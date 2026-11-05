import { Matrix4, Quaternion, Vector3 } from 'three';
import { GLOBAL_SPEC } from './catalog';
import type { Course, Layout, PortRef } from './course';
import { pointOnFrame } from './geometry';
import { crossSection } from './mesh';

// Tape over the joints, set once for the whole course (#133, owner
// 2026-10-30): on the floor one strip across the whole road, on the walls
// the outer walls and, if asked, the dividers between the lanes too
// (owner, 2026-10-31). A wall strip goes on from above, over the top and
// down both faces, or, kept off the rollers, only a little way down the
// faces the machines run along (owner, 2026-11-01). Every kind of joint is
// taped alike; no wall strip where there is no wall.

export type TapeKind = 'curing' | 'opp' | 'cloth';

/** One kind of tape: how wide a strip, mm, and its friction against the machine. */
export interface TapeSpec {
  kind: TapeKind;
  width: number;
  friction: number;
}

export interface WallTape extends TapeSpec {
  /** The dividers between the lanes too, not only the outer walls. */
  dividers: boolean;
  /**
   * Down the faces the machines run along only `INSIDE_FLAP` from the top,
   * so the rollers do not touch it (owner, 2026-11-01); the outer walls'
   * outside faces are still taped all the way down.
   */
  shortInside?: boolean;
}

/**
 * How far down from the top a wall's road side is taped when it is kept
 * off the rollers, mm (#133, owner 2026-11-01; provisional): about 10mm,
 * so that the upper rollers of a two-tier stay off it too; the walls are
 * 50mm tall.
 */
export const INSIDE_FLAP = 10;

/** The course's joint tape; nothing set is no tape. */
export interface JointTape {
  floor?: TapeSpec;
  wall?: WallTape;
}

/**
 * Kinds of tape: their names, usual width and friction (#133, owner
 * 2026-10-30: picking a kind fills in the friction, which can be changed).
 * The friction values are provisional, not measured (as #1).
 */
export const TAPE_KINDS: Record<TapeKind, { name: string; width: number; friction: number }> = {
  curing: { name: '養生テープ', width: 50, friction: 0.5 },
  opp: { name: '荷造り（OPP）テープ', width: 48, friction: 0.35 },
  cloth: { name: '布ガムテープ', width: 50, friction: 0.6 },
};
export const TAPE_KIND_ORDER: readonly TapeKind[] = ['curing', 'opp', 'cloth'];
/** Widths offered besides typing one in, mm (#133, provisional). */
export const TAPE_WIDTHS = [25, 38, 48, 50] as const;
export const TAPE_WIDTH_RANGE = [10, 100] as const;
export const FRICTION_RANGE = [0, 2] as const;
/** How thick a strip is drawn, mm: looks only, not in the collision meshes (#133, provisional). */
export const TAPE_THICKNESS = 0.2;

export function defaultTape(kind: TapeKind = 'curing'): TapeSpec {
  const k = TAPE_KINDS[kind];
  return { kind, width: k.width, friction: k.friction };
}

/** The course with its joint tape set; an empty setting takes it off. */
export function setTape(course: Course, tape: JointTape | undefined): Course {
  const next = { ...course };
  if (tape && (tape.floor || tape.wall)) next.tape = tape;
  else delete next.tape;
  return next;
}

/** Throws when the stored setting is not one. */
export function validateTape(tape: JointTape): void {
  for (const spec of [tape.floor, tape.wall]) {
    if (!spec) continue;
    const ok =
      spec.kind in TAPE_KINDS &&
      spec.width >= TAPE_WIDTH_RANGE[0] && spec.width <= TAPE_WIDTH_RANGE[1] &&
      spec.friction >= FRICTION_RANGE[0] && spec.friction <= FRICTION_RANGE[1];
    if (!ok) throw new Error(`bad tape ${JSON.stringify(spec)}`);
  }
  if (tape.wall && typeof tape.wall.dividers !== 'boolean') throw new Error(`tape on dividers ${tape.wall.dividers}`);
  if (tape.wall && tape.wall.shortInside !== undefined && typeof tape.wall.shortInside !== 'boolean') throw new Error(`tape inside ${tape.wall.shortInside}`);
}

/**
 * Where a strip lies across and up, mm: `thickness` thick, on a road whose
 * top is raised by `lift` and against fences `fenceHalf` thick each side of
 * their centres (thicker for printing, #89).
 */
export function stripBounds(
  strip: Pick<TapeStrip, 'where' | 'x' | 'wall' | 'part' | 'side'>,
  { thickness = TAPE_THICKNESS, lift = 0, fenceHalf = GLOBAL_SPEC.fenceThickness / 2 } = {},
): { x: [number, number]; y: [number, number] } {
  if (strip.where === 'floor' || strip.wall === undefined) return { x: strip.x, y: [lift, lift + thickness] };
  const top = GLOBAL_SPEC.fenceHeight + lift;
  const half = fenceHalf + thickness;
  if (strip.part === 'face') {
    // Down one face, below the cap.
    const face = strip.wall + strip.side! * fenceHalf;
    const out = face + strip.side! * thickness;
    return { x: [Math.min(face, out), Math.max(face, out)], y: [0, top - INSIDE_FLAP] };
  }
  // Over the top and down both faces: all the way, or only as far as the flap.
  return { x: [strip.wall - half, strip.wall + half], y: [strip.part === 'cap' ? top - INSIDE_FLAP : 0, top + thickness] };
}

/** Tape it takes to go over one wall from the road on one side to the road on the other, mm. */
export const WALL_WRAP = 2 * GLOBAL_SPEC.fenceHeight + GLOBAL_SPEC.fenceThickness;

/** Tape one wall strip takes, mm. */
function stripLength(s: TapeStrip): number {
  if (s.part === 'cap') return 2 * INSIDE_FLAP + GLOBAL_SPEC.fenceThickness;
  if (s.part === 'face') return GLOBAL_SPEC.fenceHeight - INSIDE_FLAP;
  return WALL_WRAP;
}

/** One strip of tape on one piece, by one of its ends. */
export interface TapeStrip {
  where: 'floor' | 'wall';
  piece: number;
  port: number;
  /** Centreline frames of the stretch it covers, part-local, in the track's own order. */
  frames: Matrix4[];
  /** Across the road (+ right of the frames) and up from the road, mm. */
  x: [number, number];
  y: [number, number];
  /** On a wall: the fence's centre across the road, mm. */
  wall?: number;
  /**
   * On a wall: all round it (`wrap`, the default), over its top a little
   * way down both faces (`cap`), or down one face below the cap (`face`,
   * on the side `side`: +1 right).
   */
  part?: 'wrap' | 'cap' | 'face';
  side?: 1 | -1;
  /** Against the machine. */
  friction: number;
}

/** How near a track's end must lie to a port to be at it, mm. */
const AT_PORT = 1;

/**
 * Frames at a track's start or end and `length` mm on straight into the
 * piece, in the track's own order (so swept boxes face outwards): tape on
 * the floor is as wide all the way across, also on a bend (owner, 2026-10-31).
 */
export function endFrames(samples: readonly Matrix4[], atStart: boolean, length: number): Matrix4[] {
  const end = (atStart ? samples[0] : samples[samples.length - 1]).clone();
  // The track's way at the end (frames look along + Z): into the piece at its start, out of it at its end.
  const along = new Vector3().setFromMatrixColumn(end, 2).normalize();
  const inner = end.clone().setPosition(new Vector3().setFromMatrixPosition(end).addScaledVector(along, atStart ? length : -length));
  return atStart ? [end, inner] : [inner, end];
}

/**
 * The track's frames from its start or end on along a wall `right` mm
 * across, until `length` mm along that wall, in the track's own order: tape
 * wrapped round a wall follows it and is as wide along it, on the inside of
 * a bend too (owner, 2026-10-31); the inner frame is cut to length.
 */
export function wallFrames(samples: readonly Matrix4[], atStart: boolean, length: number, right: number): Matrix4[] {
  const list = atStart ? samples : [...samples].reverse();
  const out = [list[0]];
  const ordered = () => (atStart ? out : out.reverse());
  const a = new Vector3();
  const b = new Vector3();
  let gone = 0;
  for (let i = 1; i < list.length; i++) {
    pointOnFrame(list[i - 1], right, 0, a);
    pointOnFrame(list[i], right, 0, b);
    const step = a.distanceTo(b);
    if (gone + step >= length) {
      // Between the two samples, turning as well as moving, so the wall's point lands where it should.
      const k = step ? (length - gone) / step : 0;
      const [p0, q0, p1, q1, scale] = [new Vector3(), new Quaternion(), new Vector3(), new Quaternion(), new Vector3()];
      list[i - 1].decompose(p0, q0, scale);
      list[i].decompose(p1, q1, scale);
      out.push(new Matrix4().compose(p0.lerp(p1, k), q0.slerp(q1, k), scale));
      return ordered();
    }
    gone += step;
    out.push(list[i]);
  }
  return ordered();
}

/** Strips on one piece by one joined port. */
function stripsAt(layout: Layout, ref: PortRef, tape: JointTape): TapeStrip[] {
  const pc = layout.pieces[ref.piece];
  const port = pc.geometry.ports[ref.port];
  const toPort = port.clone().invert();
  const p = new Vector3();
  const ends: { samples: Matrix4[]; atStart: boolean; lanes: number[] }[] = [];
  for (const track of pc.geometry.tracks) {
    for (const atStart of [true, false]) {
      p.setFromMatrixPosition(track.samples[atStart ? 0 : track.samples.length - 1]).applyMatrix4(toPort);
      if (Math.abs(p.z) < AT_PORT && Math.abs(p.y) < AT_PORT) ends.push({ samples: track.samples, atStart, lanes: track.lanes });
    }
  }
  // The outer walls are the outermost fences at the port, whichever track they belong to.
  const across = (e: (typeof ends)[number], x: number) => {
    const f = e.samples[e.atStart ? 0 : e.samples.length - 1];
    return pointOnFrame(f, x, 0).applyMatrix4(toPort).x;
  };
  const all = ends.flatMap((e) => crossSection(e.lanes).fences.map((x) => across(e, x)));
  const [lo, hi] = [Math.min(...all), Math.max(...all)];
  const out: TapeStrip[] = [];
  /** Where across the port walls are taped already: two tracks ending together may share one. */
  const taped: number[] = [];
  for (const e of ends) {
    const section = crossSection(e.lanes);
    const base = { piece: ref.piece, port: ref.port };
    if (tape.floor) {
      out.push({ ...base, where: 'floor', frames: endFrames(e.samples, e.atStart, tape.floor.width / 2), x: [section.left, section.right], y: [0, TAPE_THICKNESS], friction: tape.floor.friction });
    }
    if (!tape.wall) continue;
    for (const wall of section.fences) {
      const at = across(e, wall);
      const outer = Math.abs(at - lo) <= AT_PORT || Math.abs(at - hi) <= AT_PORT;
      if (!outer && !tape.wall.dividers) continue;
      if (taped.some((t) => Math.abs(t - at) <= AT_PORT)) continue;
      taped.push(at);
      const frames = wallFrames(e.samples, e.atStart, tape.wall.width / 2, wall);
      const strip = (part: TapeStrip['part'], side?: 1 | -1): TapeStrip => {
        const s: TapeStrip = { ...base, where: 'wall', frames, x: [0, 0], y: [0, 0], wall, friction: tape.wall!.friction };
        if (part !== 'wrap') s.part = part;
        if (side) s.side = side;
        return { ...s, ...stripBounds(s) };
      };
      if (!tape.wall.shortInside) {
        out.push(strip('wrap'));
        continue;
      }
      out.push(strip('cap'));
      // An outer wall's outside, which no machine runs along, is still taped all the way down.
      if (outer) out.push(strip('face', wall < (section.left + section.right) / 2 ? -1 : 1));
    }
  }
  return out;
}

const stripsCache = new WeakMap<Layout, TapeStrip[]>();

/** Every strip of the course's joint tape, on both pieces at every joint; shared read-only for this layout. */
export function tapeStrips(layout: Layout): TapeStrip[] {
  const tape = layout.tape;
  if (!tape || (!tape.floor && !tape.wall)) return [];
  let strips = stripsCache.get(layout);
  if (!strips) {
    strips = layout.joints.flatMap((j) => [...stripsAt(layout, j.a, tape), ...stripsAt(layout, j.b, tape)]);
    stripsCache.set(layout, strips);
  }
  return strips;
}

/** A strip seen from above, world mm: one side along, the other back. */
export function stripOutline(layout: Layout, strip: TapeStrip): Vector3[] {
  const m = layout.pieces[strip.piece].matrix;
  const edge = (x: number) => strip.frames.map((f) => pointOnFrame(f, x, strip.y[1]).applyMatrix4(m));
  return [...edge(strip.x[0]), ...edge(strip.x[1]).reverse()];
}

/** How much tape the course takes (#133: for the shopping list), mm and joints. */
export interface TapeNeed {
  where: 'floor' | 'wall';
  spec: TapeSpec;
  joints: number;
  /** Length of tape cut off the roll, mm. */
  length: number;
}

/**
 * Tape the course takes: a floor strip runs across the whole road, a wall
 * strip up one face of a wall, over its top and down the other; one per
 * joint and wall.
 */
export function tapeNeeds(layout: Layout): TapeNeed[] {
  const tape = layout.tape;
  if (!tape) return [];
  const strips = tapeStrips(layout);
  const out: TapeNeed[] = [];
  const joints = layout.joints.length;
  if (tape.floor && joints) {
    // Across the road at each joint: the widest of the two ends.
    let length = 0;
    for (const j of layout.joints) {
      const at = strips.filter((s) => s.where === 'floor' && [j.a, j.b].some((r) => r.piece === s.piece && r.port === s.port));
      const widths = [j.a, j.b].map((r) => at.filter((s) => s.piece === r.piece && s.port === r.port).reduce((w, s) => w + s.x[1] - s.x[0], 0));
      length += Math.max(...widths);
    }
    out.push({ where: 'floor', spec: tape.floor, joints, length });
  }
  if (tape.wall) {
    // Each wall at a joint: the strips of one of the two pieces.
    const length = layout.joints.reduce(
      (n, j) => n + strips.filter((s) => s.where === 'wall' && s.piece === j.a.piece && s.port === j.a.port).reduce((m, s) => m + stripLength(s), 0),
      0,
    );
    if (length) out.push({ where: 'wall', spec: tape.wall, joints, length });
  }
  return out;
}
