import { Vector3 } from 'three';
import { variantOf } from '../course/catalog';
import type { Clash } from '../course/clash';
import { portKey, sameJoint, type Layout, type PortRef } from '../course/course';
import { pointOnFrame } from '../course/geometry';
import { atLevel, pieceHeights, type HeightRange } from '../course/height';
import { attachmentOutline } from '../course/attachments';
import { ATTACHMENT_COLOR, halfWidth, insidePolygon, worldTracks } from '../course/mesh';
import { colorRange, heightColor, type HeightView } from './levels';
import { lowestFirst, outlinesOf, xz, type Outline } from './outline2d';
import { snapSquare, TopCamera, TURN_STEP_DEG } from './top-camera';
import { propAt } from '../course/props';
import { hosePointAt, stopperBounds } from '../course/stoppers';
import { drawPropSelection, drawStart, drawStoppers, drawTimer, HANDLE_RADIUS, type Painter } from './props2d';
import { grabs, JOINT_HIT, PORT_HIT, TAP_SLOP, type DragHandlers, type PickHandlers, type Selection } from './selection';
import { blink, drawClashMark, drawShortMark, type EditorView, type RunMarks } from './view';
import { perfSpan } from './perf';

/**
 * Top-down 2D editor view drawn on a canvas. Pointer Events only, so mouse,
 * pen and touch behave the same: tap to select, drag to pan, wheel or pinch
 * to zoom, twist with two fingers or drag with the right mouse button to turn.
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
  private camera = new TopCamera();
  private pointers = new Map<number, { x: number; y: number }>();
  private dragged = false;
  private downAt = { x: 0, y: 0 };
  private pinch: { dist: number; scale: number; twist: number; angle: number } | null = null;
  /** A right-button drag turning the view: where it started round the middle, and the turn then. */
  private turning: { from: number; angle: number } | null = null;
  /** A piece is being dragged instead of the view being panned. */
  private moving = false;
  private runMarks: RunMarks | null = null;
  private blinking = false;
  private clashes: readonly Clash[] = [];
  private stoppersShown = true;

  constructor(
    private canvas: HTMLCanvasElement,
    private handlers: PickHandlers & DragHandlers,
  ) {
    this.ctx = canvas.getContext('2d')!;
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e, true));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  setData(layout: Layout, selection: Selection): void {
    perfSpan('view2d', () => this.updateData(layout, selection));
  }

  private updateData(layout: Layout, selection: Selection): void {
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

  setStoppersShown(shown: boolean): void {
    this.stoppersShown = shown;
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
    return this.camera.scale;
  }

  /** How far the view is turned, degrees clockwise. */
  get angle(): number {
    return this.camera.angle;
  }

  /** Turn the view round its middle to the next step either way (`dir` −1 or 1), or back to unturned (0). */
  turnStep(dir: -1 | 0 | 1): void {
    const a = this.camera.angle;
    const next = dir === 0 ? 0 : (dir > 0 ? Math.floor(a / TURN_STEP_DEG + 1e-6) + 1 : Math.ceil(a / TURN_STEP_DEG - 1e-6) - 1) * TURN_STEP_DEG;
    this.turnAt(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2, next);
    this.draw();
  }

  /** World point (mm) at the middle of the view. */
  get centre(): [number, number] {
    return [this.camera.cx, this.camera.cz];
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
    const floor = this.stoppersShown && this.layout ? stopperBounds(this.layout.stoppers) : null;
    const corners: [number, number][] = floor ? [[floor[0], floor[2]], [floor[1], floor[3]]] : [];
    this.camera.fit(
      [...this.outlines.flatMap((o) => o.polygon), ...corners],
      200,
      this.canvas.clientWidth || 1,
      this.canvas.clientHeight || 1,
    );
    this.draw();
  }

  private toScreen(x: number, z: number): [number, number] {
    return this.camera.toScreen(x, z, this.canvas.clientWidth, this.canvas.clientHeight);
  }

  private toWorld(sx: number, sy: number): [number, number] {
    return this.camera.toWorld(sx, sy, this.canvas.clientWidth, this.canvas.clientHeight);
  }

  draw(): void {
    this.paint();
    this.handlers.onViewChange?.();
  }

  /** The course as it is in view now, without selection, joints, ports or marks, `width` × `height` pixels (the view's shape). */
  snapshot(width: number, height: number): HTMLCanvasElement {
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    this.paint({ ctx: out.getContext('2d')!, ratio: width / (this.canvas.clientWidth || 1) });
    return out;
  }

  /** Draw the view on the page, or only the course onto `target` at `ratio` pixels to the view's pixel. */
  private paint(target?: { ctx: CanvasRenderingContext2D; ratio: number }): void {
    const { canvas } = this;
    const ctx = target?.ctx ?? this.ctx;
    const dpr = target?.ratio ?? (window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!target && (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr))) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1b1d22';
    ctx.fillRect(0, 0, w, h);
    this.drawGrid(ctx, w, h);
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

    const painter: Painter = { ctx, toScreen: (x, z) => this.toScreen(x, z), scale: this.camera.scale };
    // Hoses and boxes lie on the floor, under everything (#53).
    if (this.stoppersShown) drawStoppers(painter, layout);
    const range = colorRange(this.topHeight);
    const drawnMarks = new Set<number>();
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
        // The start line on the road, under anything higher (#56).
        if (layout.start?.piece === o.piece) drawStart(painter, layout);
      }
    }
    // The timer stands high over its lane, so over the road round it.
    if (layout.timer && this.shown(layout.timer.piece)) drawTimer(painter, layout);

    if (target) return;
    const sel = this.selection;
    drawPropSelection(painter, layout, sel);
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

  private drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // Grid every 100 mm, stronger every metre; skip the fine grid when zoomed out.
    // The lines run along the floor, so they turn with the view.
    const corners = [this.toWorld(0, 0), this.toWorld(w, 0), this.toWorld(0, h), this.toWorld(w, h)];
    const xs = corners.map((c) => c[0]);
    const zs = corners.map((c) => c[1]);
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const line = (a: [number, number], b: [number, number]) => {
      ctx.moveTo(...this.toScreen(...a));
      ctx.lineTo(...this.toScreen(...b));
    };
    for (const [step, color] of [
      [100, 'rgba(255,255,255,0.04)'],
      [1000, 'rgba(255,255,255,0.09)'],
    ] as const) {
      if (step * this.camera.scale < 8) continue;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) line([x, z0], [x, z1]);
      for (let z = Math.ceil(z0 / step) * step; z <= z1; z += step) line([x0, z], [x1, z]);
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
    const prop = this.propAt(sx, sy);
    if (prop) return prop;
    const piece = this.pieceAt(sx, sy);
    return piece === null ? null : { kind: 'piece', index: piece };
  }

  /**
   * The start line, timer or stopper under a screen point (#56, #53), or a
   * point of the selected hose; hidden ones are left out.
   */
  private propAt(sx: number, sy: number): Selection {
    const layout = this.layout;
    if (!layout) return null;
    const [x, z] = this.toWorld(sx, sy);
    const mm = (px: number) => px / this.camera.scale;
    const sel = this.selection;
    const hose = sel?.kind === 'stopper' && this.stoppersShown ? layout.stoppers[sel.index] : undefined;
    if (sel?.kind === 'stopper' && hose?.kind === 'hose') {
      const point = hosePointAt(hose, x, z, mm(HANDLE_RADIUS + 4));
      if (point !== null) return { kind: 'stopper', index: sel.index, point };
    }
    const hidden = (piece: number | undefined) => piece === undefined || !this.shown(piece);
    return propAt(layout, x, z, mm(6), (r) => (r.kind === 'stopper' ? !this.stoppersShown : hidden(layout[r.kind]?.piece)));
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
    if (this.pointers.size === 1 && e.pointerType === 'mouse' && e.button === 2) {
      this.dragged = true;
      this.moving = false;
      this.turning = { from: this.aroundMiddle(p), angle: this.camera.angle };
    } else if (this.pointers.size === 1) {
      this.dragged = false;
      this.downAt = p;
      // Dragging the selection moves it; dragging anything else pans.
      const sel = this.selection;
      const hit: Selection = sel?.kind === 'piece' ? (this.pieceAt(p.x, p.y) === sel.index ? sel : null) : this.propAt(p.x, p.y);
      this.moving = !!hit && grabs(sel, hit) && this.handlers.onDragStart(hit);
    } else {
      if (this.moving) this.handlers.onDragEnd(false);
      this.moving = false;
      this.dragged = true;
      this.turning = null;
      this.pinch = { dist: this.pinchDistance(), scale: this.camera.scale, twist: this.pinchTwist(), angle: this.camera.angle };
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
    if (this.turning) {
      this.pointers.set(e.pointerId, p);
      const { from, angle } = this.turning;
      this.turnAt(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2, snapSquare(angle + this.aroundMiddle(p) - from));
      this.draw();
      return;
    }
    if (this.dragged) {
      // Pan by the movement of this pointer (halved while pinching with two).
      const k = this.pointers.size;
      this.camera.pan(prev, { x: prev.x + (p.x - prev.x) / k, y: prev.y + (p.y - prev.y) / k }, this.canvas.clientWidth, this.canvas.clientHeight);
    }
    this.pointers.set(e.pointerId, p);
    if (this.pinch && this.pointers.size === 2) {
      const mid = this.pinchMid();
      this.zoomAt(mid.x, mid.y, (this.pinch.scale * this.pinchDistance()) / this.pinch.dist);
      this.turnAt(mid.x, mid.y, snapSquare(this.pinch.angle + this.pinchTwist() - this.pinch.twist));
    }
    this.draw();
  }

  private onUp(e: PointerEvent, cancelled = false): void {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0) this.turning = null;
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
    this.zoomAt(p.x, p.y, this.camera.scale * Math.exp(-e.deltaY * 0.0015));
    this.draw();
  }

  private zoomAt(sx: number, sy: number, scale: number): void {
    this.camera.zoomAt(sx, sy, scale, this.canvas.clientWidth, this.canvas.clientHeight);
  }

  private turnAt(sx: number, sy: number, angle: number): void {
    this.camera.turnAt(sx, sy, angle, this.canvas.clientWidth, this.canvas.clientHeight);
  }

  /** Where a screen point lies round the middle of the view, degrees clockwise from right. */
  private aroundMiddle(p: { x: number; y: number }): number {
    return (Math.atan2(p.y - this.canvas.clientHeight / 2, p.x - this.canvas.clientWidth / 2) * 180) / Math.PI;
  }

  /** The direction from the first finger to the second, degrees clockwise. */
  private pinchTwist(): number {
    const [a, b] = [...this.pointers.values()];
    return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
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
