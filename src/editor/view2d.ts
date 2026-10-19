import { Vector3 } from 'three';
import { variantOf } from '../course/catalog';
import { portKey, type Layout, type PortRef } from '../course/course';
import { partGeometry, pointOnFrame } from '../course/geometry';
import { crossSection, halfWidth } from '../course/mesh';
import type { PickHandlers, Selection } from './selection';

interface Outline {
  /** Left edge then right edge reversed: a closed polygon in world X/Z. */
  polygon: [number, number][];
  fences: [number, number][][];
  /** Mean road height, mm; higher pieces are drawn over lower ones. */
  height: number;
}

/** Pixels a pointer may move and still count as a tap. */
const TAP_SLOP = 6;
/** Screen radius for hitting a port, px. */
const PORT_HIT = 22;

/**
 * Top-down 2D editor view drawn on a canvas. Pointer Events only, so mouse,
 * pen and touch behave the same: tap to select, drag to pan, wheel or pinch
 * to zoom.
 */
export class TopView {
  private ctx: CanvasRenderingContext2D;
  private layout: Layout | null = null;
  private outlines: Outline[] = [];
  /** Piece indices from the lowest piece to the highest. */
  private order: number[] = [];
  private selection: Selection = null;
  /** World point (mm) at the canvas centre, and zoom in px per mm. */
  private cx = 0;
  private cz = 0;
  private scale = 0.2;
  private pointers = new Map<number, { x: number; y: number }>();
  private dragged = false;
  private downAt = { x: 0, y: 0 };
  private pinch: { dist: number; scale: number } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private handlers: PickHandlers,
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
      this.outlines = layout.pieces.map((pc) => {
        const samples = partGeometry(pc.part).samples.map((s) => pc.matrix.clone().multiply(s));
        const p = new Vector3();
        const edge = (x: number) => samples.map((f): [number, number] => (pointOnFrame(f, x, 0, p), [p.x, p.z]));
        const section = crossSection(pc.part.lanes);
        return {
          polygon: [...edge(section.left), ...edge(section.right).reverse()],
          fences: section.fences.map(edge),
          height: samples.reduce((sum, f) => sum + f.elements[13], 0) / samples.length,
        };
      });
      // Stable sort keeps placing order between pieces at the same height.
      this.order = this.outlines.map((_, i) => i).sort((a, b) => this.outlines[a].height - this.outlines[b].height);
    }
    this.selection = selection;
    this.draw();
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

    for (const i of this.order) {
      const pc = layout.pieces[i];
      const o = this.outlines[i];
      const color = variantOf(pc.part, pc.rec.variant).color;
      path(o.polygon, true);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
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
    if (sel?.kind === 'piece' && this.outlines[sel.index]) {
      path(this.outlines[sel.index].polygon, true);
      ctx.strokeStyle = '#3fd0ff';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    for (const c of layout.closures) this.drawPort(c.a, '#39c26b', 0.6);
    for (const ref of layout.open) {
      const selected = sel?.kind === 'port' && portKey(sel.ref) === portKey(ref);
      this.drawPort(ref, selected ? '#3fd0ff' : '#ff9a2e', selected ? 1.3 : 1);
    }
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
    const pc = this.layout!.pieces[ref.piece];
    const frame = pc.ports[ref.port];
    const half = halfWidth(pc.part.ports[ref.port].lanes.length);
    const p = new Vector3();
    const [ax, ay] = this.toScreen(...xz(pointOnFrame(frame, -half, 0, p)));
    const [bx, by] = this.toScreen(...xz(pointOnFrame(frame, half, 0, p)));
    const [cx, cy] = this.toScreen(...xz(pointOnFrame(frame, 0, 0, p)));
    const [fx, fy] = this.toScreen(...xz(p.set(0, 0, 1).applyMatrix4(frame)));
    const len = Math.hypot(fx - cx, fy - cy) || 1;
    const [dx, dy] = [(fx - cx) / len, (fy - cy) / len];
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3 * size;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
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
    const p = new Vector3();
    for (const ref of layout.open) {
      const [px, py] = this.toScreen(...xz(pointOnFrame(layout.pieces[ref.piece].ports[ref.port], 0, 0, p)));
      const d = Math.hypot(px - sx, py - sy);
      if (d < PORT_HIT && (!best || d < best.d)) best = { ref, d };
    }
    if (best) return { kind: 'port', ref: best.ref };
    const [x, z] = this.toWorld(sx, sy);
    for (let k = this.order.length - 1; k >= 0; k--) {
      const i = this.order[k];
      if (insidePolygon(x, z, this.outlines[i].polygon)) return { kind: 'piece', index: i };
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
    } else {
      this.dragged = true;
      this.pinch = { dist: this.pinchDistance(), scale: this.scale };
    }
  }

  private onMove(e: PointerEvent): void {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const p = this.local(e);
    if (!this.dragged && Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) > TAP_SLOP) this.dragged = true;
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

function xz(v: Vector3): [number, number] {
  return [v.x, v.z];
}

function insidePolygon(x: number, z: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
