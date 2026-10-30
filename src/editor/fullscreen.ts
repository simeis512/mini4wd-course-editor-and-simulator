import { $ } from './dom';

// The 全画面 button: the whole page fills the screen, in place of installing the app (#129, #127).

export function bindFullscreen(): void {
  const button = $<HTMLButtonElement>('fullscreen');
  // iPhone Safari only lets videos fill the screen, so the button would do nothing there.
  if (!document.fullscreenEnabled) return;
  button.hidden = false;
  button.addEventListener('click', () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  });
  document.addEventListener('fullscreenchange', () => {
    const on = !!document.fullscreenElement;
    button.setAttribute('aria-pressed', String(on));
    button.textContent = on ? '全画面を終わる' : '全画面';
  });
}
