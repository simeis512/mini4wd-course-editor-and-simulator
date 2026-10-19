import { getPart, hasPart, PARTS, variantOf } from '../course/catalog';
import { courseFromHash, courseToHash } from '../course/codec';
import {
  addPiece,
  compatible,
  deletePiece,
  emptyCourse,
  flipPiece,
  layoutCourse,
  partCounts,
  portKey,
  setVariant,
  validateCourse,
  type Course,
  type Layout,
} from '../course/course';
import { basicOval } from '../course/presets';
import type { Selection } from './selection';
import { TopView } from './view2d';
import { OrbitView } from './view3d';

const HISTORY_LIMIT = 200;

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

  constructor() {
    const onPick = (s: Selection) => this.select(s);
    this.top = new TopView($('view2d'), { onPick });
    this.orbit = new OrbitView($('view3d'), { onPick });
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

  private place(partId: string): void {
    const part = getPart(partId);
    const s = this.selection;
    if (this.course.pieces.length === 0) {
      this.commit(addPiece(this.course, partId, null), { kind: 'port', ref: { piece: 0, port: 1 } });
      return;
    }
    if (s?.kind !== 'port') return;
    const target = this.layout.pieces[s.ref.piece].part;
    const ports = part.ports.map((_, p) => p).filter((p) => compatible(target, s.ref.port, part, p));
    if (ports.length === 0) return;
    // Prefer the way round that real parts allow (a bank approach's floor end on the level).
    const tries = ports.map((p) => addPiece(this.course, partId, s.ref, p));
    const fits = tries.findIndex((c) => {
      const index = c.pieces.length - 1;
      return !layoutCourse(c).problems.some((pr) => pr.piece === index);
    });
    const port = ports[Math.max(0, fits)];
    const next = tries[Math.max(0, fits)];
    // Keep going from the new piece's far end.
    const index = next.pieces.length - 1;
    const far = part.ports.findIndex((_, p) => p !== port);
    this.commit(next, far >= 0 ? { kind: 'port', ref: { piece: index, port: far } } : null);
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
      const b = document.createElement('button');
      b.dataset.part = part.id;
      b.innerHTML = `${part.name}${part.setCode ? ` <small>${part.setCode}</small>` : ''}`;
      b.addEventListener('click', () => this.place(part.id));
      palette.appendChild(b);
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
        this.deleteSelected();
      } else if (!mod && e.key.toLowerCase() === 'f') {
        this.flipSelected();
      } else if (e.key === 'Escape') {
        this.select(null);
      }
    });
  }

  private renderPanel(): void {
    const { course, layout, selection: s } = this;
    $<HTMLButtonElement>('undo').disabled = this.undoStack.length === 0;
    $<HTMLButtonElement>('redo').disabled = this.redoStack.length === 0;

    // Palette: usable on an empty course or with an open port selected.
    const empty = course.pieces.length === 0;
    const target = s?.kind === 'port' ? layout.pieces[s.ref.piece].part : null;
    for (const b of $('palette').querySelectorAll<HTMLButtonElement>('button')) {
      const part = getPart(b.dataset.part!);
      b.disabled = !empty && !(target && s?.kind === 'port' && part.ports.some((_, p) => compatible(target, s.ref.port, part, p)));
    }
    $('palette-hint').textContent = empty
      ? 'パーツを選ぶと最初のピースを置きます'
      : s?.kind === 'port'
        ? '選んだパーツを、選択中の口（水色の矢印）につなぎます'
        : 'オレンジの矢印（開いた口）を選ぶと、そこにパーツをつなげます';

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
    }

    // Course summary.
    const info: string[] = [];
    info.push(`<div>ピース数: ${course.pieces.length}</div>`);
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
