export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let toastTimer = 0;

/** Show a short message at the bottom of the page for a moment. */
export function toast(message: string): void {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2500);
}
