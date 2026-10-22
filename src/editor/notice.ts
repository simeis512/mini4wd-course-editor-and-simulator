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

export function bindAbout(): void {
  const about = $<HTMLDialogElement>('about-dialog');
  $('about').addEventListener('click', () => about.showModal());
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
