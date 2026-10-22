import type { Layout } from './course';
import type { LapCheck } from './laps';
import { roadOutline, trackEdge, worldTracks } from './mesh';

// The picture of a course for sharing on social media (#75): how it is laid
// out, and the facts written beside the course.

export type ShareAspect = 'landscape' | 'portrait';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ShareLayout {
  width: number;
  height: number;
  /** Where the course view goes. */
  course: Rect;
  /** The band for the facts and the QR code. */
  info: Rect;
}

/** Sizes offered (#75 決定事項: 16:9 or 9:16 to start with), in pixels. */
export const SHARE_ASPECTS: readonly { id: ShareAspect; label: string; width: number; height: number }[] = [
  { id: 'landscape', label: '横 16:9', width: 1920, height: 1080 },
  { id: 'portrait', label: '縦 9:16', width: 1080, height: 1920 },
];

/** Share of the long side given to the facts band. provisional: leaves the course most of the picture. */
const INFO_SHARE = 0.3;

/** The course on the left and the facts on the right (16:9), or the course above them (9:16). */
export function shareLayout(aspect: ShareAspect): ShareLayout {
  const { width, height } = SHARE_ASPECTS.find((a) => a.id === aspect)!;
  if (aspect === 'landscape') {
    const info = Math.round(width * INFO_SHARE);
    return { width, height, course: { x: 0, y: 0, w: width - info, h: height }, info: { x: width - info, y: 0, w: info, h: height } };
  }
  const info = Math.round(height * INFO_SHARE);
  return { width, height, course: { x: 0, y: 0, w: width, h: height - info }, info: { x: 0, y: height - info, w: width, h: info } };
}

/** The largest rectangle of `aspect` (width / height) centred in a `w` × `h` area, `margin` in from its edges. */
export function frameIn(w: number, h: number, aspect: number, margin = 0): Rect {
  const aw = Math.max(1, w - 2 * margin);
  const ah = Math.max(1, h - 2 * margin);
  const fw = Math.min(aw, ah * aspect);
  const fh = fw / aspect;
  return { x: (w - fw) / 2, y: (h - fh) / 2, w: fw, h: fh };
}

/** How far the course reaches across the floor, mm: X (left to right) and Z (front to back), fences included. */
export function courseExtent(layout: Layout): { x: number; z: number } {
  let [x0, x1, z0, z1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const { samples, section } of worldTracks(layout)) {
    const edges = [roadOutline(samples, section), ...section.fences.map((f) => trackEdge(samples, f))];
    for (const p of edges.flat()) {
      [x0, x1, z0, z1] = [Math.min(x0, p.x), Math.max(x1, p.x), Math.min(z0, p.z), Math.max(z1, p.z)];
    }
  }
  return x0 > x1 ? { x: 0, z: 0 } : { x: x1 - x0, z: z1 - z0 };
}

const metres = (mm: number) => `${(mm / 1000).toFixed(1)} m`;

/** One line of facts: a label and its value. */
export interface ShareFact {
  label: string;
  value: string;
}

/**
 * The facts written beside the course: the length of a full run (every
 * lane's lap added up, as the official "about 20 m" of the basic set), the
 * size on the floor (longer side first) and the number of pieces.
 */
export function shareFacts(laps: LapCheck | null, extent: { x: number; z: number }, pieces: number): ShareFact[] {
  const facts: ShareFact[] = [];
  if (laps && laps.laps.every((l) => l.next !== null)) {
    const total = laps.laps.reduce((sum, l) => sum + l.length, 0);
    facts.push({ label: laps.allLanes ? `全長（${laps.cycle.length}周）` : '全長（各レーン1周の合計）', value: metres(total) });
  }
  const [long, short] = extent.x >= extent.z ? [extent.x, extent.z] : [extent.z, extent.x];
  if (long > 0) facts.push({ label: '大きさ', value: `${metres(long)} × ${metres(short)}` });
  facts.push({ label: 'ピース', value: `${pieces} 個` });
  return facts;
}
