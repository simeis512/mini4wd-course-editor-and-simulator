import { addFreeItem, itemSpot, joinItem, nextOpenPort, type PaletteItem } from '../course/add';
import {
  emptyCourse,
  layoutCourse,
  portKey,
  sameJoint,
  type Course,
  type Layout,
  type PortRef,
} from '../course/course';
import { addPiece, markIntended, reverseDirection } from '../course/edit';
import { findClashes } from '../course/clash';
import { stopperContacts } from '../course/stopper-contact';
import { checkLaps } from '../course/laps';
import { basicOval } from '../course/presets';
import { renderCourseInfo, type CourseChecks } from './checks';
import { $, toast } from './dom';
import { PaletteDrag, PieceDrag, PropDrag, type DragHost } from './drag';
import { History } from './history';
import { Library } from './library';
import { levelMax, renderLevelTools, type HeightView } from './levels';
import { buildPalette, placeContext, renderPanels, runMarks } from './panels';
import { PropTools } from './props';
import { isProp, type Selection } from './selection';
import { showNoticeOnStart } from './notice';
import type { ShareImage } from './share-image';
import { renderTurnTools } from './turn-tools';
import { exportJson, fileName, HashSync, readCourseFile, readHash } from './share';
import type { EditorView } from './view';
import { TopView } from './view2d';
import { OrbitView } from './view3d';
import { perfReport, perfSpan } from './perf';
import { bindAppUi, readRaiseFields } from './app-ui';
import { editSelection, raiseSides, type SelectedAction } from './selected-edits';

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
  private share: ShareImage | undefined;
  private paletteDrag: PaletteDrag;
  private pieceDrag: PieceDrag;
  private propDrag: PropDrag;
  /** The drag going on in a view, if any. */
  private drag: PieceDrag | PropDrag | null = null;
  private props: PropTools;
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
      get topDown() {
        return app.mode === '2d';
      },
      screenMm: (px) => this.screenMm(px),
      commit: (next, selection) => this.commit(next, selection),
      refresh: (writeUrl) => this.refresh(writeUrl),
    };
    this.paletteDrag = new PaletteDrag(host);
    this.pieceDrag = new PieceDrag(host);
    this.propDrag = new PropDrag(host);
    this.props = new PropTools({
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
      get views() {
        return [app.top, app.orbit];
      },
      commit: (next, selection) => this.commit(next, selection),
      select: (selection) => this.select(selection),
    });
    this.library = new Library({
      get course() {
        return app.course;
      },
      open: (course) => this.load(course, true),
    });
    const handlers = {
      onPick: (s: Selection) => this.select(s),
      onViewChange: () => {
        this.placeContext();
        if (this.top) renderTurnTools(this.top);
        this.share?.later();
      },
      onDragStart: (target: NonNullable<Selection>) => {
        this.drag = target.kind === 'piece' ? this.pieceDrag : isProp(target) ? this.propDrag : null;
        if (target.kind === 'piece') return this.pieceDrag.start(target.index);
        return isProp(target) && this.propDrag.start(target);
      },
      onDragMove: (dx: number, dz: number, noSnap: boolean) => this.drag?.move(dx, dz, noSnap),
      onDragEnd: (commit: boolean) => {
        this.drag?.end(commit);
        this.drag = null;
      },
    };
    this.top = new TopView($('view2d'), handlers);
    this.orbit = new OrbitView($('view3d'), handlers);
    buildPalette({
      click: (item) => {
        if (this.paletteDrag.clickAdds) this.place(item);
      },
      down: (e, item) => this.paletteDrag.down(e, item),
      move: (e) => this.paletteDrag.move(e),
      up: (e, cancelled) => this.paletteDrag.up(e, cancelled),
    });
    this.share = bindAppUi({
      get selection() { return app.selection; },
      top: this.top,
      checks: {
        pick: (t) => {
          if ('stopper' in t) this.props.showStoppers();
          this.select(this.selectionOf(t));
        },
        intended: (ref, on) => this.commit(markIntended(this.course, ref, on), this.selection),
        reverse: () => this.commit(reverseDirection(this.course), this.selection),
      },
      sharing: {
        get view() { return app.view; },
        get layout() { return app.layout; },
        get laps() { return app.checks.laps; },
        name: () => this.courseTitle(),
        url: () => this.hashSync.url(),
        get fileName() { return fileName(app.course); },
      },
      setHeightView: (view) => this.setHeightView(view),
      renderCourseInfo: () => renderCourseInfo(this.course, this.layout, this.checks),
      overPanel: (e) => this.pieceDrag.overPanel(e),
      placeContext: () => this.placeContext(),
      select: (selection) => this.select(selection),
      setMode: (mode) => this.setMode(mode),
      undo: () => this.undo(),
      redo: () => this.redo(),
      newCourse: async () => {
        if (await this.library.confirmReplace('新しく作る')) this.load(emptyCourse(), true);
      },
      copyUrl: () => this.hashSync.copyUrl(),
      exportJson: () => exportJson(this.course),
      importJson: (file) => this.importJson(file),
      fit: () => this.view.fit(),
      edit: (action) => this.edit(action),
      renderPanel: () => this.renderPanel(),
    });
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
    this.refresh(writeUrl);
    // After the refresh, which counts as an edit, so the new course starts unchanged.
    this.library.replaced();
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
  private selectionOf(t: { piece: number } | PortRef | { stopper: number }): Selection {
    if ('stopper' in t) return { kind: 'stopper', index: t.stopper };
    if (!('port' in t)) return { kind: 'piece', index: t.piece };
    const joint = this.layout.joints.find((j) => [j.a, j.b].some((r) => portKey(r) === portKey(t)));
    return joint ? { kind: 'joint', a: joint.a, b: joint.b } : { kind: 'port', ref: t };
  }

  private select(selection: Selection): void {
    this.selection = selection;
    this.refresh(false);
  }

  private refresh(writeUrl: boolean): void {
    perfReport(`refresh:${this.mode}`, () => {
      const views = [this.top, this.orbit];
      for (const view of views) view.beginUpdate();
      try {
        this.refreshData(writeUrl);
      } finally {
        for (const view of views) view.endUpdate();
      }
    });
  }

  private refreshData(writeUrl: boolean): void {
    this.layout = perfSpan('layout', () => layoutCourse(this.course));
    // Drop a selection that no longer exists (e.g. a port that got closed).
    const s = this.selection;
    if (s?.kind === 'port' && !this.layout.open.some((r) => portKey(r) === portKey(s.ref))) this.selection = null;
    if (s?.kind === 'piece' && s.index >= this.course.pieces.length) this.selection = null;
    if (s?.kind === 'joint' && !this.layout.joints.some((j) => sameJoint(s, j))) this.selection = null;
    if ((s?.kind === 'start' && !this.layout.start) || (s?.kind === 'timer' && !this.layout.timer)) this.selection = null;
    if (s?.kind === 'stopper') {
      const stopper = this.layout.stoppers[s.index];
      if (!stopper) this.selection = null;
      else if (s.point !== undefined && (stopper.kind !== 'hose' || s.point >= stopper.points.length)) this.selection = { kind: 'stopper', index: s.index };
    }
    this.checks = {
      clashes: [...perfSpan('clashes', () => findClashes(this.layout)), ...perfSpan('stopperContacts', () => stopperContacts(this.layout))],
      laps: perfSpan('laps', () => checkLaps(this.layout, this.course.dir)),
    };
    for (const view of [this.top, this.orbit]) {
      view.setData(this.layout, this.selection);
      view.setClashes(this.checks.clashes);
    }
    this.setHeightView(this.heightView);
    this.renderPanel();
    perfSpan('url+save', () => {
      this.share?.later();
      if (writeUrl) {
        this.hashSync.write(this.course);
        this.library.changed();
      }
    });
  }

  private async onHashChange(): Promise<void> {
    if (this.hashSync.isOwn(location.hash)) return;
    const course = await readHash();
    if (course === undefined) return;
    // Staying: put the course being edited back in the URL.
    if (await this.library.confirmReplace()) this.load(course ?? emptyCourse(), false);
    else this.hashSync.write(this.course);
  }

  // ---- Commands

  /** Select the new last piece's next open port, to keep going from. */
  private nextPort(next: Course, port: number): Selection {
    const ref = nextOpenPort(next, port);
    return ref && { kind: 'port', ref };
  }

  /**
   * Add a part or template from the parts list: joined to the selected open
   * port, a part as the first piece at the origin, or else on its own in a
   * free spot near the middle of the view (#41, #63). One edit, so one undo.
   */
  private place(item: PaletteItem): void {
    const s = this.selection;
    if (this.course.pieces.length === 0 && 'part' in item) {
      const port = item.port ?? 0;
      const next = addPiece(this.course, item.part, null, port);
      this.commit(next, this.nextPort(next, port));
      return;
    }
    if (s?.kind === 'port') {
      const joined = joinItem(this.course, item, s.ref);
      if (joined) {
        this.commit(joined.course, this.nextPort(joined.course, joined.port));
        return;
      }
      toast(`選んだ口にはつなげない${'template' in item ? 'テンプレート' : 'パーツ'}なので、単体で置きました`);
    }
    const [cx, cz] = this.view.centre;
    const [x, z] = itemSpot(this.course, item, cx, cz);
    const next = addFreeItem(this.course, item, x, z);
    this.commit(next, { kind: 'piece', index: next.pieces.length - 1 });
  }

  /** Route edits to props or the selected course piece/joint, recording one undo. */
  private edit(action: SelectedAction): void {
    if (action.kind === 'delete' && this.props.deleteSelected()) return;
    if (action.kind === 'rotate' && this.props.turnSelected(action.deg)) return;
    const next = editSelection({
      course: this.course, layout: this.layout, selection: this.selection, moveAlone: this.moveAlone,
    }, action);
    if (next) this.commit(next.course, next.selection);
  }

  private get snapOn(): boolean {
    return $<HTMLInputElement>('snap').checked;
  }

  private get moveAlone(): boolean {
    return $<HTMLInputElement>('move-alone').checked;
  }

  /** Blink the pieces a raise from the selected joint would move (spec 16.3). */
  private showRun(): void {
    const fields = readRaiseFields();
    const sides = $('raise-box').hidden ? null : raiseSides(this.course, this.selection, fields.intoA);
    const marks = sides ? runMarks(sides.course, sides.from, sides.into, fields.count) : null;
    for (const view of [this.top, this.orbit]) view.setRunMarks(marks);
    this.lit = marks?.pieces ?? [];
  }

  private async importJson(file: File): Promise<void> {
    try {
      const course = await readCourseFile(file);
      if (!(await this.library.confirmReplace())) return;
      this.load(course, true);
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
    this.share?.later();
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

  /** The course's name to write on its pictures: its own, or the name it was saved under. */
  private async courseTitle(): Promise<string> {
    return this.course.name || (await this.library.savedName());
  }

  private renderPanel(): void {
    perfSpan('panel', () => this.renderPanelData());
  }

  private renderPanelData(): void {
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
