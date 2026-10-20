import { Matrix4, Vector3 } from 'three';
import { dropJoin, joinPart, nextOpenPort } from '../course/add';
import { hasPart, LEVEL_HEIGHT } from '../course/catalog';
import { courseFromHash, courseToHash } from '../course/codec';
import {
  emptyCourse,
  layoutCourse,
  movingGroup,
  portKey,
  sameJoint,
  validateCourse,
  type Course,
  type Layout,
} from '../course/course';
import {
  addFreePiece,
  addPiece,
  deletePiece,
  flipPiece,
  freeSpot,
  jointBend,
  moveGroup,
  setBend,
  setPose,
  setTwist,
  setVariant,
  tidyCuts,
} from '../course/edit';
import { applyMagnet, findMagnet, joinableNear, joinPorts, MAGNET_DISTANCE, splitJoint } from '../course/joining';
import type { Pose } from '../course/geometry';
import { basicOval } from '../course/presets';
import { raiseRun } from '../course/raise';
import { $, toast } from './dom';
import { History } from './history';
import { bindLevelTools, levelMax, renderLevelTools, type HeightView } from './levels';
import { buildPalette, placeContext, POSE_FIELDS, renderPanels } from './panels';
import type { Selection } from './selection';
import type { EditorView } from './view';
import { TopView } from './view2d';
import { OrbitView } from './view3d';

const HISTORY_LIMIT = 200;
/** Ports this many screen pixels apart still pull together while dragging. */
const MAGNET_PX = 12;
/** Drag steps with snapping on (spec 8). */
const SNAP_STEP = 10;
/** A part dropped this close (screen px) to where it would sit on an open port joins that port. */
const DROP_JOIN_PX = 40;
/** …and at least this close in mm, so a zoomed-in view still catches it. */
const DROP_JOIN_MM = 150;

const snap = (v: number) => Math.round(v / SNAP_STEP) * SNAP_STEP;

export class EditorApp {
  private course: Course = emptyCourse();
  private layout: Layout = layoutCourse(this.course);
  private selection: Selection = null;
  private history = new History<Course>(HISTORY_LIMIT);
  private mode: '2d' | '3d' = '2d';
  private heightView: HeightView = { colors: false, level: 0 };
  private top: TopView;
  private orbit: OrbitView;
  /** The hash we last wrote, so our own updates are not reloaded. */
  private writtenHash = '';
  private hashWrite = Promise.resolve();
  /** A piece being dragged in the top view, and the course as it would be if dropped now. */
  private drag: {
    index: number;
    start: Course;
    group: Set<number>;
    preview: Course | null;
    /** The pointer is over the side panel: dropping there puts a lone piece away (deletes it). */
    overPanel: boolean;
  } | null = null;
  /** A part being dragged out of the parts list, and the course as it would be if dropped now. */
  private paletteDrag: {
    partId: string;
    port: number | undefined;
    pointerId: number;
    from: { x: number; y: number };
    active: boolean;
    preview: Course | null;
  } | null = null;
  /** The click that ends a drag out of the parts list adds nothing more. */
  private swallowClick = false;

  constructor() {
    const handlers = {
      onPick: (s: Selection) => this.select(s),
      onViewChange: () => this.placeContext(),
      onDragStart: (index: number) => this.dragStart(index),
      onDragMove: (dx: number, dz: number, noSnap: boolean) => this.dragMove(dx, dz, noSnap),
      onDragEnd: (commit: boolean) => this.dragEnd(commit),
    };
    this.top = new TopView($('view2d'), handlers);
    this.orbit = new OrbitView($('view3d'), handlers);
    buildPalette({
      click: (partId, port) => {
        if (!this.swallowClick) this.place(partId, port);
      },
      down: (e, partId, port) => this.paletteDown(e, partId, port),
      move: (e) => this.paletteMove(e),
      up: (e, cancelled) => this.paletteUp(e, cancelled),
    });
    this.bindUi();
  }

  async start(): Promise<void> {
    let course: Course | null = null;
    try {
      course = await courseFromHash(location.hash);
    } catch (e) {
      toast(`URLのコースを読み込めませんでした: ${(e as Error).message}`);
    }
    this.load(course ?? basicOval(), !course);
    window.addEventListener('hashchange', () => void this.onHashChange());
  }

  /** Replace the whole course (new / open), clearing history. */
  private load(course: Course, writeUrl: boolean): void {
    this.course = course;
    this.history.clear();
    this.selection = null;
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
    const prev = this.history.undo(this.course);
    if (!prev) return;
    this.course = prev;
    this.selection = null;
    this.refresh(true);
  }

  private redo(): void {
    const next = this.history.redo(this.course);
    if (!next) return;
    this.course = next;
    this.selection = null;
    this.refresh(true);
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
    this.top.setData(this.layout, this.selection);
    this.orbit.setData(this.layout, this.selection);
    this.setHeightView(this.heightView);
    this.renderPanel();
    if (writeUrl) this.writeUrl();
  }

  private writeUrl(): void {
    const course = this.course;
    // Chain the writes so a slow encode never overwrites a newer one.
    this.hashWrite = this.hashWrite.then(async () => {
      const hash = await courseToHash(course);
      this.writtenHash = hash;
      history.replaceState(null, '', hash || location.pathname + location.search);
    });
  }

  private async onHashChange(): Promise<void> {
    if (location.hash === this.writtenHash) return;
    try {
      const course = await courseFromHash(location.hash);
      this.load(course ?? emptyCourse(), false);
    } catch (e) {
      toast(`URLのコースを読み込めませんでした: ${(e as Error).message}`);
    }
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

  // ---- Dragging a part out of the parts list (#40)

  private paletteDown(e: PointerEvent, partId: string, port: number | undefined): void {
    if (!e.isPrimary || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.paletteDrag = { partId, port, pointerId: e.pointerId, from: { x: e.clientX, y: e.clientY }, active: false, preview: null };
  }

  private paletteMove(e: PointerEvent): void {
    const d = this.paletteDrag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.from.x, e.clientY - d.from.y) <= 6) return;
      d.active = true;
      document.body.classList.add('dragging-part');
      $('context').hidden = true;
    }
    const at = this.view.floorAt(e.clientX, e.clientY);
    const preview = at && this.dropCourse(d.partId, d.port, at[0], at[1], e.shiftKey);
    if (!preview && !d.preview) return;
    d.preview = preview;
    const layout = preview ? layoutCourse(preview) : this.layout;
    const selection: Selection = preview ? { kind: 'piece', index: preview.pieces.length - 1 } : this.selection;
    this.view.setData(layout, selection);
  }

  private paletteUp(e: PointerEvent, cancelled: boolean): void {
    const d = this.paletteDrag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.paletteDrag = null;
    if (!d.active) return;
    document.body.classList.remove('dragging-part');
    this.swallowClick = true;
    setTimeout(() => (this.swallowClick = false));
    if (d.preview && !cancelled) this.commit(d.preview, { kind: 'piece', index: d.preview.pieces.length - 1 });
    else this.refresh(false);
  }

  /**
   * The course with `partId` dropped at (x, z): joined to an open port when
   * it lands about where it would sit there, else on its own (#40).
   */
  private dropCourse(partId: string, port: number | undefined, x: number, z: number, noSnap: boolean): Course {
    const joined = dropJoin(this.course, partId, port, x, z, Math.max(DROP_JOIN_MM, this.screenMm(DROP_JOIN_PX)));
    if (joined) return joined;
    if (this.snapOn && !noSnap) [x, z] = [snap(x), snap(z)];
    return addFreePiece(this.course, partId, port ?? 0, x, z);
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

  private dragStart(index: number): boolean {
    this.drag = { index, start: this.course, group: movingGroup(this.layout, index, this.moveAlone), preview: null, overPanel: false };
    return true;
  }

  /** Follow a piece drag onto the side panel, where a lone piece can be put away. */
  private dragOverPanel(e: PointerEvent): void {
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
    if (over && d.group.size === 1) this.view.setData(layoutCourse(deletePiece(d.start, d.index)), null);
  }

  private dragMove(dx: number, dz: number, noSnap: boolean): void {
    const d = this.drag;
    if (!d) return;
    if (this.snapOn && !noSnap) [dx, dz] = [snap(dx), snap(dz)];
    $('context').hidden = true;
    let next = moveGroup(d.start, d.group, new Matrix4().makeTranslation(dx, 0, dz));
    const magnet = findMagnet(next, d.group, Math.max(MAGNET_DISTANCE, this.screenMm(MAGNET_PX)));
    if (magnet) next = applyMagnet(next, d.group, magnet);
    d.preview = next;
    this.view.setData(layoutCourse(next), this.selection);
  }

  private dragEnd(commit: boolean): void {
    const d = this.drag;
    this.drag = null;
    $('trash-zone').hidden = true;
    if (!d?.preview) return;
    if (commit && d.overPanel && d.group.size === 1) {
      this.commit(deletePiece(d.start, d.index));
      toast('ピースを片づけました（元に戻す で戻せます）');
    } else if (commit && !d.overPanel) this.commit(tidyCuts(d.preview), { kind: 'piece', index: d.index });
    else this.refresh(false);
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
    const pc = this.layout.pieces[s.index];
    const samples = pc.geometry.samples;
    const c = samples
      .reduce((sum, f) => sum.add(new Vector3().setFromMatrixPosition(f)), new Vector3())
      .divideScalar(samples.length)
      .applyMatrix4(pc.matrix);
    const turn = new Matrix4()
      .makeTranslation(c.x, c.y, c.z)
      .multiply(new Matrix4().makeRotationY((deg * Math.PI) / 180))
      .multiply(new Matrix4().makeTranslation(-c.x, -c.y, -c.z));
    this.moveSelected(turn);
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
    const bend = jointBend(this.course, s.a, s.b);
    this.commit(setBend(this.course, s.a, s.b, { ...bend, pitch: (deg ?? bend.pitch ?? 0) + by }), s);
  }

  /** Raise the pieces on from the selected joint by bending and twisting them (spec 16.3). */
  private raiseFromSelected(): void {
    const s = this.selection;
    if (s?.kind !== 'joint') return;
    const count = Math.max(1, Math.round(Number($<HTMLInputElement>('raise-count').value) || 1));
    const rise = Number($<HTMLInputElement>('raise-mm').value) || 0;
    this.commit(raiseRun(this.course, s.a, s.b, count, rise), s);
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

  private setPoseFromFields(): void {
    const s = this.selection;
    if (s?.kind !== 'piece') return;
    const [x, y, z, yaw, pitch, roll] = POSE_FIELDS.map((id) => Number($<HTMLInputElement>(id).value) || 0);
    const pose: Pose = { pos: [x, y, z], rot: [yaw, pitch, roll] };
    this.commit(setPose(this.course, s.index, pose), s);
  }

  private async copyUrl(): Promise<void> {
    await this.hashWrite;
    try {
      await navigator.clipboard.writeText(location.href);
      toast('URLをコピーしました');
    } catch {
      prompt('このURLをコピーしてください', location.href);
    }
  }

  private exportJson(): void {
    const blob = new Blob([JSON.stringify(this.course, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.course.name || 'course'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  private async importJson(file: File): Promise<void> {
    try {
      const data = JSON.parse(await file.text()) as Course;
      if (data?.v !== 1 || !Array.isArray(data.pieces)) throw new Error('コースのファイルではありません');
      for (const rec of data.pieces) if (!hasPart(rec.part)) throw new Error(`不明なパーツ: ${rec.part}`);
      validateCourse(data);
      this.load(data, true);
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
    bindLevelTools((view) => this.setHeightView(view));
    // Views capture the pointer while dragging, so its moves still bubble up here.
    window.addEventListener('pointermove', (e) => this.dragOverPanel(e));
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
    $('copy-url').addEventListener('click', () => void this.copyUrl());
    $('export').addEventListener('click', () => this.exportJson());
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
      const s = this.selection;
      if (s?.kind !== 'piece') return;
      this.commit(setVariant(this.course, s.index, Number((e.target as HTMLSelectElement).value)), s);
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
    this.placeContext();
  }

  private placeContext(): void {
    placeContext(this.view, this.layout, this.selection);
  }
}
