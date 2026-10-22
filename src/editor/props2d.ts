import { blockFootprint } from '../course/blocks';
import type { Layout } from '../course/course';
import { PROP_COLORS } from '../course/props-mesh';
import { startOutline, timerOutline } from '../course/props';
import { boxOutline, hoseColor, hoseCurve, HOSE_DIAMETER } from '../course/stoppers';
import { startStickers, timerBlocks } from '../course/timing';
import { xz } from './outline2d';
import type { Selection } from './selection';

// The start line, lap timer and floor stoppers in the top view (#56, #53).

/** What drawing on the top view needs: the canvas and where world points (mm) land on it. */
export interface Painter {
  ctx: CanvasRenderingContext2D;
  toScreen(x: number, z: number): [number, number];
  /** px per mm. */
  scale: number;
}

const SELECTED = '#3fd0ff';
/** Radius of a hose's point handles, px. */
export const HANDLE_RADIUS = 6;

function path(p: Painter, pts: readonly (readonly [number, number])[], close: boolean): void {
  const { ctx } = p;
  ctx.beginPath();
  pts.forEach(([x, z], i) => {
    const [sx, sy] = p.toScreen(x, z);
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  if (close) ctx.closePath();
}

/** The hoses and boxes on the floor, under the course. */
export function drawStoppers(p: Painter, layout: Layout): void {
  const { ctx } = p;
  for (const s of layout.stoppers) {
    if (s.kind === 'hose') {
      path(p, hoseCurve(s), false);
      ctx.strokeStyle = hoseColor(s);
      ctx.lineWidth = Math.max(2, HOSE_DIAMETER * p.scale);
      ctx.lineJoin = ctx.lineCap = 'round';
      ctx.stroke();
      ctx.lineJoin = 'miter';
      ctx.lineCap = 'butt';
      continue;
    }
    const { outline, open } = boxOutline(s);
    path(p, outline, true);
    ctx.fillStyle = PROP_COLORS.box;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // The open side, which faces the course.
    if (open) {
      path(p, open, false);
      ctx.strokeStyle = '#2a1e10';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
}

/** The START stickers, each with its arrow. */
export function drawStart(p: Painter, layout: Layout): void {
  if (!layout.start) return;
  const { ctx } = p;
  for (const s of startStickers(layout, layout.start)) {
    path(p, s.corners.map(xz), true);
    ctx.fillStyle = PROP_COLORS.sticker;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    path(p, s.arrow.map(xz), true);
    ctx.fillStyle = PROP_COLORS.arrow;
    ctx.fill();
  }
}

/** The lap timer from above: its body, the top over the lane and the tape under it. */
export function drawTimer(p: Painter, layout: Layout): void {
  if (!layout.timer) return;
  const { ctx } = p;
  // The tape on the road first, then the body and the top over it, a little see-through.
  const [body, top, tape] = timerBlocks(layout, layout.timer);
  for (const b of [tape, body, top]) {
    path(p, blockFootprint(b), true);
    ctx.fillStyle = PROP_COLORS[b.role];
    ctx.globalAlpha = b === top ? 0.85 : 1;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/** The selected prop outlined, and a selected hose's points as handles. */
export function drawPropSelection(p: Painter, layout: Layout, s: Selection): void {
  const { ctx } = p;
  ctx.strokeStyle = SELECTED;
  ctx.lineWidth = 3;
  if (s?.kind === 'start' || s?.kind === 'timer') {
    path(p, s.kind === 'start' ? startOutline(layout) : timerOutline(layout), true);
    ctx.stroke();
    return;
  }
  const stopper = s?.kind === 'stopper' ? layout.stoppers[s.index] : undefined;
  if (stopper?.kind === 'box') {
    path(p, boxOutline(stopper).outline, true);
    ctx.stroke();
  } else if (stopper?.kind === 'hose' && s?.kind === 'stopper') {
    path(p, hoseCurve(stopper), false);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    stopper.points.forEach(([x, z], k) => {
      const [sx, sy] = p.toScreen(x, z);
      ctx.beginPath();
      ctx.arc(sx, sy, HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = k === s.point ? SELECTED : '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#1b1d22';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  }
}
