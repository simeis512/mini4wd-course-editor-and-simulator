import { Matrix4, type Vector3 } from 'three';
import { addFreeItem, dropJoin, type PaletteItem } from '../course/add';
import { layoutCourse, movingGroup, type Course, type Layout } from '../course/course';
import { deletePiece, moveGroup, tidyCuts } from '../course/edit';
import { applyMagnet, findMagnet, MAGNET_DISTANCE } from '../course/joining';
import { $, toast } from './dom';
import { propPoint } from '../course/props';
import { moveStopper } from '../course/stoppers';
import { moveStart, nearestRoad, placeTimer } from '../course/timing';
import { TAP_SLOP, type PropSelection, type Selection } from './selection';
import type { EditorView } from './view';
import { perfReport, perfSpan } from './perf';

/** Ports this many screen pixels apart still pull together while dragging. */
const MAGNET_PX = 12;
/** Drag steps with snapping on (spec 8). */
export const SNAP_STEP = 10;
/** A part dropped this close (screen px) to where it would sit on an open port joins that port. */
const DROP_JOIN_PX = 40;
/** …and at least this close in mm, so a zoomed-in view still catches it. */
const DROP_JOIN_MM = 150;

const snap = (v: number) => Math.round(v / SNAP_STEP) * SNAP_STEP;

/** What the drags need from the editor. */
export interface DragHost {
  readonly course: Course;
  readonly layout: Layout;
  readonly selection: Selection;
  /** The view on show. */
  readonly view: EditorView;
  readonly snapOn: boolean;
  readonly moveAlone: boolean;
  /** The view on show looks straight down, so heights do not show. */
  readonly topDown: boolean;
  /** `px` screen pixels in mm on the view, or 0 when it has no single scale. */
  screenMm(px: number): number;
  /** Apply an edit, recording it for undo. */
  commit(next: Course, selection?: Selection): void;
  /** Show the course as it is again. */
  refresh(writeUrl: boolean): void;
}

/** Dragging a part or a template out of the parts list (#40, #63). */
export class PaletteDrag {
  /** A part or template being dragged out of the parts list, and the course as it would be if dropped now. */
  private paletteDrag: {
    item: PaletteItem;
    pointerId: number;
    from: { x: number; y: number };
    active: boolean;
    preview: Course | null;
  } | null = null;
  /** The click that ends a drag out of the parts list adds nothing more. */
  private swallowClick = false;

  constructor(private host: DragHost) {}

  /** Whether a click on the parts list should add a part, rather than end a drag. */
  get clickAdds(): boolean {
    return !this.swallowClick;
  }

  down(e: PointerEvent, item: PaletteItem): void {
    if (!e.isPrimary || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.paletteDrag = { item, pointerId: e.pointerId, from: { x: e.clientX, y: e.clientY }, active: false, preview: null };
  }

  move(e: PointerEvent): void {
    perfReport('pointermove', () => this.preview(e));
  }

  private preview(e: PointerEvent): void {
    const d = this.paletteDrag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.from.x, e.clientY - d.from.y) <= TAP_SLOP) return;
      d.active = true;
      document.body.classList.add('dragging-part');
      $('context').hidden = true;
    }
    const at = this.host.view.floorAt(e.clientX, e.clientY);
    const preview = at && this.dropCourse(d.item, at[0], at[1], e.shiftKey);
    if (!preview && !d.preview) return;
    d.preview = preview;
    const layout = preview ? layoutCourse(preview) : this.host.layout;
    const selection: Selection = preview ? { kind: 'piece', index: preview.pieces.length - 1 } : this.host.selection;
    perfSpan('preview:setData', () => this.host.view.setData(layout, selection));
  }

  up(e: PointerEvent, cancelled: boolean): void {
    const d = this.paletteDrag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.paletteDrag = null;
    if (!d.active) return;
    document.body.classList.remove('dragging-part');
    this.swallowClick = true;
    setTimeout(() => (this.swallowClick = false));
    if (d.preview && !cancelled) this.host.commit(d.preview, { kind: 'piece', index: d.preview.pieces.length - 1 });
    else this.host.refresh(false);
  }

  /**
   * The course with `item` dropped at (x, z): joined to an open port when
   * it lands about where it would sit there, else on its own (#40).
   */
  private dropCourse(item: PaletteItem, x: number, z: number, noSnap: boolean): Course {
    const joined = perfSpan('dropJoin', () => dropJoin(this.host.course, item, x, z, Math.max(DROP_JOIN_MM, this.host.screenMm(DROP_JOIN_PX))));
    if (joined) return joined;
    if (this.host.snapOn && !noSnap) [x, z] = [snap(x), snap(z)];
    return addFreeItem(this.host.course, item, x, z);
  }
}

/** Dragging a piece around in a view (spec 5.2, 8). */
export class PieceDrag {
  /** A piece being dragged in the top view, and the course as it would be if dropped now. */
  private drag: {
    index: number;
    start: Course;
    group: Set<number>;
    preview: Course | null;
    /** The pointer is over the side panel: dropping there puts a lone piece away (deletes it). */
    overPanel: boolean;
  } | null = null;

  constructor(private host: DragHost) {}

  start(index: number): boolean {
    const { course, layout, moveAlone } = this.host;
    this.drag = { index, start: course, group: movingGroup(layout, index, moveAlone), preview: null, overPanel: false };
    return true;
  }

  /** Follow a piece drag onto the side panel, where a lone piece can be put away. */
  overPanel(e: PointerEvent): void {
    const d = this.drag;
    if (!d?.preview) return;
    const r = $('panel').getBoundingClientRect();
    const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (over !== d.overPanel) {
      d.overPanel = over;
      const lone = d.group.size === 1;
      const zone = $('trash-zone');
      zone.hidden = !over;
      zone.classList.toggle('blocked', !lone);
      zone.textContent = lone
        ? 'ここで離すとピースを片づけます（削除）'
        : 'つながっているピースは片づけられません。分断するか「このピースだけ動かす」にしてください';
    }
    // Show the course without the piece while it would be put away.
    if (over && d.group.size === 1) this.host.view.setData(layoutCourse(deletePiece(d.start, d.index)), null);
  }

  move(dx: number, dz: number, noSnap: boolean): void {
    const d = this.drag;
    if (!d) return;
    if (this.host.snapOn && !noSnap) [dx, dz] = [snap(dx), snap(dz)];
    $('context').hidden = true;
    let next = moveGroup(d.start, d.group, new Matrix4().makeTranslation(dx, 0, dz));
    const magnet = findMagnet(next, d.group, Math.max(MAGNET_DISTANCE, this.host.screenMm(MAGNET_PX)));
    if (magnet) next = applyMagnet(next, d.group, magnet);
    d.preview = next;
    this.host.view.setData(layoutCourse(next), this.host.selection);
  }

  end(commit: boolean): void {
    const d = this.drag;
    this.drag = null;
    $('trash-zone').hidden = true;
    if (!d?.preview) return;
    if (commit && d.overPanel && d.group.size === 1) {
      this.host.commit(deletePiece(d.start, d.index));
      toast('ピースを片づけました（元に戻す で戻せます）');
    } else if (commit && !d.overPanel) this.host.commit(tidyCuts(d.preview), { kind: 'piece', index: d.index });
    else this.host.refresh(false);
  }
}

/**
 * Dragging the start line or the timer along the road, or a stopper or one
 * of a hose's points across the floor (#56, #53).
 */
export class PropDrag {
  private drag: { target: PropSelection; start: Course; layout: Layout; from: Vector3 | null; preview: Course | null } | null = null;

  constructor(private host: DragHost) {}

  start(target: PropSelection): boolean {
    const { course, layout } = this.host;
    // The start and timer follow the road from where they are now.
    const from = target.kind === 'stopper' ? null : propPoint(layout, target);
    this.drag = { target, start: course, layout, from, preview: null };
    return true;
  }

  move(dx: number, dz: number, noSnap: boolean): void {
    const d = this.drag;
    if (!d) return;
    const snapOn = this.host.snapOn && !noSnap;
    $('context').hidden = true;
    const t = d.target;
    let next: Course;
    if (t.kind === 'stopper') {
      if (snapOn) [dx, dz] = [snap(dx), snap(dz)];
      next = moveStopper(d.start, t.index, dx, dz, t.point);
    } else {
      if (!d.from) return;
      // Seen from above any road can be reached; in 3D, roads at the height it was grabbed at come first.
      const spot = nearestRoad(d.layout, d.from.x + dx, d.from.z + dz, this.host.topDown ? undefined : d.from.y);
      if (!spot) return;
      const to = { piece: spot.piece, offset: snapOn ? snap(spot.offset) : spot.offset };
      next = t.kind === 'start' ? moveStart(d.start, to) : placeTimer(d.start, to);
    }
    d.preview = next;
    this.host.view.setData(layoutCourse(next), this.host.selection);
  }

  end(commit: boolean): void {
    const d = this.drag;
    this.drag = null;
    if (!d?.preview) return;
    if (commit) this.host.commit(d.preview, this.host.selection);
    else this.host.refresh(false);
  }
}
