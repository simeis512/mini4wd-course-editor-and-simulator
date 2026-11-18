import { decodeSetup, encodeSetup, machineValueOf, setupToHash } from '../machine/codec';
import { machineSaveName, sortMachines, type SavedMachine } from '../machine/saves';
import { freeSpeedKmh, massOf, rollerWidth, setupWarnings, standardSetup, type MachineSetup } from '../machine/setup';
import { cleanName } from '../course/saves';
import { specFromSetup } from '../physics/machine-setup';
import { $, toast } from './dom';
import { renderMachineForm } from './machine-form';
import { MachinePreview } from './machine-preview';
import type { QrHost } from './qr';
import { fileName } from './share';
import { deleteMachine, listMachines, putMachine, readMachineAutosave, writeMachineAutosave } from './store';

// The machine screen (#31): set up a machine apart from the course, keep
// it in the browser, and hand it over by its own URL (#m=, owner
// 2026-11-08: machine and course URLs apart). Runs pick from the machines
// kept here (run-mode).

export type Screen = 'course' | 'machine';

export interface MachineScreenHost {
  /** Put the course being edited back in the page URL. */
  writeCourseUrl(): void;
  /** Show the QR dialog for a URL. */
  showQr(host: QrHost): void;
}

/** How long edits settle before the machine being set up is kept. */
const AUTOSAVE_DELAY_MS = 800;

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class MachineScreen {
  private setup: MachineSetup = standardSetup();
  private savedId: string | null = null;
  /** Changed since it was opened or saved. */
  private dirty = false;
  private screen: Screen = 'course';
  private preview: MachinePreview | null = null;
  private ownHash = '';
  private timer = 0;

  constructor(private host: MachineScreenHost) {
    $('screens').hidden = false;
    for (const e of document.querySelectorAll<HTMLElement>('.screens-sep')) e.hidden = false;
    $('screen-course').addEventListener('click', () => this.show('course'));
    $('screen-machine').addEventListener('click', () => this.show('machine'));
    const name = $<HTMLInputElement>('machine-name');
    name.addEventListener('change', () => this.change({ ...this.setup, name: cleanName(name.value) || undefined }));
    $('machine-save').addEventListener('click', () => void this.save());
    $('machine-save-as').addEventListener('click', () => void this.save(true));
    $('machine-new').addEventListener('click', () => {
      if (this.dirty && !confirm('今のマシンの変更は保存されていません。標準のマシンから作り直しますか？')) return;
      this.open(standardSetup(), null);
    });
    $('machine-copy-url').addEventListener('click', () => void this.copyUrl());
    $('machine-qr').addEventListener('click', () =>
      this.host.showQr({
        url: () => this.url(),
        name: async () => this.setup.name ?? '',
        get fileName() {
          return fileName('machine');
        },
      }),
    );
    $('machine-saves').addEventListener('click', (e) => void this.onListClick(e));
    // Ctrl+S saves the machine while it is on screen, not the course.
    window.addEventListener(
      'keydown',
      (e) => {
        if (this.screen === 'machine' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          e.stopImmediatePropagation();
          void this.save();
        }
      },
      true,
    );
    window.addEventListener('pagehide', () => this.flush());
  }

  get current(): MachineSetup {
    return this.setup;
  }

  /** On start: the machine in the URL (then its screen), else the one being set up last time. */
  async start(): Promise<void> {
    const value = machineValueOf(location.hash);
    if (value && (await this.openValue(value))) return;
    try {
      const last = await readMachineAutosave();
      if (last) {
        this.setup = await decodeSetup(last.data);
        this.savedId = last.savedId ?? null;
      }
    } catch {
      // Nothing kept, or storage blocked: the standard machine.
    }
    this.render();
  }

  /** The URL changed to hold a machine: open it on its screen. */
  async onHash(value: string): Promise<void> {
    if (location.hash === this.ownHash) return;
    if (this.dirty && !confirm('今のマシンの変更は保存されていません。URL のマシンを開きますか？')) return this.writeUrl();
    await this.openValue(value);
  }

  private async openValue(value: string): Promise<boolean> {
    try {
      this.open(await decodeSetup(value), null);
      this.show('machine');
      return true;
    } catch (e) {
      toast(`URLのマシンを読み込めませんでした: ${(e as Error).message}`);
      return false;
    }
  }

  show(screen: Screen): void {
    this.screen = screen;
    document.body.classList.toggle('machine-screen', screen === 'machine');
    $('screen-course').setAttribute('aria-selected', String(screen === 'course'));
    $('screen-machine').setAttribute('aria-selected', String(screen === 'machine'));
    $('machine-stage').hidden = $('machine-side').hidden = screen !== 'machine';
    if (screen === 'machine') {
      this.preview ??= new MachinePreview($('machine-preview'));
      this.render();
      void this.renderSaves();
    } else this.host.writeCourseUrl();
  }

  private open(setup: MachineSetup, savedId: string | null): void {
    this.setup = setup;
    this.savedId = savedId;
    this.dirty = false;
    this.render();
    this.keep();
  }

  private change(next: MachineSetup): void {
    this.setup = next;
    this.dirty = true;
    this.render();
    this.keep();
  }

  private render(): void {
    if (this.screen !== 'machine') return;
    $<HTMLInputElement>('machine-name').value = this.setup.name ?? '';
    renderMachineForm($('machine-form'), this.setup, (next) => this.change(next));
    this.preview?.show(specFromSetup(this.setup));
    const mass = massOf(this.setup);
    const warnings = setupWarnings(this.setup);
    $('machine-summary').innerHTML =
      `<div><b>${escape(this.setup.name ?? '名前のないマシン')}</b>${this.dirty ? '（未保存）' : ''}</div>` +
      `<div>重さ ${mass.total.toFixed(1)} g（${this.setup.measuredMass === undefined ? '目安' : '実測'}）・最高速の目安 ${freeSpeedKmh(this.setup).toFixed(1)} km/h・ローラー幅 ${rollerWidth(this.setup)} mm</div>` +
      warnings.map((w) => `<div class="warn">${escape(w)}</div>`).join('');
    this.writeUrl();
  }

  private writeUrl(): void {
    if (this.screen !== 'machine') return;
    void setupToHash(this.setup).then((hash) => {
      if (this.screen !== 'machine') return;
      this.ownHash = hash;
      history.replaceState(null, '', hash);
    });
  }

  async url(): Promise<string> {
    return location.origin + location.pathname + location.search + (await setupToHash(this.setup));
  }

  private async copyUrl(): Promise<void> {
    const url = await this.url();
    try {
      await navigator.clipboard.writeText(url);
      toast('マシンのURLをコピーしました');
    } catch {
      prompt('このURLをコピーしてください', url);
    }
  }

  /** Keep the machine being set up, a moment after the last change. */
  private keep(): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.flush(), AUTOSAVE_DELAY_MS);
  }

  private flush(): void {
    clearTimeout(this.timer);
    const savedId = this.savedId ?? undefined;
    void encodeSetup(this.setup)
      .then((data) => writeMachineAutosave({ data, savedAt: Date.now(), savedId }))
      .catch(() => undefined);
  }

  /** Save under its name: over the save it came from, or as a new one. */
  private async save(asNew = false): Promise<void> {
    try {
      const saves = await listMachines();
      const over = !asNew && saves.find((s) => s.id === this.savedId);
      const name = over ? cleanName(this.setup.name ?? '') || over.name : machineSaveName(this.setup.name, saves.map((s) => s.name));
      const save: SavedMachine = { id: over ? over.id : crypto.randomUUID(), name, data: await encodeSetup(this.setup), savedAt: Date.now() };
      await putMachine(save);
      this.savedId = save.id;
      this.dirty = false;
      if (!this.setup.name) this.setup = { ...this.setup, name };
      this.render();
      this.flush();
      await this.renderSaves();
      toast(`「${name}」をこのブラウザに保存しました`);
    } catch (e) {
      toast(`保存できませんでした: ${(e as Error).message}`);
    }
  }

  private async renderSaves(): Promise<void> {
    let saves: SavedMachine[] = [];
    try {
      saves = sortMachines(await listMachines());
    } catch {
      // Storage blocked: nothing to list.
    }
    $('machine-saves').innerHTML = saves.length
      ? saves
          .map(
            (s) =>
              `<li${s.id === this.savedId ? ' class="current"' : ''}><span>${escape(s.name)}</span>` +
              `<button class="small" data-open="${s.id}">開く</button><button class="small" data-delete="${s.id}" aria-label="${escape(s.name)} を削除">削除</button></li>`,
          )
          .join('')
      : '<li class="muted">まだありません</li>';
  }

  private async onListClick(e: Event): Promise<void> {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    const saves = await listMachines();
    const save = saves.find((s) => s.id === (b.dataset.open ?? b.dataset.delete));
    if (!save) return;
    if (b.dataset.open) {
      if (this.dirty && !confirm('今のマシンの変更は保存されていません。開きますか？')) return;
      this.open(await decodeSetup(save.data), save.id);
    } else if (confirm(`「${save.name}」を削除しますか？`)) {
      await deleteMachine(save.id);
      if (this.savedId === save.id) this.savedId = null;
      await this.renderSaves();
    }
  }

  /** The machines a run can take: the one on this screen and the ones saved (#31: picked from those kept in the browser). */
  async runChoices(): Promise<{ label: string; setup: MachineSetup }[]> {
    const choices = [{ label: `編集中：${this.setup.name ?? '名前のないマシン'}`, setup: this.setup }];
    try {
      for (const s of sortMachines(await listMachines())) {
        try {
          choices.push({ label: s.name, setup: await decodeSetup(s.data) });
        } catch {
          // A save that no longer reads is left out.
        }
      }
    } catch {
      // Storage blocked: only the one being set up.
    }
    choices.push({ label: '標準マシン', setup: standardSetup() });
    return choices;
  }
}
