import { Matrix4, Vector3 } from 'three';
import { getPart, hasPart, PARTS, variantOf } from '../course/catalog';
import { courseFromHash, courseToHash } from '../course/codec';
import {
  addFreePiece,
  addPiece,
  applyMagnet,
  compatible,
  deletePiece,
  emptyCourse,
  findMagnet,
  flipPiece,
  footprint,
  freeSpot,
  groupCount,
  joinableNear,
  joinPorts,
  layoutCourse,
  MAGNET_DISTANCE,
  moveGroup,
  movingGroup,
  partCounts,
  placementOf,
  portKey,
  setPose,
  setVariant,
  splitJoint,
  tidyCuts,
  validateCourse,
  type Course,
  type Layout,
  type PortRef,
} from '../course/course';
import { partGeometry, type Pose } from '../course/geometry';
import { basicOval } from '../course/presets';
import { partIcon } from './icons';
import type { Selection } from './selection';
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
const POSE_FIELDS = ['pose-x', 'pose-y', 'pose-z', 'pose-yaw', 'pose-pitch', 'pose-roll'] as const;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class EditorApp {
  private course: Course = emptyCourse();
  private layout: Layout = layoutCourse(this.course);
  private selection: Selection = null;
  private undoStack: Course[] = [];
  private redoStack: Course[] = [];
  private mode: '2d' | '3d' = '2d';
  private top: TopView;
  private orbit: OrbitView;
  /** The hash we last wrote, so our own updates are not reloaded. */
  private writtenHash = '';
  private hashWrite = Promise.resolve();
  /** A piece being dragged in the top view, and the course as it would be if dropped now. */
  private drag: { index: number; start: Course; group: Set<number>; preview: Course | null } | null = null;
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
    const onPick = (s: Selection) => this.select(s);
    this.top = new TopView($('view2d'), {
      onPick,
      onDragStart: (index) => this.dragStart(index),
      onDragMove: (dx, dz, noSnap) => this.dragMove(dx, dz, noSnap),
      onDragEnd: (commit) => this.dragEnd(commit),
    });
    this.orbit = new OrbitView($('view3d'), {
      onPick,
      onDragStart: (index) => this.dragStart(index),
      onDragMove: (dx, dz, noSnap) => this.dragMove(dx, dz, noSnap),
      onDragEnd: (commit) => this.dragEnd(commit),
    });
    this.buildPalette();
    this.bindUi();
  }

  async start(): Promise<void> {
    let course: Course | null = null;
    try {
      course = await courseFromHash(location.hash);
    } catch (e) {
      this.toast(`URLのコースを読み込めませんでした: ${(e as Error).message}`);
    }
    this.load(course ?? basicOval(), !course);
    window.addEventListener('hashchange', () => void this.onHashChange());
  }

  /** Replace the whole course (new / open), clearing history. */
  private load(course: Course, writeUrl: boolean): void {
    this.course = course;
    this.undoStack = [];
    this.redoStack = [];
    this.selection = null;
    this.refresh(writeUrl);
    this.top.fit();
    this.orbit.fit();
  }

  /** Apply an edit, recording it for undo. */
  private commit(next: Course, selection: Selection = null): void {
    this.undoStack.push(this.course);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.course = next;
    this.selection = selection;
    this.refresh(true);
  }

  private undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.course);
    this.course = prev;
    this.selection = null;
    this.refresh(true);
  }

  private redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.course);
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
    if (s?.kind === 'joint') {
      const key = [portKey(s.a), portKey(s.b)].sort().join();
      if (!this.layout.joints.some((j) => [portKey(j.a), portKey(j.b)].sort().join() === key)) this.selection = null;
    }
    this.top.setData(this.layout, this.selection);
    this.orbit.setData(this.layout, this.selection);
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
      this.toast(`URLのコースを読み込めませんでした: ${(e as Error).message}`);
    }
  }

  // ---- Commands

  /**
   * Join `partId` to the open port `at`. `port` fixes which of its ports
   * joins (the side of a handed part); otherwise the way round that real
   * parts allow wins (a bank approach's floor end on the level). Null when
   * the part cannot join there.
   */
  private joinedTo(course: Course, partId: string, at: PortRef, port?: number): { next: Course; port: number } | null {
    const part = getPart(partId);
    const target = layoutCourse(course).pieces[at.piece].part;
    const ports = part.ports
      .map((_, p) => p)
      .filter((p) => (port === undefined || p === port) && compatible(target, at.port, part, p));
    if (ports.length === 0) return null;
    const tries = ports.map((p) => addPiece(course, partId, at, p));
    const fits = tries.findIndex((c) => {
      const index = c.pieces.length - 1;
      return !layoutCourse(c).problems.some((pr) => pr.piece === index);
    });
    return { next: tries[Math.max(0, fits)], port: ports[Math.max(0, fits)] };
  }

  /** The new last piece's next open port, to keep going from (the lane change centre's upper port closes by itself). */
  private nextPort(next: Course, port: number): Selection {
    const index = next.pieces.length - 1;
    const part = getPart(next.pieces[index].part);
    const open = new Set(layoutCourse(next).open.map(portKey));
    const far = part.ports.findIndex((_, p) => p !== port && open.has(portKey({ piece: index, port: p })));
    return far >= 0 ? { kind: 'port', ref: { piece: index, port: far } } : null;
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
      const joined = this.joinedTo(this.course, partId, s.ref, side);
      if (joined) {
        this.commit(joined.next, this.nextPort(joined.next, joined.port));
        return;
      }
      this.toast('選んだ口にはつなげないパーツなので、単体で置きました');
    }
    const [cx, cz] = this.mode === '3d' ? this.orbit.centre : this.top.centre;
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
    }
    const at = this.mode === '3d' ? this.orbit.groundAt(e.clientX, e.clientY) : this.top.worldAt(e.clientX, e.clientY);
    const preview = at && this.dropCourse(d.partId, d.port, at[0], at[1], e.shiftKey);
    if (!preview && !d.preview) return;
    d.preview = preview;
    const layout = preview ? layoutCourse(preview) : this.layout;
    const selection: Selection = preview ? { kind: 'piece', index: preview.pieces.length - 1 } : this.selection;
    (this.mode === '3d' ? this.orbit : this.top).setData(layout, selection);
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
    const reach = Math.max(DROP_JOIN_MM, this.mode === '2d' ? DROP_JOIN_PX / this.top.pxPerMm : 0);
    // A piece filling a gap sits about as near from either end, so the way that closes it wins.
    let best: { next: Course; open: number; d: number } | null = null;
    for (const ref of this.layout.open) {
      const joined = this.joinedTo(this.course, partId, ref, port);
      if (!joined) continue;
      const layout = layoutCourse(joined.next);
      const [x0, x1, z0, z1] = footprint(layout.pieces[layout.pieces.length - 1]);
      const d = Math.hypot((x0 + x1) / 2 - x, (z0 + z1) / 2 - z);
      const open = layout.open.length;
      if (d <= reach && (!best || open < best.open || (open === best.open && d < best.d))) best = { next: joined.next, open, d };
    }
    if (best) return best.next;
    if (this.snapOn && !noSnap) {
      x = Math.round(x / SNAP_STEP) * SNAP_STEP;
      z = Math.round(z / SNAP_STEP) * SNAP_STEP;
    }
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
    this.drag = { index, start: this.course, group: movingGroup(this.layout, index, this.moveAlone), preview: null };
    return true;
  }

  private dragMove(dx: number, dz: number, noSnap: boolean): void {
    const d = this.drag;
    if (!d) return;
    if (this.snapOn && !noSnap) {
      dx = Math.round(dx / SNAP_STEP) * SNAP_STEP;
      dz = Math.round(dz / SNAP_STEP) * SNAP_STEP;
    }
    let next = moveGroup(d.start, d.group, new Matrix4().makeTranslation(dx, 0, dz));
    // The 3D view has no single scale, so it uses the plain magnet distance.
    const px = this.mode === '2d' ? MAGNET_PX / this.top.pxPerMm : 0;
    const magnet = findMagnet(next, d.group, Math.max(MAGNET_DISTANCE, px));
    if (magnet) next = applyMagnet(next, d.group, magnet);
    d.preview = next;
    (this.mode === '3d' ? this.orbit : this.top).setData(layoutCourse(next), this.selection);
  }

  private dragEnd(commit: boolean): void {
    const d = this.drag;
    this.drag = null;
    if (!d?.preview) return;
    if (commit) this.commit(tidyCuts(d.preview), { kind: 'piece', index: d.index });
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
    const samples = partGeometry(pc.part).samples;
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
      this.toast('URLをコピーしました');
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
      this.toast('コースを読み込みました');
    } catch (e) {
      this.toast(`読み込めませんでした: ${(e as Error).message}`);
    }
  }

  private setMode(mode: '2d' | '3d'): void {
    this.mode = mode;
    $('mode-2d').setAttribute('aria-pressed', String(mode === '2d'));
    $('mode-3d').setAttribute('aria-pressed', String(mode === '3d'));
    $('view2d').hidden = mode !== '2d';
    $('view3d').hidden = mode !== '3d';
    this.orbit.setActive(mode === '3d');
    if (mode === '2d') this.top.draw();
  }

  // ---- UI

  private buildPalette(): void {
    const palette = $('palette');
    for (const part of PARTS) {
      // A handed part comes both ways round: left on port 0, right on port 1 (#43).
      const sides: [number | undefined, string][] = part.handed ? [[0, '左'], [1, '右']] : [[undefined, '']];
      for (const [port, side] of sides) {
        const b = document.createElement('button');
        b.dataset.part = part.id;
        const label = document.createElement('span');
        label.innerHTML = `${part.name}${side ? ` ${side}` : ''}${part.setCode ? ` <small>${part.setCode}</small>` : ''}`;
        b.append(partIcon(part, port ?? 0), label);
        b.title = `${part.name}${side ? `（${side}）` : ''}：クリックで追加、ドラッグでコースに置く`;
        b.addEventListener('click', () => {
          if (!this.swallowClick) this.place(part.id, port);
        });
        b.addEventListener('pointerdown', (e) => this.paletteDown(e, part.id, port));
        b.addEventListener('pointermove', (e) => this.paletteMove(e));
        b.addEventListener('pointerup', (e) => this.paletteUp(e, false));
        b.addEventListener('pointercancel', (e) => this.paletteUp(e, true));
        palette.appendChild(b);
      }
    }
  }

  private bindUi(): void {
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
    $('fit').addEventListener('click', () => (this.mode === '2d' ? this.top.fit() : this.orbit.fit()));
    $('flip').addEventListener('click', () => this.flipSelected());
    $('delete').addEventListener('click', () => this.deleteSelected());
    $<HTMLSelectElement>('variant').addEventListener('change', (e) => {
      const s = this.selection;
      if (s?.kind !== 'piece') return;
      this.commit(setVariant(this.course, s.index, Number((e.target as HTMLSelectElement).value)), s);
    });
    $('rot-left').addEventListener('click', (e) => this.rotateSelected(e.shiftKey ? 1 : 15));
    $('rot-right').addEventListener('click', (e) => this.rotateSelected(e.shiftKey ? -1 : -15));
    $('raise').addEventListener('click', () => this.moveSelected(new Matrix4().makeTranslation(0, 10, 0)));
    $('lower').addEventListener('click', () => this.moveSelected(new Matrix4().makeTranslation(0, -10, 0)));
    for (const id of POSE_FIELDS) $(id).addEventListener('change', () => this.setPoseFromFields());
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
    const { course, layout, selection: s } = this;
    $<HTMLButtonElement>('undo').disabled = this.undoStack.length === 0;
    $<HTMLButtonElement>('redo').disabled = this.redoStack.length === 0;

    // Parts list: joins to the selected open port where it can, else adds on its own.
    const empty = course.pieces.length === 0;
    const target = s?.kind === 'port' ? layout.pieces[s.ref.piece].part : null;
    for (const b of $('palette').querySelectorAll<HTMLButtonElement>('button')) {
      const part = getPart(b.dataset.part!);
      const joins = target && s?.kind === 'port' && part.ports.some((_, p) => compatible(target, s.ref.port, part, p));
      b.classList.toggle('dim', !!target && !joins);
    }
    $('palette-hint').textContent = empty
      ? 'クリックで最初のピースを置きます。コースへドラッグして好きな場所にも置けます'
      : s?.kind === 'port'
        ? 'クリックで、選択中の口（水色の矢印）につなぎます。ドラッグでコースに置くこともできます'
        : 'クリックで画面の中央付近に単体で置きます。開いた口（オレンジの矢印）を選んでからクリックすると、そこにつなぎます。コースへドラッグすると好きな場所に置け、口の先へ落とすとつながります';

    // Selected piece.
    const panel = $('selection-panel');
    panel.hidden = s?.kind !== 'piece';
    if (s?.kind === 'piece') {
      const pc = layout.pieces[s.index];
      $('selection-name').textContent = `#${s.index + 1} ${pc.part.name}`;
      const notes = [pc.part.note, pc.part.confidence === 'inferred' ? '寸法は推定値' : ''].filter(Boolean);
      $('selection-note').textContent = notes.join('・');
      const select = $<HTMLSelectElement>('variant');
      select.replaceChildren(
        ...pc.part.variants.map((v, i) => {
          const o = document.createElement('option');
          o.value = String(i);
          o.textContent = v.name;
          return o;
        }),
      );
      select.value = String(pc.part.variants.indexOf(variantOf(pc.part, pc.rec.variant)));
      $<HTMLButtonElement>('flip').disabled = pc.part.ports.length !== 2;

      const group = movingGroup(layout, s.index);
      $('group-info').textContent =
        group.size > 1
          ? `点線のピースとつながっています。ドラッグするとつながった ${group.size} 個が一緒に動きます`
          : 'ほかのピースとつながっていません';
      const { base, pose } = placementOf(pc.rec);
      const from = base ? `#${base.piece + 1} ${layout.pieces[base.piece].part.name} の口から` : 'ワールド原点から';
      $('placement-base').textContent = 'free' in pc.rec ? `自由配置（${from}）` : base ? `連結（${from}）` : '先頭（原点）';
      const values = [...pose.pos, ...pose.rot];
      POSE_FIELDS.forEach((id, i) => {
        const input = $<HTMLInputElement>(id);
        if (document.activeElement !== input) input.value = String(values[i]);
      });
    }

    // Selected joint, or an open port that could be joined.
    $('joint-panel').hidden = s?.kind !== 'joint';
    if (s?.kind === 'joint') {
      const name = (r: { piece: number }) => `#${r.piece + 1} ${layout.pieces[r.piece].part.name}`;
      $('joint-name').textContent = `${name(s.a)} と ${name(s.b)} のつなぎ目`;
    }
    const near = s?.kind === 'port' ? joinableNear(layout, s.ref) : null;
    $('port-panel').hidden = !near;
    if (near) $('join-name').textContent = `近くの口（#${near.piece + 1} ${layout.pieces[near.piece].part.name}）`;

    // Course summary.
    const info: string[] = [];
    info.push(`<div>ピース数: ${course.pieces.length}</div>`);
    const islands = groupCount(layout);
    if (islands > 1) info.push(`<div class="muted">つながりのまとまり: ${islands} 個</div>`);
    const counts = [...partCounts(course)].map(([id, n]) => `<li>${getPart(id).name} × ${n}</li>`);
    if (counts.length) info.push(`<ul>${counts.join('')}</ul>`);
    if (layout.open.length > 0) {
      info.push(`<div class="warn">未接続の口: ${layout.open.length}</div>`);
    } else if (course.pieces.length > 0) {
      info.push('<div class="ok">コースは閉じています</div>');
    }
    for (const pr of layout.problems) {
      const what = pr.kind === 'not-level' ? '床側の端が水平ではありません（向きが逆かもしれません）' : 'このパーツ同士はつなげません';
      info.push(`<div class="warn">#${pr.piece + 1} ${layout.pieces[pr.piece].part.name}: ${what}</div>`);
    }
    for (const c of layout.closures) {
      // Ports placed exactly together are simply joined; only real gaps are worth showing.
      if (c.distance < 0.05 && c.angle < 0.05) continue;
      info.push(`<div class="muted">ループ閉じ（#${c.a.piece + 1}–#${c.b.piece + 1}）: 誤差 ${c.distance.toFixed(1)}mm / ${c.angle.toFixed(1)}°</div>`);
    }
    $('info').innerHTML = info.join('');
  }

  private toastTimer = 0;
  private toast(message: string): void {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), 2500);
  }
}
