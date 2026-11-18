import { $ } from './dom';

// The 全画面 button: the whole page fills the screen, in place of installing the app (#129, #127).

export function bindFullscreen(): void {
  const button = $<HTMLButtonElement>('fullscreen');
  // iPhone Safari only lets videos fill the screen, so the button would do nothing there.
  if (!document.fullscreenEnabled) return;
  button.hidden = false;
  // Its stand-in in the ファイル menu on the narrowest phones (#31).
  for (const e of document.querySelectorAll<HTMLElement>('.fullscreen-item')) e.hidden = false;
  button.addEventListener('click', () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  });
  document.addEventListener('fullscreenchange', () => {
    const on = !!document.fullscreenElement;
    button.setAttribute('aria-pressed', String(on));
    button.querySelector('.label')!.textContent = on ? '全画面を終わる' : '全画面';
    $('fullscreen-item-label').textContent = on ? '全画面を終わる' : '全画面';
  });
}
