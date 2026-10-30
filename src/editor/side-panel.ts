import { $ } from './dom';

// Folding the side panel away to give the editor more room (#64). The
// sliding is all in the CSS: the panel's column closes and the editor
// widens with it.

/** Set while the side panel is folded, so it starts folded next time. */
const FOLD_KEY = 'panel.folded';

/** Fold the side panel away or open it again, remembering which for next time; `animate` false jumps there. */
export function foldPanel(folded: boolean, animate = true): void {
  const body = document.body.classList;
  if (!animate) body.add('no-slide');
  body.toggle('panel-folded', folded);
  if (!animate) {
    // Lay out in the new state before the slide comes back on.
    void $('side').offsetWidth;
    body.remove('no-slide');
  }
  const button = $('panel-fold');
  button.setAttribute('aria-expanded', String(!folded));
  button.title = folded ? 'パーツ一覧を開く' : 'パーツ一覧を畳んで、編集画面を広くする';
  try {
    if (folded) localStorage.setItem(FOLD_KEY, '1');
    else localStorage.removeItem(FOLD_KEY);
  } catch {
    // Storage blocked: the panel opens again next time.
  }
}

/** Bring the selection's settings into sight: open the panel if folded and scroll them in (#134). */
export function showContext(): void {
  if (document.body.classList.contains('panel-folded')) foldPanel(false);
  $('context').scrollIntoView({ block: 'nearest' });
}

/** Fold the side panel as it was left, and let its tab fold and open it. */
export function bindSidePanel(): void {
  let folded = false;
  try {
    folded = localStorage.getItem(FOLD_KEY) === '1';
  } catch {
    // Storage blocked: start open.
  }
  foldPanel(folded, false);
  $('panel-fold').addEventListener('click', () => foldPanel(!document.body.classList.contains('panel-folded')));
}
