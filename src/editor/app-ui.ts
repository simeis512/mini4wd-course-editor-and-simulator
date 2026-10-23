import { Matrix4 } from 'three';
import { LEVEL_HEIGHT } from '../course/catalog';
import { bindAttachments } from './attach';
import { bindCourseInfo, type CheckHandlers } from './checks';
import { $ } from './dom';
import { SNAP_STEP } from './drag';
import { bindLevelTools, type HeightView } from './levels';
import { POSE_FIELDS } from './panels';
import { bindAbout } from './notice';
import { bindShopping } from './shopping';
import { bindQr } from './qr';
import { ShareImage, type ShareHost } from './share-image';
import { bindSidePanel } from './side-panel';
import { bindTurnTools } from './turn-tools';
import type { Selection } from './selection';
import type { SelectedAction } from './selected-edits';

/** The UI can invoke commands, without accessing EditorApp's internal state (#93). */
export interface AppUiHost {
  readonly selection: Selection;
  readonly top: { turnStep(dir: -1 | 0 | 1): void };
  readonly checks: CheckHandlers;
  readonly sharing: ShareHost;
  setHeightView(view: HeightView): void;
  renderCourseInfo(): void;
  overPanel(e: PointerEvent): void;
  placeContext(): void;
  select(selection: Selection): void;
  setMode(mode: '2d' | '3d'): void;
  undo(): void;
  redo(): void;
  newCourse(): Promise<void>;
  copyUrl(): Promise<void>;
  exportJson(): void;
  importJson(file: File): Promise<void>;
  fit(): void;
  edit(action: SelectedAction): void;
  renderPanel(): void;
}

/** Shared by the raise command and its preview so they use the same count and direction. */
export function readRaiseFields() {
  return {
    intoA: $('raise-dir').dataset.side === 'a',
    count: Math.max(1, Math.round(Number($<HTMLInputElement>('raise-count').value) || 1)),
    rise: Number($<HTMLInputElement>('raise-mm').value) || 0,
  };
}

export function bindAppUi(host: AppUiHost): ShareImage {
  bindAbout();
  bindSidePanel();
  bindLevelTools((view) => host.setHeightView(view));
  bindTurnTools(host.top);
  bindShopping(() => host.renderCourseInfo());
  bindCourseInfo(host.checks);
  // Views capture the pointer while dragging, so its moves still bubble up here.
  window.addEventListener('pointermove', (e) => host.overPanel(e));
  $<HTMLDetailsElement>('course-info').addEventListener('toggle', () => host.placeContext());
  $('context').querySelector('details')!.addEventListener('toggle', () => host.placeContext());
  $('context-close').addEventListener('click', () => host.select(null));
  $('mode-2d').addEventListener('click', () => host.setMode('2d'));
  $('mode-3d').addEventListener('click', () => host.setMode('3d'));
  $('undo').addEventListener('click', () => host.undo());
  $('redo').addEventListener('click', () => host.redo());
  $('new').addEventListener('click', () => void host.newCourse());
  $('copy-url').addEventListener('click', () => void host.copyUrl());
  bindQr(host.sharing);
  const share = new ShareImage(host.sharing);
  $('export').addEventListener('click', () => host.exportJson());
  const file = $<HTMLInputElement>('import-file');
  $('import').addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    if (file.files?.[0]) void host.importJson(file.files[0]);
    file.value = '';
  });
  $('fit').addEventListener('click', () => host.fit());
  $('flip').addEventListener('click', () => host.edit({ kind: 'flip' }));
  $('delete').addEventListener('click', () => host.edit({ kind: 'delete' }));
  $<HTMLSelectElement>('variant').addEventListener('change', (e) => {
    host.edit({ kind: 'variant', value: Number((e.target as HTMLSelectElement).value) });
  });
  $('piece-length').addEventListener('change', (e) => {
    const mm = Number((e.target as HTMLInputElement).value);
    if (mm) host.edit({ kind: 'length', mm });
  });
  bindAttachments({
    add: (kind) => host.edit({ kind: 'attachment-add', attachment: kind }),
    move: (n, to) => host.edit({ kind: 'attachment-move', index: n, to }),
    remove: (n) => host.edit({ kind: 'attachment-remove', index: n }),
  });
  $('rot-left').addEventListener('click', (e) => host.edit({ kind: 'rotate', deg: e.shiftKey ? 1 : 15 }));
  $('rot-right').addEventListener('click', (e) => host.edit({ kind: 'rotate', deg: e.shiftKey ? -1 : -15 }));
  // Up and down by one level, a slope's height; Shift for a fine step.
  $('raise').textContent = `↑${LEVEL_HEIGHT}mm`;
  $('lower').textContent = `↓${LEVEL_HEIGHT}mm`;
  $('raise').title = `${LEVEL_HEIGHT}mm（スロープ 1 段）上げる。Shift で ${SNAP_STEP}mm`;
  $('lower').title = `${LEVEL_HEIGHT}mm（スロープ 1 段）下げる。Shift で ${SNAP_STEP}mm`;
  const lift = (e: MouseEvent) => (e.shiftKey ? SNAP_STEP : LEVEL_HEIGHT);
  $('raise').addEventListener('click', (e) => host.edit({ kind: 'move', by: new Matrix4().makeTranslation(0, lift(e), 0) }));
  $('lower').addEventListener('click', (e) => host.edit({ kind: 'move', by: new Matrix4().makeTranslation(0, -lift(e), 0) }));
  $<HTMLInputElement>('raise-mm').value = String(LEVEL_HEIGHT);
  for (const id of POSE_FIELDS) $(id).addEventListener('change', () => {
    const [x, y, z, yaw, pitch, roll] = POSE_FIELDS.map((id) => Number($<HTMLInputElement>(id).value) || 0);
    host.edit({ kind: 'pose', pose: { pos: [x, y, z], rot: [yaw, pitch, roll] } });
  });
  // Angles step 0.5°, or 0.1° with Shift (spec 16.3).
  const step = (e: MouseEvent) => (e.shiftKey ? 0.1 : 0.5);
  $('twist-minus').addEventListener('click', (e) => host.edit({ kind: 'twist', deg: null, by: -step(e) }));
  $('twist-plus').addEventListener('click', (e) => host.edit({ kind: 'twist', deg: null, by: step(e) }));
  $('twist').addEventListener('change', (e) => host.edit({ kind: 'twist', deg: Number((e.target as HTMLInputElement).value) || 0 }));
  $('bend-minus').addEventListener('click', (e) => host.edit({ kind: 'bend', deg: null, by: -step(e) }));
  $('bend-plus').addEventListener('click', (e) => host.edit({ kind: 'bend', deg: null, by: step(e) }));
  $('bend-pitch').addEventListener('change', (e) => host.edit({ kind: 'bend', deg: Number((e.target as HTMLInputElement).value) || 0 }));
  $('raise-run').addEventListener('click', () => host.edit({ kind: 'raise', ...readRaiseFields() }));
  $('shift-left').addEventListener('click', () => host.edit({ kind: 'shift', by: -1 }));
  $('shift-right').addEventListener('click', () => host.edit({ kind: 'shift', by: 1 }));
  $('raise-flip').addEventListener('click', () => {
    const dir = $('raise-dir');
    dir.dataset.side = dir.dataset.side === 'a' ? 'b' : 'a';
    host.renderPanel();
  });
  $('raise-count').addEventListener('input', () => host.renderPanel());
  $('split').addEventListener('click', () => host.edit({ kind: 'split' }));
  $('join').addEventListener('click', () => host.edit({ kind: 'join' }));

  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, select, textarea')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) host.redo();
      else host.undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      host.redo();
    } else if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
      if (host.selection?.kind === 'joint') host.edit({ kind: 'split' });
      else host.edit({ kind: 'delete' });
    } else if (!mod && e.key.toLowerCase() === 'f') {
      host.edit({ kind: 'flip' });
    } else if (!mod && e.key.toLowerCase() === 'q') {
      host.edit({ kind: 'rotate', deg: e.shiftKey ? 1 : 15 });
    } else if (!mod && e.key.toLowerCase() === 'e') {
      host.edit({ kind: 'rotate', deg: e.shiftKey ? -1 : -15 });
    } else if (e.key === 'Escape') {
      host.select(null);
    }
  });
  return share;
}
