import { FORMAT_VERSION } from '../course/codec';
import { markSeen, parseChangelog, updateMark } from './changelog';
import { $ } from './dom';

// The notice shown on start (#67) and the about panel (#70).

/** Set once "次回以降表示しない" is ticked (#67). */
const HIDE_NOTICE_KEY = 'notice.hidden';

function noticeHidden(): boolean {
  try {
    return localStorage.getItem(HIDE_NOTICE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Open the notice; resolves when it is closed. */
function openNotice(): Promise<void> {
  const dialog = $<HTMLDialogElement>('notice-dialog');
  const hide = $<HTMLInputElement>('notice-hide');
  hide.checked = noticeHidden();
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        try {
          if (hide.checked) localStorage.setItem(HIDE_NOTICE_KEY, '1');
          else localStorage.removeItem(HIDE_NOTICE_KEY);
        } catch {
          // Storage blocked: the notice just shows again next time.
        }
        resolve();
      },
      { once: true },
    );
  });
}

/** Show the notice on start, every time until "次回以降表示しない" is ticked (#67). */
export function showNoticeOnStart(): Promise<void> {
  return noticeHidden() ? Promise.resolve() : openNotice();
}

/** Licence texts of the libraries in the app, loaded only when asked for (#70). */
async function loadLicences(): Promise<string> {
  // By path: the packages' exports do not list their LICENSE files.
  const texts = await Promise.all([
    import('../../node_modules/three/LICENSE?raw'),
    import('../../node_modules/@dimforge/rapier3d-compat/LICENSE?raw'),
    import('../../node_modules/uqr/LICENSE?raw'),
    import('../../node_modules/jsqr/LICENSE?raw'),
  ]);
  const names = ['three.js', 'Rapier (@dimforge/rapier3d-compat)', 'uqr', 'jsQR'];
  return names.map((name, i) => `${name}\n\n${texts[i].default}`).join('\n\n----\n\n');
}

/** The browser's storage, or none when it is blocked. */
function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** Versions shown open in the changelog; older ones are folded (#137). */
const OPEN_RELEASES = 3;

/** Fill the changelog in the about panel from CHANGELOG.md, loaded only when asked for (#137). */
async function loadChangelog(box: HTMLElement): Promise<void> {
  const { default: text } = await import('../../CHANGELOG.md?raw');
  box.replaceChildren(
    ...parseChangelog(text).map((r, i) => {
      const d = document.createElement('details');
      d.open = i < OPEN_RELEASES;
      const s = document.createElement('summary');
      s.textContent = `v${r.version}（${r.date}）`;
      const ul = document.createElement('ul');
      for (const line of r.lines) ul.append(Object.assign(document.createElement('li'), { textContent: line }));
      d.append(s, ul);
      return d;
    }),
  );
}

export function bindAbout(): void {
  const about = $<HTMLDialogElement>('about-dialog');
  const button = $('about');
  // Version, share URL format and commit, for bug reports (#137).
  $('about-version').textContent = [`v${__APP_VERSION__}`, `共有 URL 形式 ${FORMAT_VERSION}`, __APP_COMMIT__].filter(Boolean).join(' ・ ');
  const store = storage();
  try {
    if (store && updateMark(__APP_VERSION__, store)) {
      button.classList.add('updated');
      button.title += '（更新があります）';
    }
  } catch {
    // Storage blocked: no mark.
  }
  button.addEventListener('click', () => {
    about.showModal();
    if (!button.classList.contains('updated')) return;
    button.classList.remove('updated');
    button.title = button.title.replace('（更新があります）', '');
    try {
      if (store) markSeen(__APP_VERSION__, store);
    } catch {
      // Storage blocked: the mark shows again next time.
    }
  });
  const changelog = $<HTMLDetailsElement>('changelog');
  changelog.addEventListener('toggle', () => {
    const box = changelog.querySelector('div')!;
    if (!changelog.open || box.childElementCount) return;
    box.textContent = '読み込み中…';
    loadChangelog(box).catch(() => (box.textContent = '読み込めませんでした'));
  });
  $('about-notice').addEventListener('click', () => {
    about.close();
    void openNotice();
  });
  const texts = $<HTMLDetailsElement>('licence-texts');
  texts.addEventListener('toggle', () => {
    const pre = texts.querySelector('pre')!;
    if (!texts.open || pre.textContent) return;
    pre.textContent = '読み込み中…';
    loadLicences().then(
      (text) => (pre.textContent = text),
      () => (pre.textContent = '読み込めませんでした'),
    );
  });
  // Close a dialog by clicking outside it.
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
  }
}
