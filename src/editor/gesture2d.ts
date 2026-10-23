import { snapSquare, type TopCamera } from './top-camera';
import { grabs, TAP_SLOP, type DragHandlers, type PickHandlers, type Selection } from './selection';

/** Only selection, picking and redraw are needed from the top view (#93). */
export interface GestureHost {
  readonly selection: Selection;
  pieceAt(sx: number, sy: number): number | null;
  propAt(sx: number, sy: number): Selection;
  pick(sx: number, sy: number): Selection;
  draw(): void;
}

/** Pointer state for panning, turning, pinching and dragging the selection. */
export class Gesture2d {
  private pointers = new Map<number, { x: number; y: number }>();
  private dragged = false;
  private downAt = { x: 0, y: 0 };
  private pinch: { dist: number; scale: number; twist: number; angle: number } | null = null;
  /** A right-button drag turning the view: where it started round the middle, and the turn then. */
  private turning: { from: number; angle: number } | null = null;
  /** A piece is being dragged instead of the view being panned. */
  private moving = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: TopCamera,
    private handlers: PickHandlers & DragHandlers,
    private host: GestureHost,
  ) {
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e, true));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }

  private toWorld(sx: number, sy: number): [number, number] {
    return this.camera.toWorld(sx, sy, this.canvas.clientWidth, this.canvas.clientHeight);
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
      const sel = this.host.selection;
      const hit: Selection = sel?.kind === 'piece' ? (this.host.pieceAt(p.x, p.y) === sel.index ? sel : null) : this.host.propAt(p.x, p.y);
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
      this.host.draw();
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
    this.host.draw();
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
      this.handlers.onPick(this.host.pick(p.x, p.y));
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const p = this.local(e);
    this.zoomAt(p.x, p.y, this.camera.scale * Math.exp(-e.deltaY * 0.0015));
    this.host.draw();
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
