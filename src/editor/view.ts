import type { Clash } from '../course/clash';
import type { Layout, PortRef } from '../course/course';
import type { Selection } from './selection';

/** Pieces a raise would move, shown blinking (spec 16.3). */
export interface RunMarks {
  pieces: number[];
  /** The far end of the run. */
  end: PortRef | null;
  /** Pieces fewer than asked for, shown at the end; 0 when enough. The run still rises. */
  missing: number;
}

/** How long one blink of the run takes, ms. */
const BLINK_MS = 1200;

/** Brightness of the blinking run at time `t` (ms), 0 to 1. */
export function blink(t: number): number {
  return 0.5 + 0.5 * Math.sin((t / BLINK_MS) * 2 * Math.PI);
}

/** What the editor needs from the 2D and 3D views alike. */
export interface EditorView {
  /** Coalesce the synchronous display changes of one refresh into one draw (#87). */
  beginUpdate(): void;
  endUpdate(): void;
  /** Show this layout with this selection. */
  setData(layout: Layout, selection: Selection): void;
  /** Blink the pieces a raise would move, or stop with null. */
  setRunMarks(marks: RunMarks | null): void;
  /** Mark where pieces are in each other's way (spec 7). */
  setClashes(clashes: readonly Clash[]): void;
  /** Show or hide the hoses and boxes on the floor (#53); hidden ones cannot be picked. */
  setStoppersShown(shown: boolean): void;
  /** Frame the whole course. */
  fit(): void;
  /** Floor point (mm, X/Z) in the middle of the view. */
  readonly centre: [number, number];
  /** Floor point (mm, X/Z) under a point on the page, or null when there is none. */
  floorAt(clientX: number, clientY: number): [number, number] | null;
  /** Point on the page over the world point (mm), or null when it cannot be seen. */
  clientOf(x: number, y: number, z: number): [number, number] | null;
  /** The course as it is in view now, without selection or marks, `width` × `height` pixels (the view's shape) (#75). */
  snapshot(width: number, height: number): HTMLCanvasElement;
}

/**
 * A yellow triangle with a number, over the end of a run that has fewer
 * pieces than asked for: how many are missing. Yellow, as the run can
 * still be raised (user, 2026-10-20). Both views draw it.
 */
export function drawShortMark(ctx: CanvasRenderingContext2D, x: number, y: number, n: number): void {
  const r = 16;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r * 1.05, y + r * 0.75);
  ctx.lineTo(x - r * 1.05, y + r * 0.75);
  ctx.closePath();
  ctx.fillStyle = '#ffc828';
  ctx.fill();
  ctx.strokeStyle = '#3a2a00';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#2a1e00';
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), x, y + 3);
}

/** Colours of the clash marks: an overlap is an error, a low crossing or a stopper in the way a warning. */
const CLASH_COLOR: Record<Clash['kind'], string> = { interference: '#ff5a5a', clearance: '#ffc828', stopper: '#ffc828' };

/** A round "!" where pieces are in each other's way (spec 7). Both views draw it. */
export function drawClashMark(ctx: CanvasRenderingContext2D, x: number, y: number, kind: Clash['kind']): void {
  const r = 11;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = CLASH_COLOR[kind];
  ctx.fill();
  ctx.strokeStyle = '#1b1d22';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#1b1d22';
  ctx.font = 'bold 15px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', x, y + 1);
}
