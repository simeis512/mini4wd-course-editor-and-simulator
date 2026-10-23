import { $ } from './dom';

// Folding the side panel away to give the editor more room (#64). It slides
// out by a transform, then gives its column back to the editor; opening
// takes the column first, then slides in.

/** Set while the side panel is folded, so it starts folded next time. */
const FOLD_KEY = 'panel.folded';
/** How long the slide takes, ms: the same as the transition on `#side`. */
const SLIDE_MS = 250;

let folded = false;
/** Counts folds and opens, so a slide cut short by the next one does not finish it. */
let turn = 0;

/** Apply a class change at once, without the slide. */
function jump(change: () => void): void {
  const body = document.body;
  body.classList.add('no-slide');
  change();
  // Lay out in the new state before the slide comes back on.
  void $('side').offsetWidth;
  body.classList.remove('no-slide');
}

/** Fold the side panel away or open it again, remembering which for next time. */
export function foldPanel(fold: boolean, animate = true): void {
  const button = $('panel-fold');
  button.setAttribute('aria-expanded', String(!fold));
  button.title = fold ? 'パーツ一覧を開く' : 'パーツ一覧を畳んで、編集画面を広くする';
  try {
    if (fold) localStorage.setItem(FOLD_KEY, '1');
    else localStorage.removeItem(FOLD_KEY);
  } catch {
    // Storage blocked: the panel opens again next time.
  }
  if (fold === folded) return;
  folded = fold;
  const body = document.body.classList;
  const mine = ++turn;
  if (fold) {
    const done = () => jump(() => (body.add('panel-folded'), body.remove('panel-sliding')));
    if (!animate) return done();
    body.add('panel-sliding');
    setTimeout(() => mine === turn && done(), SLIDE_MS);
  } else {
    jump(() => (body.add('panel-sliding'), body.remove('panel-folded')));
    if (animate) body.remove('panel-sliding');
    else jump(() => body.remove('panel-sliding'));
  }
}

/** Fold the side panel as it was left, and let its tab fold and open it. */
export function bindSidePanel(): void {
  let fold = false;
  try {
    fold = localStorage.getItem(FOLD_KEY) === '1';
  } catch {
    // Storage blocked: start open.
  }
  foldPanel(fold, false);
  $('panel-fold').addEventListener('click', () => foldPanel(!folded));
}
