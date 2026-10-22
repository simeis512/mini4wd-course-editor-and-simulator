import { $ } from './dom';
import type { TopView } from './view2d';

// Buttons to turn the 2D view (#75), beside the height tools. Two fingers or
// the right mouse button turn it freely; these go round in steps.

export function bindTurnTools(view: TopView): void {
  $('turn-left').addEventListener('click', () => view.turnStep(-1));
  $('turn-right').addEventListener('click', () => view.turnStep(1));
  $('turn-reset').addEventListener('click', () => view.turnStep(0));
}

/** Show how far the view is turned. */
export function renderTurnTools(view: TopView): void {
  const angle = Math.round(view.angle) % 360;
  $('turn-reset').textContent = `${angle}°`;
  $<HTMLButtonElement>('turn-reset').disabled = angle === 0;
}
