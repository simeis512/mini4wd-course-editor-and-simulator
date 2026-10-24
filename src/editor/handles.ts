import { Vector3 } from 'three';
import { layoutCourse, movingGroup, type Course, type Layout } from '../course/course';
import {
  alongScreen, handleFrame, handleMatrix, lowestPort, nearestRingDeg, ringPoint, snapTo, wrapDeg, type HandleEdit,
} from '../course/handles';
import { $ } from './dom';
import { SNAP_STEP, type DragHost } from './drag';
import { editSelection } from './selected-edits';

/** Screen radius of the turning ring, px; the other handles are sized from it. */
const RING_PX = 70;
/** Arrow heads sit this far out along the ring's radius. */
const ARROW_AT = 0.72;
/** …and their shafts start this far out. */
const SHAFT_FROM = 0.28;
/** Screen radius for hitting a handle, px. */
const HANDLE_HIT = 16;
/** The lift arrow stands this far left of the ring (the settings box keeps to the top right), px, and is this long either way. */
const LIFT_GAP = 30;
const LIFT_HALF = 24;
/** A direction that shows shorter than this share of the ring is seen end on, and gets no arrow. */
const END_ON = 0.3;
/** Lifting seen from straight above: mm per screen px dragged up (provisional, #62). */
const LIFT_MM_PER_PX = 1;
/** Turning steps with snapping on, degrees (spec 8, as the turn buttons). */
const TURN_SNAP = 15;
/** Points drawn round the ring. */
const RING_DRAW_POINTS = 64;

const COLORS = { along: '#ff8a5c', across: '#5ad17a', turn: '#58a6ff', lift: '#e8c547' } as const;

type HandleKind = keyof typeof COLORS;
type Point = [number, number];

/** A direction on screen: where it starts, and how `mm` mm along it shows (px). */
interface ScreenAxis {
  dir: Vector3;
  axis: Point;
  mm: number;
  heads: Point[];
  shafts: [Point, Point][];
}

/** The handles of the selected piece as they show now, in stage px. */
interface Shown {
  index: number;
  centre: Vector3;
  ringMm: number;
  ring: Point[];
  along: ScreenAxis | null;
  across: ScreenAxis | null;
  lift: { at: Point; dir: Point; axis: Point; mm: number };
}

/** A handle being dragged, and the course as it would be if let go now. */
interface HandleDrag {
  kind: HandleKind;
  pointerId: number;
  from: Point;
  shown: Shown;
  start: Course;
  layout: Layout;
  low: number;
  lastDeg: number;
  turned: number;
  preview: Course | null;
  previewLayout: Layout | null;
  label: string;
}

/**
 * CAD-like handles on the selected piece (#62): two pairs of arrows slide it
 * along or across itself, a ring turns it about its middle and an up/down
 * arrow lifts it, with the group that moves with it. Drawn over whichever
 * view is on show, through `EditorView.clientOf`, so 2D and 3D share them.
 */
export class HandleTool {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private shown: Shown | null = null;
  private drag: HandleDrag | null = null;
  private hover: HandleKind | null = null;
  /** Another drag is going on, so the handles keep out of the way. */
  private paused = false;

  constructor(
    private stage: HTMLElement,
    private host: DragHost,
  ) {
    this.canvas = $<HTMLCanvasElement>('handles');
    this.ctx = this.canvas.getContext('2d')!;
    // Capture on the stage so a handle is grabbed before either view sees the pointer.
    stage.addEventListener('pointerdown', (e) => this.onDown(e), { capture: true });
    stage.addEventListener('pointermove', (e) => this.onMove(e));
    stage.addEventListener('pointerup', (e) => this.onUp(e, false));
    stage.addEventListener('pointercancel', (e) => this.onUp(e, true));
  }

  /** Whether a handle is being dragged. */
  get dragging(): boolean {
    return this.drag !== null;
  }

  /** Hide the handles while another drag goes on, and show them again after. */
  pause(paused: boolean): void {
    this.paused = paused;
    this.draw();
  }

  /** Draw the handles for the course and selection as they are now. */
  draw(): void {
    const layout = this.drag?.previewLayout ?? this.host.layout;
    const s = this.host.selection;
    this.shown = !this.paused && s?.kind === 'piece' && layout.pieces[s.index] ? this.measure(layout, s.index) : null;
    this.paint();
  }

  // ---- Where the handles show

  /** Stage px over a world point (mm), or null. */
  private toStage(p: Vector3): Point | null {
    const c = this.host.view.clientOf(p.x, p.y, p.z);
    if (!c) return null;
    const r = this.stage.getBoundingClientRect();
    return [c[0] - r.left, c[1] - r.top];
  }

  private measure(layout: Layout, index: number): Shown | null {
    const f = handleFrame(layout.pieces[index]);
    const c = this.toStage(f.centre);
    if (!c) return null;
    // Size the ring by the longer of the two level directions as they show.
    const probe = (d: Vector3, mm: number): Point | null => {
      const p = this.toStage(f.centre.clone().addScaledVector(d, mm));
      return p && [p[0] - c[0], p[1] - c[1]];
    };
    const pxPer100 = Math.max(...[f.along, f.across].map((d) => {
      const v = probe(d, 100);
      return v ? Math.hypot(...v) : 0;
    }));
    if (pxPer100 <= 0) return null;
    const ringMm = (RING_PX * 100) / pxPer100;
    const ring: Point[] = [];
    for (let i = 0; i <= RING_DRAW_POINTS; i++) {
      const p = this.toStage(ringPoint(f.centre, ringMm, (i * 360) / RING_DRAW_POINTS));
      if (p) ring.push(p);
    }
    const axis = (dir: Vector3): ScreenAxis | null => {
      const v = probe(dir, ringMm);
      if (!v || Math.hypot(...v) < END_ON * RING_PX) return null;
      const at = (k: number): Point => [c[0] + v[0] * k, c[1] + v[1] * k];
      return {
        dir, axis: v, mm: ringMm,
        heads: [at(ARROW_AT), at(-ARROW_AT)],
        shafts: [[at(SHAFT_FROM), at(ARROW_AT)], [at(-SHAFT_FROM), at(-ARROW_AT)]],
      };
    };
    // Up as it shows; seen from straight above it does not, so dragging up the screen lifts.
    const up = probe(new Vector3(0, 1, 0), ringMm);
    const upLen = up ? Math.hypot(...up) : 0;
    const lift = upLen >= END_ON * RING_PX
      ? { dir: [up![0] / upLen, up![1] / upLen] as Point, axis: up!, mm: ringMm }
      : { dir: [0, -1] as Point, axis: [0, -1] as Point, mm: LIFT_MM_PER_PX };
    const left = Math.min(...ring.map((p) => p[0]), c[0] - RING_PX);
    return { index, centre: f.centre, ringMm, ring, along: axis(f.along), across: axis(f.across), lift: { ...lift, at: [left - LIFT_GAP, c[1]] } };
  }

  /** The handle under a stage point, if any. */
  private hitAt(p: Point): HandleKind | null {
    const s = this.shown;
    if (!s) return null;
    const near = (q: Point) => Math.hypot(q[0] - p[0], q[1] - p[1]) <= HANDLE_HIT;
    if (s.lift && near(s.lift.at)) return 'lift';
    if (s.along?.heads.some(near)) return 'along';
    if (s.across?.heads.some(near)) return 'across';
    for (let i = 1; i < s.ring.length; i++) if (segmentDistance(p, s.ring[i - 1], s.ring[i]) <= HANDLE_HIT * 0.6) return 'turn';
    return null;
  }

  // ---- Pointer

  private local(e: PointerEvent): Point {
    const r = this.stage.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private onDown(e: PointerEvent): void {
    // While a handle is dragged, other fingers do nothing in the views.
    if (this.drag) {
      e.stopPropagation();
      return;
    }
    if (!this.shown || !e.isPrimary || e.button !== 0) return;
    const p = this.local(e);
    const kind = this.hitAt(p);
    if (!kind) return;
    e.stopPropagation();
    e.preventDefault();
    this.stage.setPointerCapture(e.pointerId);
    const { course, layout, moveAlone } = this.host;
    const shown = this.shown;
    const deg = kind === 'turn' ? (nearestRingDeg((q) => this.toStage(q), shown.centre, shown.ringMm, p) ?? 0) : 0;
    this.drag = {
      kind, pointerId: e.pointerId, from: p, shown, start: course, layout,
      low: lowestPort(layout, movingGroup(layout, shown.index, moveAlone)),
      lastDeg: deg, turned: 0, preview: null, previewLayout: null, label: '',
    };
  }

  private onMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d) {
      this.setHover(this.hitAt(this.local(e)));
      return;
    }
    if (e.pointerId !== d.pointerId) return;
    const edit = this.editFor(d, this.local(e), !this.host.snapOn || e.shiftKey);
    const amount = edit.kind === 'turn' ? edit.deg : edit.mm;
    d.preview = amount ? this.apply(d, edit) : null;
    d.previewLayout = d.preview && layoutCourse(d.preview);
    d.label = amount ? labelOf(edit) : '';
    $('context').hidden = true;
    this.host.view.setData(d.previewLayout ?? d.layout, this.host.selection);
    this.draw();
  }

  private onUp(e: PointerEvent, cancelled: boolean): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.drag = null;
    if (d.preview && !cancelled) this.host.commit(d.preview, this.host.selection);
    else this.host.refresh(false);
  }

  /** The edit a drag to `p` asks for, in whole steps unless `fine`. */
  private editFor(d: HandleDrag, p: Point, fine: boolean): HandleEdit {
    const mm = (axis: Point, per: number) => {
      const v = alongScreen(axis, per, d.from, p);
      return fine ? Math.round(v) : snapTo(v, SNAP_STEP);
    };
    const s = d.shown;
    if (d.kind === 'turn') {
      const deg = nearestRingDeg((q) => this.toStage(q), s.centre, s.ringMm, p);
      if (deg !== null) {
        d.turned += wrapDeg(deg - d.lastDeg);
        d.lastDeg = deg;
      }
      return { kind: 'turn', deg: fine ? Math.round(d.turned) : snapTo(d.turned, TURN_SNAP) };
    }
    if (d.kind === 'lift') return { kind: 'lift', mm: mm(s.lift.axis, s.lift.mm) };
    const a = (d.kind === 'along' ? s.along : s.across)!;
    return { kind: 'slide', dir: a.dir, mm: mm(a.axis, a.mm) };
  }

  /** The course with the group moved by `edit`, as the move buttons would leave it. */
  private apply(d: HandleDrag, edit: HandleEdit): Course | null {
    const s = d.shown;
    const by = handleMatrix(d.layout, s.index, edit, d.low);
    const next = editSelection({ course: d.start, layout: d.layout, selection: { kind: 'piece', index: s.index }, moveAlone: this.host.moveAlone }, { kind: 'move', by });
    return next?.course ?? null;
  }

  private setHover(kind: HandleKind | null): void {
    if (kind === this.hover) return;
    this.hover = kind;
    this.stage.style.cursor = kind === 'turn' ? 'alias' : kind ? 'grab' : '';
    this.paint();
  }

  // ---- Drawing

  private paint(): void {
    const { canvas, ctx } = this;
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const s = this.shown;
    if (!s) return;
    const active = this.drag?.kind ?? this.hover;
    const width = (k: HandleKind) => (k === active ? 4 : 2.5);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Ring
    ctx.beginPath();
    s.ring.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    stroke(ctx, COLORS.turn, width('turn'));
    // Slide arrows
    for (const kind of ['along', 'across'] as const) {
      const a = s[kind];
      if (!a) continue;
      a.shafts.forEach(([from, to]) => arrow(ctx, from, to, COLORS[kind], width(kind)));
    }
    // Lift arrow, both ways
    const { at, dir } = s.lift;
    const tip = (k: number): Point => [at[0] + dir[0] * LIFT_HALF * k, at[1] + dir[1] * LIFT_HALF * k];
    arrow(ctx, at, tip(1), COLORS.lift, width('lift'));
    arrow(ctx, at, tip(-1), COLORS.lift, width('lift'));
    ctx.beginPath();
    ctx.arc(at[0], at[1], 3.5, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.lift;
    ctx.fill();
    // How far the drag has gone
    const label = this.drag?.label;
    if (label) {
      const [x, y] = this.drag!.kind === 'lift' ? [at[0], at[1] - LIFT_HALF - 8] : [s.ring[0][0], s.ring[0][1] - 12];
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(20, 22, 26, 0.9)';
      ctx.strokeText(label, x, y);
      ctx.fillStyle = COLORS[this.drag!.kind];
      ctx.fillText(label, x, y);
    }
  }
}

/** What a drag has done so far, to show by the handle. */
function labelOf(edit: HandleEdit): string {
  const signed = (v: number, unit: string) => `${v > 0 ? '+' : ''}${v}${unit}`;
  if (edit.kind === 'turn') return signed(edit.deg, '°');
  return edit.kind === 'lift' ? `高さ ${signed(edit.mm, 'mm')}` : signed(edit.mm, 'mm');
}

/** Distance from `p` to the segment a–b, px. */
function segmentDistance(p: Point, a: Point, b: Point): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Stroke the path with a dark edge under the colour, so it shows on any road. */
function stroke(ctx: CanvasRenderingContext2D, color: string, width: number): void {
  ctx.strokeStyle = 'rgba(20, 22, 26, 0.85)';
  ctx.lineWidth = width + 3;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

/** A shaft from `from` with a head at `to`. */
function arrow(ctx: CanvasRenderingContext2D, from: Point, to: Point, color: string, width: number): void {
  const ang = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const head = 9 + width;
  const wing = (s: number): Point => [to[0] - head * Math.cos(ang + s * 0.5), to[1] - head * Math.sin(ang + s * 0.5)];
  ctx.beginPath();
  ctx.moveTo(...from);
  ctx.lineTo(...to);
  stroke(ctx, color, width);
  ctx.beginPath();
  ctx.moveTo(...to);
  ctx.lineTo(...wing(1));
  ctx.lineTo(...wing(-1));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(20, 22, 26, 0.85)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fill();
}
