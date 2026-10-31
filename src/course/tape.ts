import { Matrix4, Vector3 } from 'three';
import { GLOBAL_SPEC } from './catalog';
import type { Course, Layout, PortRef } from './course';
import { pointOnFrame } from './geometry';
import { crossSection } from './mesh';

// Tape over the joints, set once for the whole course (#133, owner
// 2026-10-30): on the floor one strip across the whole road, on the walls
// the outer walls only, on their inner face (where the rollers run), outer
// face or both. Every kind of joint is taped alike; no wall strip where
// there is no wall.

export type TapeKind = 'curing' | 'opp' | 'cloth';
export type WallFace = 'inner' | 'outer' | 'both';

/** One kind of tape: how wide a strip, mm, and its friction against the machine. */
export interface TapeSpec {
  kind: TapeKind;
  width: number;
  friction: number;
}

export interface WallTape extends TapeSpec {
  face: WallFace;
}

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

export const WALL_FACES: Record<WallFace, string> = { inner: '内面（ローラーが当たる面）', outer: '外面', both: '両面' };

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
  if (tape.wall && !(tape.wall.face in WALL_FACES)) throw new Error(`tape on wall face ${tape.wall.face}`);
}

/**
 * Where a strip lies across and up, mm: `thickness` thick, on a road whose
 * top is raised by `lift` and against fences `fenceHalf` thick each side of
 * their centres (thicker for printing, #89).
 */
export function stripBounds(
  strip: Pick<TapeStrip, 'where' | 'x' | 'wall'>,
  { thickness = TAPE_THICKNESS, lift = 0, fenceHalf = GLOBAL_SPEC.fenceThickness / 2 } = {},
): { x: [number, number]; y: [number, number] } {
  if (strip.where === 'floor' || !strip.wall) return { x: strip.x, y: [lift, lift + thickness] };
  const { fence, side } = strip.wall;
  const face = fence + side * fenceHalf;
  const out = face + side * thickness;
  return { x: [Math.min(face, out), Math.max(face, out)], y: [0, GLOBAL_SPEC.fenceHeight + lift] };
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
  /** On a wall: the fence's centre across the road, and which way from it the taped face lies (+1 right). */
  wall?: { fence: number; side: 1 | -1 };
  /** Against the machine; null on a wall's outer face, which nothing runs on. */
  friction: number | null;
}

/** How near a track's end must lie to a port to be at it, mm. */
const AT_PORT = 1;

/**
 * The track's frames over `length` mm from its start or end, in the
 * track's own order (so swept boxes face outwards); the inner one cut to length.
 */
export function endFrames(samples: readonly Matrix4[], atStart: boolean, length: number): Matrix4[] {
  const list = atStart ? samples : [...samples].reverse();
  const out = [list[0]];
  const ordered = () => (atStart ? out : out.reverse());
  const a = new Vector3();
  const b = new Vector3();
  let gone = 0;
  for (let i = 1; i < list.length; i++) {
    a.setFromMatrixPosition(list[i - 1]);
    b.setFromMatrixPosition(list[i]);
    const step = a.distanceTo(b);
    if (gone + step >= length) {
      const cut = list[i].clone();
      cut.setPosition(a.lerp(b, step ? (length - gone) / step : 0));
      out.push(cut);
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
  for (const e of ends) {
    const section = crossSection(e.lanes);
    const base = { piece: ref.piece, port: ref.port };
    if (tape.floor) {
      out.push({ ...base, where: 'floor', frames: endFrames(e.samples, e.atStart, tape.floor.width / 2), x: [section.left, section.right], y: [0, TAPE_THICKNESS], friction: tape.floor.friction });
    }
    if (!tape.wall) continue;
    const frames = endFrames(e.samples, e.atStart, tape.wall.width / 2);
    for (const x of section.fences) {
      const at = across(e, x);
      if (Math.abs(at - lo) > AT_PORT && Math.abs(at - hi) > AT_PORT) continue;
      // Inward is towards the middle of the road at this end.
      const inward = x < (section.left + section.right) / 2 ? 1 : -1;
      const faces = tape.wall.face === 'both' ? [1, -1] : [tape.wall.face === 'inner' ? 1 : -1];
      for (const side of faces) {
        const wall = { fence: x, side: (side * inward) as 1 | -1 };
        out.push({
          ...base,
          where: 'wall',
          frames,
          ...stripBounds({ where: 'wall', x: [0, 0], wall }),
          wall,
          // Only the inner face meets the rollers (owner, 2026-10-30).
          friction: side === 1 ? tape.wall.friction : null,
        });
      }
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
 * strip up a wall face; one per joint, each wall face its own strip.
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
    // Each wall face at a joint: the strips of one of the two pieces.
    const faces = layout.joints.reduce((n, j) => n + strips.filter((s) => s.where === 'wall' && s.piece === j.a.piece && s.port === j.a.port).length, 0);
    if (faces) out.push({ where: 'wall', spec: tape.wall, joints, length: faces * GLOBAL_SPEC.fenceHeight });
  }
  return out;
}
