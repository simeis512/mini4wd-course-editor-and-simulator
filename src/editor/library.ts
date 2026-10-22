import { decodeCourse, encodeCourse } from '../course/codec';
import type { Course } from '../course/course';
import { carriedOver, cleanName, defaultSaveName, namesFor, offerResume, sortSaves, type SavedCourse } from '../course/saves';
import { $, toast } from './dom';
import { deleteSave, getSave, listSaves, putSave, readAutosave, writeAutosave } from './store';

// Saving courses in the browser under a name, and keeping the course being
// edited so the next start can carry on from it (#68).

/** How long edits settle before the course being edited is kept (#68). */
const AUTOSAVE_DELAY_MS = 800;

export interface LibraryHost {
  readonly course: Course;
  /** Replace the course being edited, as a fresh start (history cleared). */
  open(course: Course): void;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function when(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export class Library {
  /** The named save the course came from or was last saved as. */
  private savedId: string | null = null;
  /** Whether the course changed since it was opened or saved. */
  private dirty = false;
  /** Off until the start has asked about the last session, so it is not overwritten first. */
  private keeping = false;
  private timer = 0;
  /** The named save of the course resumed on start, taken over once it is loaded. */
  private resumedId: string | null = null;
  /** Whether the course resumed on start had unsaved changes. */
  private resumedDirty = false;
  private dialog = $<HTMLDialogElement>('saves-dialog');

  constructor(private host: LibraryHost) {
    $('save').addEventListener('click', () => void this.save());
    $('saves').addEventListener('click', () => void this.openList());
    $('save-as').addEventListener('click', () => void this.saveAs());
    $('save-over').addEventListener('click', () => void this.save());
    $('save-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.saveAs();
    });
    $('saves-list').addEventListener('click', (e) => void this.onListClick(e));
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void this.save();
      }
    });
    // Keep the latest edit when the tab goes away before the delay is up.
    window.addEventListener('pagehide', () => this.flush());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush();
    });
  }

  /**
   * On start, offer to carry on from the last session when the page has no
   * course in its URL (#68). Resolves to that course if the user says yes.
   * A course in the URL that is the one the last session left (a reload)
   * stays that session's named save, with its unsaved changes.
   */
  async resume(urlHasCourse: boolean, fresh: Course): Promise<Course | null> {
    try {
      const last = await readAutosave();
      if (urlHasCourse) ({ savedId: this.savedId, dirty: this.dirty } = carriedOver(last, await encodeCourse(this.host.course)));
      if (!last || !offerResume(last, urlHasCourse, await encodeCourse(fresh))) return null;
      $('resume-info').textContent = `${when(last.savedAt)}・${last.pieceCount} ピース`;
      if (!(await this.ask($<HTMLDialogElement>('resume-dialog')))) return null;
      const course = await decodeCourse(last.data);
      this.resumedId = last.savedId ?? null;
      this.resumedDirty = !!last.dirty;
      return course;
    } catch (e) {
      toast(`前回のコースを読み込めませんでした: ${(e as Error).message}`);
      return null;
    } finally {
      this.keeping = true;
    }
  }

  /** The course was replaced (new, opened, read from a file or URL): it is no longer a named save. */
  replaced(): void {
    this.savedId = this.resumedId;
    this.dirty = this.resumedDirty;
    this.resumedId = null;
    this.resumedDirty = false;
  }

  /** Names of the saves to offer for the course, the one it is (or matches) first. */
  async names(): Promise<{ current: string; names: string[] }> {
    try {
      return namesFor(await listSaves(), this.savedId, await encodeCourse(this.host.course));
    } catch {
      // Storage blocked: nothing saved to offer.
      return { current: '', names: [] };
    }
  }

  /** The course was edited: keep it a moment later. */
  changed(): void {
    this.dirty = true;
    if (!this.keeping) return;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.flush(), AUTOSAVE_DELAY_MS);
  }

  /** Keep the course being edited now if it is waiting to be kept, or `always`. */
  private flush(always = false): void {
    if (!this.keeping || (!this.timer && !always)) return;
    clearTimeout(this.timer);
    this.timer = 0;
    const course = this.host.course;
    void encodeCourse(course)
      .then((data) => writeAutosave({ data, savedAt: Date.now(), pieceCount: course.pieces.length, savedId: this.savedId ?? undefined, dirty: this.dirty }))
      .catch(() => {
        // Storage may be blocked (private mode); the URL still holds the course.
      });
  }

  /**
   * Before the course is replaced (another opened, a new one started: say
   * which with `verb`, as in 「保存してから開く」): when
   * it has changes not in a named save, ask to save them first, drop them,
   * or stay. Resolves to whether to go on.
   */
  async confirmReplace(verb = '開く'): Promise<boolean> {
    if (!this.dirty || this.host.course.pieces.length === 0) return true;
    const dialog = $<HTMLDialogElement>('unsaved-dialog');
    const saves = await listSaves().catch((): SavedCourse[] => []);
    const current = saves.find((s) => s.id === this.savedId);
    const name = $<HTMLInputElement>('unsaved-name');
    $('unsaved-name-row').hidden = !!current;
    $('unsaved-save').textContent = current ? `「${current.name}」に上書きしてから${verb}` : `保存してから${verb}`;
    $('unsaved-discard').textContent = `保存せずに${verb}`;
    name.value = defaultSaveName(this.host.course.name, new Date(), saves.map((s) => s.name));
    dialog.returnValue = '';
    dialog.showModal();
    const answer = await new Promise<string>((resolve) =>
      dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true }),
    );
    if (answer === 'discard') return true;
    if (answer !== 'save') return false;
    if (current) return this.store({ ...current, savedAt: Date.now() });
    const saveName = cleanName(name.value) || name.defaultValue;
    return this.store({ id: crypto.randomUUID(), name: saveName, data: '', savedAt: Date.now(), pieceCount: 0 });
  }

  /** Overwrite the named save, or ask for a name when there is none (Ctrl+S). */
  private async save(): Promise<void> {
    const id = this.savedId;
    const old = id ? await getSave(id).catch(() => undefined) : undefined;
    if (!old) {
      await this.openList();
      return;
    }
    await this.store({ ...old, savedAt: Date.now() });
  }

  private async saveAs(): Promise<void> {
    const name = cleanName($<HTMLInputElement>('save-name').value);
    if (!name) {
      toast('名前を入れてください');
      return;
    }
    await this.store({ id: crypto.randomUUID(), name, data: '', savedAt: Date.now(), pieceCount: 0 });
  }

  /** Save the course being edited as `save`; resolves to whether it was saved. */
  private async store(save: SavedCourse): Promise<boolean> {
    const course = this.host.course;
    try {
      await putSave({ ...save, data: await encodeCourse(course), pieceCount: course.pieces.length });
    } catch (e) {
      toast(`保存できませんでした: ${(e as Error).message}`);
      return false;
    }
    this.savedId = save.id;
    this.dirty = false;
    // So a resume on the next start still overwrites this save.
    this.flush(true);
    toast(`「${save.name}」をこのブラウザに保存しました`);
    if (this.dialog.open) await this.renderList();
    return true;
  }

  private async openList(): Promise<void> {
    if (!this.dialog.open) this.dialog.showModal();
    await this.renderList();
  }

  private async renderList(): Promise<void> {
    const list = $('saves-list');
    let saves: SavedCourse[];
    try {
      saves = sortSaves(await listSaves());
    } catch (e) {
      list.innerHTML = `<li class="err">このブラウザでは保存を使えません: ${escape((e as Error).message)}</li>`;
      return;
    }
    const current = saves.find((s) => s.id === this.savedId);
    $<HTMLButtonElement>('save-over').hidden = !current;
    if (current) $('save-over').textContent = `「${current.name}」に上書き`;
    $<HTMLInputElement>('save-name').value = defaultSaveName(
      this.host.course.name,
      new Date(),
      saves.map((s) => s.name),
    );
    list.innerHTML = saves.length
      ? saves
          .map(
            (s) => `<li data-id="${escape(s.id)}"${s.id === this.savedId ? ' class="current"' : ''}>
  <button class="link" data-act="open" title="このコースを開く">${escape(s.name)}</button>
  <span class="muted">${s.pieceCount} ピース・${when(s.savedAt)}${s.id === this.savedId ? '・編集中' : ''}</span>
  <span class="acts"><button class="small" data-act="rename">名前変更</button><button class="small" data-act="delete">削除</button></span>
</li>`,
          )
          .join('')
      : '<li class="muted">まだ保存したコースはありません</li>';
  }

  private async onListClick(e: Event): Promise<void> {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    const id = button?.closest<HTMLElement>('li[data-id]')?.dataset.id;
    if (!button || !id) return;
    const save = await getSave(id);
    if (!save) return;
    switch (button.dataset.act) {
      case 'open': {
        if (!(await this.confirmReplace())) return;
        try {
          this.host.open(await decodeCourse(save.data));
        } catch (err) {
          toast(`開けませんでした: ${(err as Error).message}`);
          return;
        }
        this.savedId = id;
        this.dirty = false;
        this.dialog.close();
        toast(`「${save.name}」を開きました`);
        return;
      }
      case 'rename': {
        const name = cleanName(prompt('新しい名前', save.name) ?? '');
        if (!name || name === save.name) return;
        await putSave({ ...save, name });
        break;
      }
      case 'delete':
        if (!confirm(`「${save.name}」を削除しますか？（元に戻せません）`)) return;
        await deleteSave(id);
        if (this.savedId === id) this.savedId = null;
        break;
    }
    await this.renderList();
  }

  /** Show a yes/no dialog whose yes button has value "yes"; resolves to whether it was pressed. */
  private ask(dialog: HTMLDialogElement): Promise<boolean> {
    dialog.returnValue = '';
    dialog.showModal();
    return new Promise((resolve) => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'yes'), { once: true });
    });
  }
}
