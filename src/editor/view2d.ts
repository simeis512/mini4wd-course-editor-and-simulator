import type { Clash } from '../course/clash';
import type { Layout, PortRef } from '../course/course';
import { atLevel, pieceHeights, type HeightRange } from '../course/height';
import { insidePolygon, worldTracks } from '../course/mesh';
import type { HeightView } from './levels';
import { lowestFirst, outlinesOf, type Outline } from './outline2d';
import { TopCamera, TURN_STEP_DEG } from './top-camera';
import { propAt } from '../course/props';
import { hosePointAt, stopperBounds } from '../course/stoppers';
import { HANDLE_RADIUS } from './props2d';
import { JOINT_HIT, PORT_HIT, type DragHandlers, type PickHandlers, type Selection } from './selection';
import type { EditorView, RunMarks } from './view';
import { perfSpan } from './perf';
import { paint2d, portPoint } from './paint2d';
import { Gesture2d } from './gesture2d';

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
  private runMarks: RunMarks | null = null;
  private blinking = false;
  private clashes: readonly Clash[] = [];
  private stoppersShown = true;
  private updating = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private handlers: PickHandlers & DragHandlers,
  ) {
    this.ctx = canvas.getContext('2d')!;
    const view = this;
    new Gesture2d(canvas, this.camera, handlers, {
      get selection() { return view.selection; },
      pieceAt: (x, y) => this.pieceAt(x, y),
      propAt: (x, y) => this.propAt(x, y),
      pick: (x, y) => this.pick(x, y),
      draw: () => this.draw(),
    });
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  setData(layout: Layout, selection: Selection): void {
    perfSpan('view2d', () => this.updateData(layout, selection));
  }

  beginUpdate(): void {
    this.updating = true;
  }

  endUpdate(): void {
    this.updating = false;
    perfSpan('view2d', () => this.draw());
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
    this.camera.turnAt(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2, next, this.canvas.clientWidth, this.canvas.clientHeight);
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
    if (this.updating || this.canvas.hidden) return;
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

  private paint(target?: { ctx: CanvasRenderingContext2D; ratio: number }): void {
    paint2d({
      canvas: this.canvas, ctx: this.ctx, camera: this.camera, layout: this.layout,
      outlines: this.outlines, order: this.order, selection: this.selection,
      heights: this.heights, heightView: this.heightView, runMarks: this.runMarks,
      clashes: this.clashes, stoppersShown: this.stoppersShown,
    }, target);
  }

  private portPoint(ref: PortRef): [number, number] {
    return portPoint({ toScreen: (x, z) => this.toScreen(x, z) }, this.layout!, ref);
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
}
