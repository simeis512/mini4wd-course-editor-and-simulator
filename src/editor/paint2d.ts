import { Vector3 } from 'three';
import { variantOf } from '../course/catalog';
import type { Clash } from '../course/clash';
import { portKey, sameJoint, type Layout, type PortRef } from '../course/course';
import { pointOnFrame } from '../course/geometry';
import { atLevel, type HeightRange } from '../course/height';
import { attachmentOutline } from '../course/attachments';
import { stripOutline, tapeStrips } from '../course/tape';
import { TAPE_COLORS } from '../course/tape-mesh';
import { ATTACHMENT_COLOR, halfWidth } from '../course/mesh';
import { colorRange, heightColor, type HeightView } from './levels';
import { xz, type Outline } from './outline2d';
import type { TopCamera } from './top-camera';
import { drawPropSelection, drawStart, drawStoppers, drawTimer, type Painter } from './props2d';
import type { Selection } from './selection';
import { blink, drawClashMark, drawShortMark, type RunMarks } from './view';

/** The current top view, read only while painting (#93). */
export interface PaintState {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  camera: TopCamera;
  layout: Layout | null;
  outlines: readonly Outline[];
  order: readonly number[];
  selection: Selection;
  heights: readonly HeightRange[];
  heightView: HeightView;
  runMarks: RunMarks | null;
  clashes: readonly Clash[];
  stoppersShown: boolean;
}

/** Screen point at the middle of a port, shared by drawing and picking. */
export function portPoint(p: Pick<Painter, 'toScreen'>, layout: Layout, ref: PortRef): [number, number] {
  return p.toScreen(...xz(pointOnFrame(layout.pieces[ref.piece].ports[ref.port], 0, 0, new Vector3())));
}

/** Draw the view on the page, or only the course onto `target` at `ratio` pixels to the view's pixel. */
export function paint2d(state: PaintState, target?: { ctx: CanvasRenderingContext2D; ratio: number }): void {
  const { canvas, ctx: viewContext, camera, layout, outlines, order, selection, heightView, runMarks, clashes, stoppersShown, heights } = state;
  const ctx = target?.ctx ?? viewContext;
  const dpr = target?.ratio ?? (window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  // Read dimensions once, not for every vertex (a DOM layout read each time, #87).
  const toScreen = (x: number, z: number) => camera.toScreen(x, z, w, h);
  if (!target && (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr))) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#1b1d22';
  ctx.fillRect(0, 0, w, h);
  const toWorld = (sx: number, sy: number) => camera.toWorld(sx, sy, w, h);
  const shown = (piece: number) => atLevel(heights[piece] ?? [0, 0], heightView.level);
  const pointAtPort = (ref: PortRef) => portPoint({ toScreen }, layout!, ref);
  drawGrid(ctx, w, h);
  if (!layout) return;

  const path = (pts: [number, number][], close: boolean) => {
    ctx.beginPath();
    pts.forEach(([x, z], i) => {
      const [sx, sy] = toScreen(x, z);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    if (close) ctx.closePath();
  };

  const painter: Painter = { ctx, toScreen, scale: camera.scale };
  // Hoses and boxes lie on the floor, under everything (#53).
  if (stoppersShown) drawStoppers(painter, layout);
  const range = colorRange(Math.max(0, ...heights.map((r) => r[1])));
  const drawnMarks = new Set<number>();
  // The joint tape, by piece, drawn on each piece's road (#133).
  const tapeByPiece = new Map<number, ReturnType<typeof tapeStrips>>();
  for (const s of tapeStrips(layout)) tapeByPiece.set(s.piece, [...(tapeByPiece.get(s.piece) ?? []), s]);
  for (const i of order) {
    const o = outlines[i];
    if (!shown(o.piece)) {
      path(o.polygon, true);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.stroke();
      continue;
    }
    const pc = layout.pieces[o.piece];
    if (heightView.colors) {
      for (const step of o.steps) {
        path(step.polygon, true);
        // Stroke too, so no hairline gaps show between the steps.
        ctx.fillStyle = ctx.strokeStyle = heightColor(step.height, range);
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();
      }
    } else {
      path(o.polygon, true);
      ctx.fillStyle = variantOf(pc.part, pc.rec.variant).color;
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1;
    for (const f of o.fences) {
      path(f, false);
      ctx.stroke();
    }
    path(o.polygon, true);
    ctx.stroke();
    // Washboards on the piece's road, under anything higher (spec 4).
    if (!drawnMarks.has(o.piece)) {
      drawnMarks.add(o.piece);
      for (const a of layout.attachments) {
        if (a.piece !== o.piece) continue;
        const { outline, tabs, top, thick } = attachmentOutline(pc, a);
        path(outline.map(xz), true);
        ctx.fillStyle = ATTACHMENT_COLOR;
        ctx.fill();
        // The thin tabs at the ends, where the tape goes, are lighter.
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        for (const tab of tabs) {
          path(tab.map(xz), true);
          ctx.fill();
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = 1;
        for (const line of [top, outline]) {
          path(line.map(xz), line === outline);
          ctx.stroke();
        }
        // The thick end machines leave by, where the top drops.
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.lineWidth = 2.5;
        path(thick.map(xz), false);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      for (const strip of tapeByPiece.get(o.piece) ?? []) {
        path(stripOutline(layout, strip).map(xz), true);
        ctx.fillStyle = TAPE_COLORS[layout.tape![strip.where]!.kind];
        ctx.globalAlpha = 0.8;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      // The start line on the road, under anything higher (#56).
      if (layout.start?.piece === o.piece) drawStart(painter, layout);
    }
  }
  // The timer stands high over its lane, so over the road round it.
  if (layout.timer && shown(layout.timer.piece)) drawTimer(painter, layout);

  if (target) return;
  const sel = selection;
  drawPropSelection(painter, layout, sel);
  if (sel?.kind === 'piece') {
    // The pieces joined to the selection move with it: outline them too.
    const group = layout.group[sel.index];
    for (const o of outlines) {
      if (layout.group[o.piece] !== group) continue;
      path(o.polygon, true);
      const own = o.piece === sel.index;
      ctx.strokeStyle = own ? '#3fd0ff' : 'rgba(63,208,255,0.75)';
      ctx.lineWidth = own ? 3 : 1.5;
      ctx.setLineDash(own ? [] : [6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  const run = runMarks;
  if (run) {
    const pieces = new Set(run.pieces);
    const b = blink(performance.now());
    for (const o of outlines) {
      if (!pieces.has(o.piece)) continue;
      path(o.polygon, true);
      ctx.fillStyle = `rgba(255,200,40,${0.12 + 0.3 * b})`;
      ctx.fill();
      ctx.strokeStyle = '#ffc828';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  for (const j of layout.joints) {
    if (!shown(j.a.piece) && !shown(j.b.piece)) continue;
    const selected = sel?.kind === 'joint' && sameJoint(sel, j);
    drawJoint(j.a, selected ? '#3fd0ff' : '#39c26b', selected ? 1.6 : 1);
  }
  const split = new Set(layout.split.map(portKey));
  const intended = new Set(layout.intended.map(portKey));
  for (const ref of layout.open) {
    if (!shown(ref.piece)) continue;
    const key = portKey(ref);
    const selected = sel?.kind === 'port' && portKey(sel.ref) === key;
    // Ports left open on purpose are grey (#13).
    const color = selected ? '#3fd0ff' : split.has(key) ? '#ff5a5a' : intended.has(key) ? '#8a9099' : '#ff9a2e';
    drawPort(ref, color, selected ? 1.3 : 1);
  }
  for (const c of clashes) {
    const [sx, sy] = toScreen(c.at.x, c.at.z);
    drawClashMark(ctx, sx, sy, c.kind);
  }
  if (run?.missing && run.end) {
    const [sx, sy] = pointAtPort(run.end);
    drawShortMark(ctx, sx, sy - 26, run.missing);
  }

  /**
   * A bar across the track at a port, `reach` of its width long, in `color`
   * for strokes and fills; returns the screen point at its middle.
   */
  function drawBar(ref: PortRef, reach: number, color: string, size: number): [number, number] {
    const pc = layout!.pieces[ref.piece];
    const frame = pc.ports[ref.port];
    const half = halfWidth(pc.part.ports[ref.port].lanes.length) * reach;
    const p = new Vector3();
    const [ax, ay] = toScreen(...xz(pointOnFrame(frame, -half, 0, p)));
    const [bx, by] = toScreen(...xz(pointOnFrame(frame, half, 0, p)));
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3 * size;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    return pointAtPort(ref);
  }

  /** A short bar across the middle of a joint. */
  function drawJoint(ref: PortRef, color: string, size: number): void {
    const [cx, cy] = drawBar(ref, 0.6, color, size);
    ctx.beginPath();
    ctx.arc(cx, cy, 4 * size, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // Grid every 100 mm, stronger every metre; skip the fine grid when zoomed out.
    // The lines run along the floor, so they turn with the view.
    const corners = [toWorld(0, 0), toWorld(w, 0), toWorld(0, h), toWorld(w, h)];
    const xs = corners.map((c) => c[0]);
    const zs = corners.map((c) => c[1]);
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const line = (a: [number, number], b: [number, number]) => {
      ctx.moveTo(...toScreen(...a));
      ctx.lineTo(...toScreen(...b));
    };
    for (const [step, color] of [
      [100, 'rgba(255,255,255,0.04)'],
      [1000, 'rgba(255,255,255,0.09)'],
    ] as const) {
      if (step * camera.scale < 8) continue;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) line([x, z0], [x, z1]);
      for (let z = Math.ceil(z0 / step) * step; z <= z1; z += step) line([x0, z], [x1, z]);
      ctx.stroke();
    }
  }

  /** A bar across the track at the port with an arrow pointing out of the piece. */
  function drawPort(ref: PortRef, color: string, size: number): void {
    const [cx, cy] = drawBar(ref, 1, color, size);
    const frame = layout!.pieces[ref.piece].ports[ref.port];
    const [fx, fy] = toScreen(...xz(new Vector3(0, 0, 1).applyMatrix4(frame)));
    const len = Math.hypot(fx - cx, fy - cy) || 1;
    const [dx, dy] = [(fx - cx) / len, (fy - cy) / len];
    const r = 9 * size;
    ctx.beginPath();
    ctx.moveTo(cx + dx * r * 1.6, cy + dy * r * 1.6);
    ctx.lineTo(cx - dy * r, cy + dx * r);
    ctx.lineTo(cx + dy * r, cy - dx * r);
    ctx.closePath();
    ctx.fill();
  }
}
