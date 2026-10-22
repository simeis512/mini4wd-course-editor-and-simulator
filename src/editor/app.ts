import { Matrix4 } from 'three';
import { joinPart, nextOpenPort } from '../course/add';
import { addAttachment, moveAttachment, removeAttachment } from '../course/attachments';
import { LEVEL_HEIGHT } from '../course/catalog';
import {
  emptyCourse,
  layoutCourse,
  movingGroup,
  portKey,
  sameJoint,
  type Course,
  type Layout,
  type PortRef,
} from '../course/course';
import {
  addFreePiece,
  addPiece,
  deletePiece,
  flipPiece,
  freeSpot,
  jointBend,
  jointShift,
  markIntended,
  moveGroup,
  reverseDirection,
  setBend,
  setLength,
  setPose,
  setShift,
  setTwist,
  setVariant,
  tidyCuts,
  turnAboutMiddle,
} from '../course/edit';
import { findClashes } from '../course/clash';
import { asLink, joinableNear, joinPorts, splitJoint } from '../course/joining';
import { checkLaps } from '../course/laps';
import type { Pose } from '../course/geometry';
import { basicOval } from '../course/presets';
import { raiseRun } from '../course/raise';
import { bindAttachments } from './attach';
import { bindCourseInfo, renderCourseInfo, type CourseChecks } from './checks';
import { $, toast } from './dom';
import { PaletteDrag, PieceDrag, SNAP_STEP, type DragHost } from './drag';
import { History } from './history';
import { Library } from './library';
import { bindLevelTools, levelMax, renderLevelTools, type HeightView } from './levels';
import { buildPalette, placeContext, POSE_FIELDS, renderPanels, runMarks } from './panels';
import type { Selection } from './selection';
import { bindAbout, showNoticeOnStart } from './notice';
import { bindShopping } from './shopping';
import { exportJson, HashSync, readCourseFile, readHash } from './share';
import type { EditorView } from './view';
import { TopView } from './view2d';
import { OrbitView } from './view3d';

const HISTORY_LIMIT = 200;

export class EditorApp {
  private course: Course = emptyCourse();
  private layout: Layout = layoutCourse(this.course);
  private checks: CourseChecks = { clashes: [], laps: null };
  private selection: Selection = null;
  /** Pieces lit up for the selection, which its settings keep off. */
  private lit: number[] = [];
  private history = new History<Course>(HISTORY_LIMIT);
  private mode: '2d' | '3d' = '2d';
  private heightView: HeightView = { colors: false, level: 0 };
  private top: TopView;
  private orbit: OrbitView;
  private hashSync = new HashSync();
  private paletteDrag: PaletteDrag;
  private pieceDrag: PieceDrag;
  private library: Library;

  constructor() {
    const app = this;
    const host: DragHost = {
      get course() {
        return app.course;
      },
      get layout() {
        return app.layout;
      },
      get selection() {
        return app.selection;
      },
      get view() {
        return app.view;
      },
      get snapOn() {
        return app.snapOn;
      },
      get moveAlone() {
        return app.moveAlone;
      },
      screenMm: (px) => this.screenMm(px),
      commit: (next, selection) => this.commit(next, selection),
      refresh: (writeUrl) => this.refresh(writeUrl),
    };
    this.paletteDrag = new PaletteDrag(host);
    this.pieceDrag = new PieceDrag(host);
    this.library = new Library({
      get course() {
        return app.course;
      },
      open: (course) => this.load(course, true),
    });
    const handlers = {
      onPick: (s: Selection) => this.select(s),
      onViewChange: () => this.placeContext(),
      onDragStart: (index: number) => this.pieceDrag.start(index),
      onDragMove: (dx: number, dz: number, noSnap: boolean) => this.pieceDrag.move(dx, dz, noSnap),
      onDragEnd: (commit: boolean) => this.pieceDrag.end(commit),
    };
    this.top = new TopView($('view2d'), handlers);
    this.orbit = new OrbitView($('view3d'), handlers);
    buildPalette({
      click: (partId, port) => {
        if (this.paletteDrag.clickAdds) this.place(partId, port);
      },
      down: (e, partId, port) => this.paletteDrag.down(e, partId, port),
      move: (e) => this.paletteDrag.move(e),
      up: (e, cancelled) => this.paletteDrag.up(e, cancelled),
    });
    this.bindUi();
  }

  async start(): Promise<void> {
    const course = await readHash();
    this.load(course ?? basicOval(), !course);
    window.addEventListener('hashchange', () => void this.onHashChange());
    await showNoticeOnStart();
    const resumed = await this.library.resume(!!course, basicOval());
    if (resumed) this.load(resumed, true);
  }

  /** Replace the whole course (new / open), clearing history. */
  private load(course: Course, writeUrl: boolean): void {
    this.course = course;
    this.history.clear();
    this.selection = null;
    this.library.replaced();
    this.refresh(writeUrl);
    this.top.fit();
    this.orbit.fit();
  }

  /** Apply an edit, recording it for undo. */
  private commit(next: Course, selection: Selection = null): void {
    this.history.record(this.course);
    this.course = next;
    this.selection = selection;
    this.refresh(true);
  }

  private undo(): void {
    this.restore(this.history.undo(this.course));
  }

  private redo(): void {
    this.restore(this.history.redo(this.course));
  }

  /** Go back or forward to a course from the history, if there is one. */
  private restore(course: Course | undefined): void {
    if (!course) return;
    this.course = course;
    this.selection = null;
    this.refresh(true);
  }

  /** What to select for a piece or port named in the course box: a joined port selects its joint. */
  private selectionOf(t: { piece: number } | PortRef): Selection {
    if (!('port' in t)) return { kind: 'piece', index: t.piece };
    const joint = this.layout.joints.find((j) => [j.a, j.b].some((r) => portKey(r) === portKey(t)));
    return joint ? { kind: 'joint', a: joint.a, b: joint.b } : { kind: 'port', ref: t };
  }

  private select(selection: Selection): void {
    this.selection = selection;
    this.refresh(false);
  }

  private refresh(writeUrl: boolean): void {
    this.layout = layoutCourse(this.course);
    // Drop a selection that no longer exists (e.g. a port that got closed).
    const s = this.selection;
    if (s?.kind === 'port' && !this.layout.open.some((r) => portKey(r) === portKey(s.ref))) this.selection = null;
    if (s?.kind === 'piece' && s.index >= this.course.pieces.length) this.selection = null;
    if (s?.kind === 'joint' && !this.layout.joints.some((j) => sameJoint(s, j))) this.selection = null;
    this.checks = { clashes: findClashes(this.layout), laps: checkLaps(this.layout, this.course.dir) };
    for (const view of [this.top, this.orbit]) {
      view.setData(this.layout, this.selection);
      view.setClashes(this.checks.clashes);
    }
    this.setHeightView(this.heightView);
    this.renderPanel();
    if (writeUrl) {
      this.hashSync.write(this.course);
      this.library.changed();
    }
  }

  private async onHashChange(): Promise<void> {
    if (this.hashSync.isOwn(location.hash)) return;
    const course = await readHash();
    if (course !== undefined) this.load(course ?? emptyCourse(), false);
  }

  // ---- Commands

  /** Select the new last piece's next open port, to keep going from. */
  private nextPort(next: Course, port: number): Selection {
    const ref = nextOpenPort(next, port);
    return ref && { kind: 'port', ref };
  }

  /**
   * Add a part from the parts list: joined to the selected open port, as the
   * first piece at the origin, or else on its own in a free spot near the
   * middle of the view (#41).
   */
  private place(partId: string, side?: number): void {
    const s = this.selection;
    const port = side ?? 0;
    if (this.course.pieces.length === 0) {
      const next = addPiece(this.course, partId, null, port);
      this.commit(next, this.nextPort(next, port));
      return;
    }
    if (s?.kind === 'port') {
      const joined = joinPart(this.course, partId, s.ref, side);
      if (joined) {
        this.commit(joined.course, this.nextPort(joined.course, joined.port));
        return;
      }
      toast('選んだ口にはつなげないパーツなので、単体で置きました');
    }
    const [cx, cz] = this.view.centre;
    const [x, z] = freeSpot(this.course, partId, port, cx, cz);
    const next = addFreePiece(this.course, partId, port, x, z);
    this.commit(next, { kind: 'piece', index: next.pieces.length - 1 });
  }

  private flipSelected(): void {
    const s = this.selection;
    if (s?.kind !== 'piece') return;
    this.commit(flipPiece(this.course, s.index), s);
  }

  private deleteSelected(): void {
    const s = this.selection;
    if (s?.kind !== 'piece') return;
    this.commit(deletePiece(this.course, s.index));
  }

  // ---- Free placement (spec 5.2, 8)

  private get snapOn(): boolean {
    return $<HTMLInputElement>('snap').checked;
  }

  private get moveAlone(): boolean {
    return $<HTMLInputElement>('move-alone').checked;
  }

  /** Move the selected piece, with the pieces joined to it, by a rigid transform in world space. */
  private moveSelected(by: Matrix4): void {
    const s = this.selection;
    if (s?.kind !== 'piece') return;
    this.commit(tidyCuts(moveGroup(this.course, movingGroup(this.layout, s.index, this.moveAlone), by)), s);
  }

  /** Turn the selected piece about its middle, + to the left (anticlockwise from above). */
  private rotateSelected(deg: number): void {
    const s = this.selection;
    if (s?.kind !== 'piece') return;
    this.moveSelected(turnAboutMiddle(this.layout.pieces[s.index], deg));
  }

  /** Set the selected piece's twist (spec 16.2), or nudge it by `by`. */
  private twistSelected(deg: number | null, by = 0): void {
    const s = this.selection;
    if (s?.kind !== 'piece') return;
    const twist = (deg ?? this.course.pieces[s.index].twist ?? 0) + by;
    this.commit(setTwist(this.course, s.index, twist), s);
  }

  /** Set the selected joint's bend up or down (spec 16.1), or nudge it by `by`. */
  private bendSelected(deg: number | null, by = 0): void {
    const s = this.selection;
    if (s?.kind !== 'joint') return;
    // A joint that only meets (a piece put back by the magnet) is stored as a link first.
    const course = asLink(this.course, s.a, s.b);
    const bend = jointBend(course, s.a, s.b);
    this.commit(setBend(course, s.a, s.b, { ...bend, pitch: (deg ?? bend.pitch ?? 0) + by }), s);
  }

  /** Shift the selected joint sideways by `by` lanes (#60). */
  private shiftSelected(by: number): void {
    const s = this.selection;
    if (s?.kind !== 'joint') return;
    const course = asLink(this.course, s.a, s.b);
    const next = setShift(course, s.a, s.b, jointShift(course, s.a, s.b) + by);
    if (next !== course) this.commit(next, s);
  }

  /**
   * The selected joint as the side a raise leaves from and the side it goes
   * into, as chosen, with the course holding it as a link (spec 16.3).
   */
  private raiseSides(): { from: PortRef; into: PortRef; course: Course } | null {
    const s = this.selection;
    if (s?.kind !== 'joint') return null;
    const intoA = $('raise-dir').dataset.side === 'a';
    const [from, into] = intoA ? [s.b, s.a] : [s.a, s.b];
    return { from, into, course: asLink(this.course, from, into) };
  }

  private get raiseCount(): number {
    return Math.max(1, Math.round(Number($<HTMLInputElement>('raise-count').value) || 1));
  }

  /** Raise the pieces on from the selected joint by bending and twisting them (spec 16.3). */
  private raiseFromSelected(): void {
    const sides = this.raiseSides();
    if (!sides) return;
    const rise = Number($<HTMLInputElement>('raise-mm').value) || 0;
    this.commit(raiseRun(sides.course, sides.from, sides.into, this.raiseCount, rise), this.selection);
  }

  /** Blink the pieces a raise from the selected joint would move (spec 16.3). */
  private showRun(): void {
    const sides = $('raise-box').hidden ? null : this.raiseSides();
    const marks = sides ? runMarks(sides.course, sides.from, sides.into, this.raiseCount) : null;
    for (const view of [this.top, this.orbit]) view.setRunMarks(marks);
    this.lit = marks?.pieces ?? [];
  }

  private splitSelected(): void {
    const s = this.selection;
    if (s?.kind !== 'joint') return;
    this.commit(splitJoint(this.course, s.a, s.b), { kind: 'port', ref: s.b });
  }

  private joinSelected(): void {
    const s = this.selection;
    if (s?.kind !== 'port') return;
    const other = joinableNear(this.layout, s.ref);
    if (other) this.commit(joinPorts(this.course, s.ref, other), { kind: 'joint', a: s.ref, b: other });
  }

  /** Apply an edit to the selected piece, keeping it selected. */
  private editSelected(edit: (index: number) => Course): void {
    const s = this.selection;
    if (s?.kind === 'piece') this.commit(edit(s.index), s);
  }

  private setPoseFromFields(): void {
    const s = this.selection;
    if (s?.kind !== 'piece') return;
    const [x, y, z, yaw, pitch, roll] = POSE_FIELDS.map((id) => Number($<HTMLInputElement>(id).value) || 0);
    const pose: Pose = { pos: [x, y, z], rot: [yaw, pitch, roll] };
    this.commit(setPose(this.course, s.index, pose), s);
  }

  private async importJson(file: File): Promise<void> {
    try {
      this.load(await readCourseFile(file), true);
      toast('コースを読み込みました');
    } catch (e) {
      toast(`読み込めませんでした: ${(e as Error).message}`);
    }
  }

  private setMode(mode: '2d' | '3d'): void {
    this.mode = mode;
    $('mode-2d').setAttribute('aria-pressed', String(mode === '2d'));
    $('mode-3d').setAttribute('aria-pressed', String(mode === '3d'));
    $('view2d').hidden = mode !== '2d';
    $('view3d').hidden = mode !== '3d';
    $('height-tools').hidden = mode !== '2d';
    this.orbit.setActive(mode === '3d');
    if (mode === '2d') this.top.draw();
  }

  /** The view on show. */
  private get view(): EditorView {
    return this.mode === '3d' ? this.orbit : this.top;
  }

  /** `px` screen pixels in mm on the top view; the 3D view has no single scale, so 0 there. */
  private screenMm(px: number): number {
    return this.mode === '2d' ? px / this.top.pxPerMm : 0;
  }

  // ---- UI

  /** Height colours and level filter of the top view (spec 8); the level stays within the course. */
  private setHeightView(view: HeightView): void {
    const top = this.top.topHeight;
    this.heightView = { ...view, level: Math.min(view.level, levelMax(top)) };
    this.top.setHeightView(this.heightView);
    renderLevelTools(top, this.heightView);
  }

  private bindUi(): void {
    bindAbout();
    bindLevelTools((view) => this.setHeightView(view));
    bindShopping(() => renderCourseInfo(this.course, this.layout, this.checks));
    bindCourseInfo({
      pick: (t) => this.select(this.selectionOf(t)),
      intended: (ref, on) => this.commit(markIntended(this.course, ref, on), this.selection),
      reverse: () => this.commit(reverseDirection(this.course), this.selection),
    });
    // Views capture the pointer while dragging, so its moves still bubble up here.
    window.addEventListener('pointermove', (e) => this.pieceDrag.overPanel(e));
    $<HTMLDetailsElement>('course-info').addEventListener('toggle', () => this.placeContext());
    $('context').querySelector('details')!.addEventListener('toggle', () => this.placeContext());
    $('context-close').addEventListener('click', () => this.select(null));
    $('mode-2d').addEventListener('click', () => this.setMode('2d'));
    $('mode-3d').addEventListener('click', () => this.setMode('3d'));
    $('undo').addEventListener('click', () => this.undo());
    $('redo').addEventListener('click', () => this.redo());
    $('new').addEventListener('click', () => {
      if (this.course.pieces.length === 0 || confirm('今のコースを消して新しく作りますか？（URLを控えておけば元に戻せます）')) {
        this.load(emptyCourse(), true);
      }
    });
    $('copy-url').addEventListener('click', () => void this.hashSync.copyUrl());
    $('export').addEventListener('click', () => exportJson(this.course));
    const file = $<HTMLInputElement>('import-file');
    $('import').addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      if (file.files?.[0]) void this.importJson(file.files[0]);
      file.value = '';
    });
    $('fit').addEventListener('click', () => this.view.fit());
    $('flip').addEventListener('click', () => this.flipSelected());
    $('delete').addEventListener('click', () => this.deleteSelected());
    $<HTMLSelectElement>('variant').addEventListener('change', (e) => {
      this.editSelected((i) => setVariant(this.course, i, Number((e.target as HTMLSelectElement).value)));
    });
    $('piece-length').addEventListener('change', (e) => {
      const mm = Number((e.target as HTMLInputElement).value);
      if (mm) this.editSelected((i) => setLength(this.course, i, mm));
    });
    bindAttachments({
      add: (kind) => this.editSelected((i) => addAttachment(this.course, kind, i)),
      move: (n, to) => this.editSelected(() => moveAttachment(this.course, n, to)),
      remove: (n) => this.editSelected(() => removeAttachment(this.course, n)),
    });
    $('rot-left').addEventListener('click', (e) => this.rotateSelected(e.shiftKey ? 1 : 15));
    $('rot-right').addEventListener('click', (e) => this.rotateSelected(e.shiftKey ? -1 : -15));
    // Up and down by one level, a slope's height; Shift for a fine step.
    $('raise').textContent = `↑${LEVEL_HEIGHT}mm`;
    $('lower').textContent = `↓${LEVEL_HEIGHT}mm`;
    $('raise').title = `${LEVEL_HEIGHT}mm（スロープ 1 段）上げる。Shift で ${SNAP_STEP}mm`;
    $('lower').title = `${LEVEL_HEIGHT}mm（スロープ 1 段）下げる。Shift で ${SNAP_STEP}mm`;
    const lift = (e: MouseEvent) => (e.shiftKey ? SNAP_STEP : LEVEL_HEIGHT);
    $('raise').addEventListener('click', (e) => this.moveSelected(new Matrix4().makeTranslation(0, lift(e), 0)));
    $('lower').addEventListener('click', (e) => this.moveSelected(new Matrix4().makeTranslation(0, -lift(e), 0)));
    $<HTMLInputElement>('raise-mm').value = String(LEVEL_HEIGHT);
    for (const id of POSE_FIELDS) $(id).addEventListener('change', () => this.setPoseFromFields());
    // Angles step 0.5°, or 0.1° with Shift (spec 16.3).
    const step = (e: MouseEvent) => (e.shiftKey ? 0.1 : 0.5);
    $('twist-minus').addEventListener('click', (e) => this.twistSelected(null, -step(e)));
    $('twist-plus').addEventListener('click', (e) => this.twistSelected(null, step(e)));
    $('twist').addEventListener('change', (e) => this.twistSelected(Number((e.target as HTMLInputElement).value) || 0));
    $('bend-minus').addEventListener('click', (e) => this.bendSelected(null, -step(e)));
    $('bend-plus').addEventListener('click', (e) => this.bendSelected(null, step(e)));
    $('bend-pitch').addEventListener('change', (e) => this.bendSelected(Number((e.target as HTMLInputElement).value) || 0));
    $('raise-run').addEventListener('click', () => this.raiseFromSelected());
    $('shift-left').addEventListener('click', () => this.shiftSelected(-1));
    $('shift-right').addEventListener('click', () => this.shiftSelected(1));
    $('raise-flip').addEventListener('click', () => {
      const dir = $('raise-dir');
      dir.dataset.side = dir.dataset.side === 'a' ? 'b' : 'a';
      this.renderPanel();
    });
    $('raise-count').addEventListener('input', () => this.renderPanel());
    $('split').addEventListener('click', () => this.splitSelected());
    $('join').addEventListener('click', () => this.joinSelected());

    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, select, textarea')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.redo();
      } else if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (this.selection?.kind === 'joint') this.splitSelected();
        else this.deleteSelected();
      } else if (!mod && e.key.toLowerCase() === 'f') {
        this.flipSelected();
      } else if (!mod && e.key.toLowerCase() === 'q') {
        this.rotateSelected(e.shiftKey ? 1 : 15);
      } else if (!mod && e.key.toLowerCase() === 'e') {
        this.rotateSelected(e.shiftKey ? -1 : -15);
      } else if (e.key === 'Escape') {
        this.select(null);
      }
    });
  }

  private renderPanel(): void {
    $<HTMLButtonElement>('undo').disabled = !this.history.canUndo;
    $<HTMLButtonElement>('redo').disabled = !this.history.canRedo;
    renderPanels(this.course, this.layout, this.selection);
    renderCourseInfo(this.course, this.layout, this.checks);
    this.showRun();
    this.placeContext();
  }

  private placeContext(): void {
    placeContext(this.view, this.layout, this.selection, this.lit);
  }
}
