import { Vector3 } from 'three';
import { variantOf } from '../course/catalog';
import type { Clash } from '../course/clash';
import { portKey, sameJoint, type Layout, type PortRef } from '../course/course';
import { pointOnFrame } from '../course/geometry';
import { atLevel, pieceHeights, type HeightRange } from '../course/height';
import { halfWidth, insidePolygon, worldTracks } from '../course/mesh';
import { colorRange, heightColor, type HeightView } from './levels';
import { lowestFirst, outlinesOf, xz, type Outline } from './outline2d';
import { JOINT_HIT, PORT_HIT, TAP_SLOP, type DragHandlers, type PickHandlers, type Selection } from './selection';
import { blink, drawClashMark, drawShortMark, type EditorView, type RunMarks } from './view';

/**
 * Top-down 2D editor view drawn on a canvas. Pointer Events only, so mouse,
 * pen and touch behave the same: tap to select, drag to pan, wheel or pinch
 * to zoom.
 */
export class TopView implements EditorView {
  private ctx: CanvasRenderingContext2D;
  private layout: Layout | null = null;
  private outlines: Outline[] = [];
  /** Outline indices from the lowest road to the highest. */
  private order: number[] = [];
  private selection: Selection = null;
  private heights: HeightRange[] = [];
  private heightView: HeightView = { colors: false, level: 0 };
  /** World point (mm) at the canvas centre, and zoom in px per mm. */
  private cx = 0;
  private cz = 0;
  private scale = 0.2;
  private pointers = new Map<number, { x: number; y: number }>();
  private dragged = false;
  private downAt = { x: 0, y: 0 };
  private pinch: { dist: number; scale: number } | null = null;
  /** A piece is being dragged instead of the view being panned. */
  private moving = false;
  private runMarks: RunMarks | null = null;
  private blinking = false;
  private clashes: readonly Clash[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private handlers: PickHandlers & DragHandlers,
  ) {
    this.ctx = canvas.getContext('2d')!;
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e, true));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  setData(layout: Layout, selection: Selection): void {
    if (layout !== this.layout) {
      this.layout = layout;
      const tracks = worldTracks(layout);
      this.heights = pieceHeights(layout, tracks);
      this.outlines = outlinesOf(tracks);
      this.order = lowestFirst(this.outlines);
    }
    this.selection = selection;
    this.draw();
  }

  setRunMarks(marks: RunMarks | null): void {
    this.runMarks = marks?.pieces.length ? marks : null;
    this.draw();
    if (this.runMarks && !this.blinking) {
      this.blinking = true;
      const tick = () => {
        if (!this.runMarks) {
          this.blinking = false;
          return;
        }
        this.paint();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }

  setClashes(clashes: readonly Clash[]): void {
    this.clashes = clashes;
    this.draw();
  }

  /** Colour by height and show only the pieces from a level up (spec 8). */
  setHeightView(view: HeightView): void {
    this.heightView = view;
    this.draw();
  }

  /** Height of the highest road, mm. */
  get topHeight(): number {
    return Math.max(0, ...this.heights.map((r) => r[1]));
  }

  /** Whether a piece shows under the level filter; the others are faint and cannot be picked. */
  private shown(piece: number): boolean {
    return atLevel(this.heights[piece] ?? [0, 0], this.heightView.level);
  }

  /** Current zoom, px per mm. */
  get pxPerMm(): number {
    return this.scale;
  }

  /** World point (mm) at the middle of the view. */
  get centre(): [number, number] {
    return [this.cx, this.cz];
  }

  /** Point on the page over the world point (mm). */
  clientOf(x: number, _y: number, z: number): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    const [sx, sy] = this.toScreen(x, z);
    return [r.left + sx, r.top + sy];
  }

  /** World X/Z (mm) under a point on the page, or null when it is off the view. */
  floorAt(clientX: number, clientY: number): [number, number] | null {
    const r = this.canvas.getBoundingClientRect();
    const [sx, sy] = [clientX - r.left, clientY - r.top];
    if (sx < 0 || sy < 0 || sx > r.width || sy > r.height) return null;
    return this.toWorld(sx, sy);
  }

  /** Zoom and pan so the whole course fits. */
  fit(): void {
    const pts = this.outlines.flatMap((o) => o.polygon);
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    if (pts.length === 0) {
      this.cx = 0;
      this.cz = 0;
      this.scale = Math.min(w, h) / 2000;
    } else {
      const xs = pts.map((p) => p[0]);
      const zs = pts.map((p) => p[1]);
      const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
      this.cx = (x0 + x1) / 2;
      this.cz = (z0 + z1) / 2;
      this.scale = Math.min(w / (x1 - x0 + 400), h / (z1 - z0 + 400));
    }
    this.draw();
  }

  // Screen right is world −X and screen up is world +Z, so this is the view from above.
  private toScreen(x: number, z: number): [number, number] {
    return [this.canvas.clientWidth / 2 - (x - this.cx) * this.scale, this.canvas.clientHeight / 2 - (z - this.cz) * this.scale];
  }

  private toWorld(sx: number, sy: number): [number, number] {
    return [this.cx - (sx - this.canvas.clientWidth / 2) / this.scale, this.cz - (sy - this.canvas.clientHeight / 2) / this.scale];
  }

  draw(): void {
    this.paint();
    this.handlers.onViewChange?.();
  }

  private paint(): void {
    const { canvas, ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1b1d22';
    ctx.fillRect(0, 0, w, h);
    this.drawGrid(w, h);
    const layout = this.layout;
    if (!layout) return;

    const path = (pts: [number, number][], close: boolean) => {
      ctx.beginPath();
      pts.forEach(([x, z], i) => {
        const [sx, sy] = this.toScreen(x, z);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      if (close) ctx.closePath();
    };

    const range = colorRange(this.topHeight);
    for (const i of this.order) {
      const o = this.outlines[i];
      if (!this.shown(o.piece)) {
        path(o.polygon, true);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        ctx.stroke();
        continue;
      }
      const pc = layout.pieces[o.piece];
      if (this.heightView.colors) {
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
    }

    const sel = this.selection;
    if (sel?.kind === 'piece') {
      // The pieces joined to the selection move with it: outline them too.
      const group = layout.group[sel.index];
      for (const o of this.outlines) {
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

    const run = this.runMarks;
    if (run) {
      const pieces = new Set(run.pieces);
      const b = blink(performance.now());
      for (const o of this.outlines) {
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
      if (!this.shown(j.a.piece) && !this.shown(j.b.piece)) continue;
      const selected = sel?.kind === 'joint' && sameJoint(sel, j);
      this.drawJoint(j.a, selected ? '#3fd0ff' : '#39c26b', selected ? 1.6 : 1);
    }
    const split = new Set(layout.split.map(portKey));
    const intended = new Set(layout.intended.map(portKey));
    for (const ref of layout.open) {
      if (!this.shown(ref.piece)) continue;
      const key = portKey(ref);
      const selected = sel?.kind === 'port' && portKey(sel.ref) === key;
      // Ports left open on purpose are grey (#13).
      const color = selected ? '#3fd0ff' : split.has(key) ? '#ff5a5a' : intended.has(key) ? '#8a9099' : '#ff9a2e';
      this.drawPort(ref, color, selected ? 1.3 : 1);
    }
    for (const c of this.clashes) {
      const [sx, sy] = this.toScreen(c.at.x, c.at.z);
      drawClashMark(ctx, sx, sy, c.kind);
    }
    if (run?.missing && run.end) {
      const [sx, sy] = this.portPoint(run.end);
      drawShortMark(ctx, sx, sy - 26, run.missing);
    }
  }

  /**
   * A bar across the track at a port, `reach` of its width long, in `color`
   * for strokes and fills; returns the screen point at its middle.
   */
  private drawBar(ref: PortRef, reach: number, color: string, size: number): [number, number] {
    const pc = this.layout!.pieces[ref.piece];
    const frame = pc.ports[ref.port];
    const half = halfWidth(pc.part.ports[ref.port].lanes.length) * reach;
    const p = new Vector3();
    const [ax, ay] = this.toScreen(...xz(pointOnFrame(frame, -half, 0, p)));
    const [bx, by] = this.toScreen(...xz(pointOnFrame(frame, half, 0, p)));
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3 * size;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    return this.portPoint(ref);
  }

  /** Screen point at the middle of a port. */
  private portPoint(ref: PortRef): [number, number] {
    return this.toScreen(...xz(pointOnFrame(this.layout!.pieces[ref.piece].ports[ref.port], 0, 0, new Vector3())));
  }

  /** A short bar across the middle of a joint. */
  private drawJoint(ref: PortRef, color: string, size: number): void {
    const [cx, cy] = this.drawBar(ref, 0.6, color, size);
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(cx, cy, 4 * size, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawGrid(w: number, h: number): void {
    const { ctx } = this;
    // Grid every 100 mm, stronger every metre; skip the fine grid when zoomed out.
    for (const [step, color] of [
      [100, 'rgba(255,255,255,0.04)'],
      [1000, 'rgba(255,255,255,0.09)'],
    ] as const) {
      if (step * this.scale < 8) continue;
      const [xa, za] = this.toWorld(w, h);
      const [xb, zb] = this.toWorld(0, 0);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = Math.ceil(xa / step) * step; x <= xb; x += step) {
        const [sx] = this.toScreen(x, 0);
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, h);
      }
      for (let z = Math.ceil(za / step) * step; z <= zb; z += step) {
        const [, sy] = this.toScreen(0, z);
        ctx.moveTo(0, sy);
        ctx.lineTo(w, sy);
      }
      ctx.stroke();
    }
  }

  /** A bar across the track at the port with an arrow pointing out of the piece. */
  private drawPort(ref: PortRef, color: string, size: number): void {
    const [cx, cy] = this.drawBar(ref, 1, color, size);
    const frame = this.layout!.pieces[ref.piece].ports[ref.port];
    const [fx, fy] = this.toScreen(...xz(new Vector3(0, 0, 1).applyMatrix4(frame)));
    const len = Math.hypot(fx - cx, fy - cy) || 1;
    const [dx, dy] = [(fx - cx) / len, (fy - cy) / len];
    const { ctx } = this;
    const r = 9 * size;
    ctx.beginPath();
    ctx.moveTo(cx + dx * r * 1.6, cy + dy * r * 1.6);
    ctx.lineTo(cx - dy * r, cy + dx * r);
    ctx.lineTo(cx + dy * r, cy - dx * r);
    ctx.closePath();
    ctx.fill();
  }

  private pick(sx: number, sy: number): Selection {
    const layout = this.layout;
    if (!layout) return null;
    let best: { ref: PortRef; d: number } | null = null;
    for (const ref of layout.open) {
      if (!this.shown(ref.piece)) continue;
      const [px, py] = this.portPoint(ref);
      const d = Math.hypot(px - sx, py - sy);
      if (d < PORT_HIT && (!best || d < best.d)) best = { ref, d };
    }
    if (best) return { kind: 'port', ref: best.ref };
    let joint: { a: PortRef; b: PortRef; d: number } | null = null;
    for (const j of layout.joints) {
      if (!this.shown(j.a.piece) && !this.shown(j.b.piece)) continue;
      const [px, py] = this.portPoint(j.a);
      const d = Math.hypot(px - sx, py - sy);
      if (d < JOINT_HIT && (!joint || d < joint.d)) joint = { a: j.a, b: j.b, d };
    }
    if (joint) return { kind: 'joint', a: joint.a, b: joint.b };
    const piece = this.pieceAt(sx, sy);
    return piece === null ? null : { kind: 'piece', index: piece };
  }

  /** The topmost piece under a screen point. */
  private pieceAt(sx: number, sy: number): number | null {
    const [x, z] = this.toWorld(sx, sy);
    for (let k = this.order.length - 1; k >= 0; k--) {
      const o = this.outlines[this.order[k]];
      if (this.shown(o.piece) && insidePolygon(x, z, o.polygon)) return o.piece;
    }
    return null;
  }

  private local(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 1) {
      this.dragged = false;
      this.downAt = p;
      // Dragging the selected piece moves it; dragging anything else pans.
      const sel = this.selection;
      this.moving = sel?.kind === 'piece' && this.pieceAt(p.x, p.y) === sel.index && this.handlers.onDragStart(sel.index);
    } else {
      if (this.moving) this.handlers.onDragEnd(false);
      this.moving = false;
      this.dragged = true;
      this.pinch = { dist: this.pinchDistance(), scale: this.scale };
    }
  }

  private onMove(e: PointerEvent): void {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const p = this.local(e);
    if (!this.dragged && Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) > TAP_SLOP) this.dragged = true;
    if (this.dragged && this.moving) {
      const [x0, z0] = this.toWorld(this.downAt.x, this.downAt.y);
      const [x1, z1] = this.toWorld(p.x, p.y);
      this.pointers.set(e.pointerId, p);
      this.handlers.onDragMove(x1 - x0, z1 - z0, e.shiftKey);
      return;
    }
    if (this.dragged) {
      // Pan by the movement of this pointer (halved while pinching with two).
      const k = this.pointers.size;
      this.cx += (p.x - prev.x) / this.scale / k;
      this.cz += (p.y - prev.y) / this.scale / k;
    }
    this.pointers.set(e.pointerId, p);
    if (this.pinch && this.pointers.size === 2) {
      const mid = this.pinchMid();
      this.zoomAt(mid.x, mid.y, (this.pinch.scale * this.pinchDistance()) / this.pinch.dist);
    }
    this.draw();
  }

  private onUp(e: PointerEvent, cancelled = false): void {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.pointers.size < 2) this.pinch = null;
    if (this.moving && this.pointers.size === 0) {
      this.moving = false;
      this.handlers.onDragEnd(this.dragged && !cancelled);
      if (this.dragged) return;
    }
    if (this.pointers.size === 0 && !this.dragged && !cancelled) {
      const p = this.local(e);
      this.handlers.onPick(this.pick(p.x, p.y));
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const p = this.local(e);
    this.zoomAt(p.x, p.y, this.scale * Math.exp(-e.deltaY * 0.0015));
    this.draw();
  }

  private zoomAt(sx: number, sy: number, scale: number): void {
    const [x, z] = this.toWorld(sx, sy);
    this.scale = Math.min(5, Math.max(0.01, scale));
    const [x2, z2] = this.toWorld(sx, sy);
    this.cx += x - x2;
    this.cz += z - z2;
  }

  private pinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  }

  private pinchMid(): { x: number; y: number } {
    const [a, b] = [...this.pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
}
