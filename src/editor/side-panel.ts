import { $ } from './dom';

// Folding the side panel away to give the editor more room (#64).

/** Set while the side panel is folded, so it starts folded next time. */
const FOLD_KEY = 'panel.folded';

/** Fold the side panel away or open it again, remembering which for next time. */
export function foldPanel(folded: boolean): void {
  document.body.classList.toggle('panel-folded', folded);
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

/** Fold the side panel as it was left, and let its button fold and open it. */
export function bindSidePanel(): void {
  let folded = false;
  try {
    folded = localStorage.getItem(FOLD_KEY) === '1';
  } catch {
    // Storage blocked: start open.
  }
  foldPanel(folded);
  $('panel-fold').addEventListener('click', () => foldPanel(!document.body.classList.contains('panel-folded')));
}
