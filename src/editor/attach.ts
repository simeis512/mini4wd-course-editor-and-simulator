import { offsetWithin } from '../course/attachments';
import { getAttachment } from '../course/catalog';
import type { Layout } from '../course/course';
import { $ } from './dom';

// Washboards on the selected piece, in its settings (spec 4, #17).

/** What the washboard controls ask for. */
export interface AttachHandlers {
  add(kind: string): void;
  move(index: number, to: { lane?: number; offset?: number }): void;
  remove(index: number): void;
}

/** Names of a piece's lanes, left to right looking along its centreline from port a. */
function laneNames(lanes: readonly number[]): Map<number, string> {
  const sorted = [...lanes].sort((a, b) => a - b);
  const names = sorted.length === 3 ? ['左', '中', '右'] : sorted.length === 2 ? ['左', '右'] : ['中'];
  return new Map(sorted.map((lane, i) => [lane, names[i]]));
}

/** List the washboards on piece `index`, each with its lane, place and a remove button. */
export function renderAttachments(layout: Layout, index: number): void {
  const pc = layout.pieces[index];
  const names = laneNames(pc.part.lanes);
  const items = layout.attachments.flatMap((a, i) => {
    if (a.piece !== index) return [];
    const options = [...names].map(([lane, name]) => `<option value="${lane}"${lane === a.lane ? ' selected' : ''}>${name}</option>`);
    const short = getAttachment(a.kind).name.replace('ウォッシュボード ', '');
    return [
      `<li data-index="${i}"><span>${short}</span><select data-lane title="レーン（口 ${pc.part.ports[0].id} から見て）">${options.join('')}</select>
        <input data-offset type="number" step="10" value="${offsetWithin(pc, a)}" title="口 ${pc.part.ports[0].id} の端からウォッシュボードの真ん中まで" />mm
        <button data-remove title="はがす">×</button></li>`,
    ];
  });
  $('attach-list').innerHTML = items.join('');
}

export function bindAttachments(handlers: AttachHandlers): void {
  const box = $('attach-box');
  box.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (b?.dataset.attach) handlers.add(b.dataset.attach);
    const li = b?.closest<HTMLElement>('li');
    if (li && b?.dataset.remove !== undefined) handlers.remove(Number(li.dataset.index));
  });
  box.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const index = Number(t.closest<HTMLElement>('li')?.dataset.index);
    if (Number.isNaN(index)) return;
    if (t.dataset.lane !== undefined) handlers.move(index, { lane: Number(t.value) });
    else if (t.dataset.offset !== undefined) handlers.move(index, { offset: Number(t.value) || 0 });
  });
}
