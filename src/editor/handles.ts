import { Vector3 } from 'three';
import { layoutCourse, movingGroup, type Course, type Layout } from '../course/course';
import {
  alongScreen, handleFrame, handleMatrix, lowestPort, nearestRingDeg, ringPoint, snapTo, stopperEdit, stopperFrame, stopperReach, wrapDeg,
  type HandleEdit, type HandleFrame,
} from '../course/handles';
import { hoseLength } from '../course/stoppers';
import { $ } from './dom';
import { SNAP_STEP, type DragHost } from './drag';
import { editSelection } from './selected-edits';

/** Screen radius of the turning ring, px; the other handles are sized from it. */
const RING_PX = 70;
/** A hose's or box's ring goes round it this far out, px, but no wider than `RING_MAX_PX` (#62). */
const RING_CLEAR_PX = 22;
const RING_MAX_PX = 3 * RING_PX;
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
/** Growing steps of a hose with snapping on, as a share of its size (provisional, #62). */
const SCALE_SNAP = 0.05;
/** The grow handle sits right and down of the ring, this far out, px (clear of the settings box). */
const SCALE_GAP = 20;
/** …and its arrows reach this far either way along the diagonal, px. */
const SCALE_HALF = 12;
/** Points drawn round the ring. */
const RING_DRAW_POINTS = 64;

const COLORS = { along: '#ff8a5c', across: '#5ad17a', turn: '#58a6ff', lift: '#e8c547', scale: '#c58cff', scaleX: '#ff7ab8', scaleZ: '#5fd3e0' } as const;

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

/** What has handles: the selected piece, or a whole hose or box (#53). */
type Target = { kind: 'piece' | 'stopper'; index: number };

/** The handles of the selection as they show now, in stage px. */
interface Shown {
  target: Target;
  centre: Vector3;
  /** The middle on the stage. */
  middle: Point;
  ringMm: number;
  ringPx: number;
  ring: Point[];
  along: ScreenAxis | null;
  across: ScreenAxis | null;
  /** Pieces only: stoppers stay on the floor. */
  lift: { at: Point; dir: Point; axis: Point; mm: number } | null;
  /** Hoses only: grow every way (diagonal), or along the world's X or Z, named as they show (横/縦). */
  scales: { kind: 'scale' | 'scaleX' | 'scaleZ'; at: Point; dir: Point; name: string }[];
  /** Points whose own drag wins over a handle drawn across them (a hose's points). */
  avoid: Point[];
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
 * arrow lifts it, with the group that moves with it. A selected hose or box
 * gets the arrows and ring too, and a hose a diagonal arrow to grow it. Drawn over whichever
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
    this.shown = this.paused ? null : this.measureSelection(layout);
    this.paint();
  }

  /** The handles of the selected piece, or of the selected hose or box (not one of a hose's points). */
  private measureSelection(layout: Layout): Shown | null {
    const s = this.host.selection;
    if (s?.kind === 'piece' && layout.pieces[s.index]) return this.measure({ kind: 'piece', index: s.index }, handleFrame(layout.pieces[s.index]));
    const stopper = s?.kind === 'stopper' && s.point === undefined ? layout.stoppers[s.index] : undefined;
    if (s?.kind !== 'stopper' || !stopper) return null;
    const shown = this.measure({ kind: 'stopper', index: s.index }, stopperFrame(stopper), stopperReach(stopper));
    if (shown && stopper.kind === 'hose') {
      const [mx, my] = shown.middle;
      const out = shown.ringPx * Math.SQRT1_2 + SCALE_GAP;
      shown.scales.push({ kind: 'scale', at: [mx + out, my + out], dir: [Math.SQRT1_2, Math.SQRT1_2], name: '' });
      // One handle per axis just outside the ring, on whichever side lies right or down on the screen.
      for (const [kind, a] of [['scaleX', shown.across], ['scaleZ', shown.along]] as const) {
        if (!a) continue;
        const len = Math.hypot(...a.axis);
        let dir: Point = [a.axis[0] / len, a.axis[1] / len];
        if (dir[0] + dir[1] < 0) dir = [-dir[0], -dir[1]];
        const r = shown.ringPx + SCALE_GAP;
        shown.scales.push({ kind, at: [mx + dir[0] * r, my + dir[1] * r], dir, name: Math.abs(dir[0]) >= Math.abs(dir[1]) ? '横 ' : '縦 ' });
      }
      shown.avoid = stopper.points.map(([x, z]) => this.toStage(new Vector3(x, 0, z))).filter((p): p is Point => !!p);
    }
    return shown;
  }

  // ---- Where the handles show

  /** Stage px over a world point (mm), or null. */
  private toStage(p: Vector3): Point | null {
    const c = this.host.view.clientOf(p.x, p.y, p.z);
    if (!c) return null;
    const r = this.stage.getBoundingClientRect();
    return [c[0] - r.left, c[1] - r.top];
  }

  /** The handles round frame `f`; a ring that would fall inside `reach` mm grows to go round it. */
  private measure(target: Target, f: HandleFrame, reach = 0): Shown | null {
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
    const ringPx = Math.max(RING_PX, Math.min((reach * pxPer100) / 100 + RING_CLEAR_PX, RING_MAX_PX));
    const ringMm = (ringPx * 100) / pxPer100;
    const ring: Point[] = [];
    for (let i = 0; i <= RING_DRAW_POINTS; i++) {
      const p = this.toStage(ringPoint(f.centre, ringMm, (i * 360) / RING_DRAW_POINTS));
      if (p) ring.push(p);
    }
    const axis = (dir: Vector3): ScreenAxis | null => {
      const v = probe(dir, ringMm);
      if (!v || Math.hypot(...v) < END_ON * ringPx) return null;
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
    const lift = upLen >= END_ON * ringPx
      ? { dir: [up![0] / upLen, up![1] / upLen] as Point, axis: up!, mm: ringMm }
      : { dir: [0, -1] as Point, axis: [0, -1] as Point, mm: LIFT_MM_PER_PX };
    const left = Math.min(...ring.map((p) => p[0]), c[0] - ringPx);
    return {
      target, centre: f.centre, middle: c, ringMm, ringPx, ring, along: axis(f.along), across: axis(f.across),
      lift: target.kind === 'piece' ? { ...lift, at: [left - LIFT_GAP, c[1]] } : null, scales: [], avoid: [],
    };
  }

  /** The handle under a stage point, if any. */
  private hitAt(p: Point): HandleKind | null {
    const s = this.shown;
    if (!s) return null;
    const near = (q: Point) => Math.hypot(q[0] - p[0], q[1] - p[1]) <= HANDLE_HIT;
    if (s.avoid.some(near)) return null;
    if (s.lift && near(s.lift.at)) return 'lift';
    const grow = s.scales.find((g) => near(g.at));
    if (grow) return grow.kind;
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
      low: shown.target.kind === 'piece' ? lowestPort(layout, movingGroup(layout, shown.target.index, moveAlone)) : 0,
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
    const amount = edit.kind === 'turn' ? edit.deg : edit.kind === 'scale' ? edit.factor - 1 : edit.mm;
    const name = d.shown.scales.find((g) => g.kind === d.kind)?.name ?? '';
    d.preview = amount ? this.apply(d, edit) : null;
    d.previewLayout = d.preview && layoutCourse(d.preview);
    const hose = d.previewLayout?.stoppers[d.shown.target.index];
    d.label = !amount ? '' : edit.kind === 'scale' && hose?.kind === 'hose' ? `${name}${labelOf(edit)}（長さ ${Math.round(hoseLength(hose))}mm）` : labelOf(edit);
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
    if (d.kind === 'lift') return { kind: 'lift', mm: mm(s.lift!.axis, s.lift!.mm) };
    if (d.kind === 'scale' || d.kind === 'scaleX' || d.kind === 'scaleZ') {
      // How much farther from the middle the pointer is than where it grabbed: straight out, or along the axis.
      const g = s.scales.find((h) => h.kind === d.kind)!;
      const out = (q: Point) => d.kind === 'scale'
        ? Math.hypot(q[0] - s.middle[0], q[1] - s.middle[1])
        : (q[0] - s.middle[0]) * g.dir[0] + (q[1] - s.middle[1]) * g.dir[1];
      const k = out(p) / (out(d.from) || 1);
      const factor = fine ? Math.round(k * 100) / 100 : Math.round(snapTo(k, SCALE_SNAP) * 100) / 100;
      return { kind: 'scale', factor, axis: d.kind === 'scaleX' ? 'x' : d.kind === 'scaleZ' ? 'z' : undefined };
    }
    const a = (d.kind === 'along' ? s.along : s.across)!;
    return { kind: 'slide', dir: a.dir, mm: mm(a.axis, a.mm) };
  }

  /** The course with the stopper, or the piece's group, changed by `edit`, as the buttons would leave it. */
  private apply(d: HandleDrag, edit: HandleEdit): Course | null {
    const { kind, index } = d.shown.target;
    if (kind === 'stopper') return stopperEdit(d.start, index, edit);
    const by = handleMatrix(d.layout, index, edit, d.low);
    const next = editSelection({ course: d.start, layout: d.layout, selection: { kind: 'piece', index }, moveAlone: this.host.moveAlone }, { kind: 'move', by });
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
    // Lift arrow and grow arrow, both ways
    if (s.lift) doubleArrow(ctx, s.lift.at, s.lift.dir, LIFT_HALF, COLORS.lift, width('lift'));
    for (const g of s.scales) doubleArrow(ctx, g.at, g.dir, SCALE_HALF, COLORS[g.kind], width(g.kind), true);
    // How far the drag has gone
    const label = this.drag?.label;
    if (label) {
      const k = this.drag!.kind;
      const grow = s.scales.find((g) => g.kind === k);
      const [x, y] = k === 'lift' && s.lift ? [s.lift.at[0], s.lift.at[1] - LIFT_HALF - 8]
        : grow ? [grow.at[0], grow.at[1] + SCALE_HALF + 24]
        : [s.ring[0][0], s.ring[0][1] - 12];
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
  if (edit.kind === 'scale') return `${Math.round(edit.factor * 100)}%`;
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

/** Arrows both ways from `at` along `dir` (unit), `half` px each, with a dot between (a square for growing). */
function doubleArrow(ctx: CanvasRenderingContext2D, at: Point, dir: Point, half: number, color: string, width: number, square = false): void {
  const tip = (k: number): Point => [at[0] + dir[0] * half * k, at[1] + dir[1] * half * k];
  arrow(ctx, at, tip(1), color, width);
  arrow(ctx, at, tip(-1), color, width);
  ctx.beginPath();
  if (square) ctx.rect(at[0] - 4, at[1] - 4, 8, 8);
  else ctx.arc(at[0], at[1], 3.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
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
