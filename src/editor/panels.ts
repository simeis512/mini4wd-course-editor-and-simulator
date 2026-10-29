import type { PaletteItem } from '../course/add';
import { getPart, PARTS, variantOf } from '../course/catalog';
import { compatible, movingGroup, placementOf, portKey, type Course, type Layout, type PortRef } from '../course/course';
import { jointBend, jointShift, linkHolder, setShift } from '../course/edit';
import { BEND_LIMIT, TWIST_LIMIT } from '../course/flex';
import { asLink, bendable, joinableNear } from '../course/joining';
import { previewRun } from '../course/raise';
import { getTemplate, TEMPLATES } from '../course/templates';
import { CLOSE_LOOP_CAREFUL_PER_PIECE, CLOSE_LOOP_LIMIT, closeLoopReach, loopEnds } from '../course/close-loop';
import { renderAttachments } from './attach';
import { $ } from './dom';
import { partIcon, templateIcon } from './icons';
import { renderPropPanel } from './props';
import type { Selection } from './selection';
import type { RunMarks } from './view';

export const POSE_FIELDS = ['pose-x', 'pose-y', 'pose-z', 'pose-yaw', 'pose-pitch', 'pose-roll'] as const;

/** A piece as the panels name it: its number and part. */
function pieceLabel(layout: Layout, index: number): string {
  return `#${index + 1} ${layout.pieces[index].part.name}`;
}

/** What a button in the parts list or the templates does. */
export interface PaletteHandlers {
  click(item: PaletteItem): void;
  down(e: PointerEvent, item: PaletteItem): void;
  move(e: PointerEvent): void;
  up(e: PointerEvent, cancelled: boolean): void;
}

/** A button that adds `item` by a click, or by dragging it onto the course (#40, #41). */
function paletteButton(handlers: PaletteHandlers, item: PaletteItem, icon: SVGSVGElement, html: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  if ('template' in item) b.dataset.template = item.template;
  else b.dataset.part = item.part;
  const label = document.createElement('span');
  label.innerHTML = html;
  b.append(icon, label);
  b.title = `${title}：クリックで追加、ドラッグでコースに置く`;
  b.addEventListener('click', () => handlers.click(item));
  b.addEventListener('pointerdown', (e) => handlers.down(e, item));
  b.addEventListener('pointermove', (e) => handlers.move(e));
  b.addEventListener('pointerup', (e) => handlers.up(e, false));
  b.addEventListener('pointercancel', (e) => handlers.up(e, true));
  return b;
}

/** Fill the parts list with a button per part, or per way round, and the templates under it (#63). */
export function buildPalette(handlers: PaletteHandlers): void {
  const palette = $('palette');
  for (const part of PARTS) {
    // A part that differs turned round comes both ways: port 0 first, then port 1 (#43).
    const sides: [number | undefined, string][] = part.ways ? [[0, part.ways[0]], [1, part.ways[1]]] : [[undefined, '']];
    for (const [port, side] of sides) {
      const html = `${part.name}${side ? ` ${side}` : ''}${part.setCode ? ` <small>${part.setCode}</small>` : ''}`;
      const title = `${part.name}${side ? `（${side}）` : ''}`;
      palette.appendChild(paletteButton(handlers, { part: part.id, port }, partIcon(part, port ?? 0), html, title));
    }
  }
  for (const t of TEMPLATES) {
    $('templates').appendChild(paletteButton(handlers, { template: t.id }, templateIcon(t.id), t.name, `${t.name}（${t.note}）`));
  }
}

/** Bring the parts list, the selection's settings and the course summary up to date. */
export function renderPanels(course: Course, layout: Layout, s: Selection): void {
  // Parts list: joins to the selected open port where it can, else adds on its own.
  const empty = course.pieces.length === 0;
  const target = s?.kind === 'port' ? layout.pieces[s.ref.piece].part : null;
  for (const b of document.querySelectorAll<HTMLButtonElement>('#palette button, #templates button')) {
    // A template joins by its first piece's port.
    const first = b.dataset.template ? getTemplate(b.dataset.template).pieces[0] : null;
    const part = getPart(first?.part ?? b.dataset.part!);
    const ports = first ? [first.port] : part.ports.map((_, p) => p);
    const joins = target && s?.kind === 'port' && ports.some((p) => compatible(target, s.ref.port, part, p));
    b.classList.toggle('dim', !!target && !joins);
  }
  $('palette-hint').textContent = empty
    ? 'クリックで最初のピースを置きます。コースへドラッグして好きな場所にも置けます'
    : s?.kind === 'port'
      ? 'クリックで、選択中の口（水色の矢印）につなぎます。ドラッグでコースに置くこともできます'
      : 'クリックで画面の中央付近に単体で置きます。開いた口（オレンジの矢印）を選んでからクリックすると、そこにつなぎます。コースへドラッグすると好きな場所に置け、口の先へ落とすとつながります';

  // Selected piece.
  const panel = $('selection-panel');
  panel.hidden = s?.kind !== 'piece';
  if (s?.kind === 'piece') {
    const pc = layout.pieces[s.index];
    $('selection-name').textContent = pieceLabel(layout, s.index);
    const notes = [pc.part.note, pc.part.confidence === 'inferred' ? '寸法は推定値' : ''].filter(Boolean);
    $('selection-note').textContent = notes.join('・');
    const select = $<HTMLSelectElement>('variant');
    select.replaceChildren(
      ...pc.part.variants.map((v, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = v.name;
        return o;
      }),
    );
    select.value = String(pc.part.variants.indexOf(variantOf(pc.part, pc.rec.variant)));
    $<HTMLButtonElement>('flip').disabled = pc.part.ports.length !== 2;
    // A home-made straight takes its own length (#69).
    const range = pc.part.lengths;
    $('length-row').hidden = !range;
    if (range) {
      const input = $<HTMLInputElement>('piece-length');
      Object.assign(input, { min: String(range.min), max: String(range.max) });
      if (document.activeElement !== input) input.value = String(pc.geometry.length);
      $('length-range').textContent = `（${range.min}〜${range.max}）`;
    }
    const twist = pc.rec.twist ?? 0;
    setAngleField('twist', twist);
    showLimit('twist-warn', twist, TWIST_LIMIT, 'ねじれ');
    renderAttachments(layout, s.index);

    const group = movingGroup(layout, s.index);
    $('group-info').textContent =
      group.size > 1
        ? `点線のピースとつながっています。ドラッグするとつながった ${group.size} 個が一緒に動きます`
        : 'ほかのピースとつながっていません';
    // Closing the loop by force (#86): always shown, usable while the group's two open ends are near enough.
    const ends = loopEnds(layout, s.index);
    const reach = closeLoopReach(layout, s.index);
    const near = !!ends && ends.distance <= reach;
    $<HTMLButtonElement>('close-loop').disabled = !near;
    $('close-loop-warn').hidden = !near || ends.distance <= closeLoopReach(layout, s.index, CLOSE_LOOP_CAREFUL_PER_PIECE);
    $('close-loop-warn').textContent = `ずれが大きいので、ジョイントを大きめ（1 か所 ${CLOSE_LOOP_LIMIT}° まで）に曲げます。閉じたあと形を確かめてください`;
    $('close-loop-info').textContent = !ends
      ? layout.open.some((r) => group.has(r.piece))
        ? '開いた口がちょうど 2 つのときに使えます'
        : '開いた口はありません'
      : `口のずれ ${ends.distance.toFixed(1)}mm・${ends.angle.toFixed(1)}°${near ? '' : `（${group.size} ピースでは ${reach.toFixed(0)}mm まで）`}`;
    const { base, pose } = placementOf(pc.rec);
    const from = base ? `${pieceLabel(layout, base.piece)} の口から` : 'ワールド原点から';
    $('placement-base').textContent = 'free' in pc.rec ? `自由配置（${from}）` : base ? `連結（${from}）` : '先頭（原点）';
    const values = [...pose.pos, ...pose.rot];
    POSE_FIELDS.forEach((id, i) => {
      const input = $<HTMLInputElement>(id);
      if (document.activeElement !== input) input.value = String(values[i]);
    });
  }

  // Selected joint, or an open port that could be joined.
  $('joint-panel').hidden = s?.kind !== 'joint';
  if (s?.kind === 'joint') {
    const name = (r: PortRef) => pieceLabel(layout, r.piece);
    $('joint-name').textContent = `${name(s.a)} と ${name(s.b)} のつなぎ目`;
    // Only stored links bend (spec 16.1).
    const linked = bendable(course, s.a, s.b);
    $('bend-row').hidden = !linked;
    $('raise-box').hidden = !linked;
    // Which way to raise: into either piece, the later one first (spec 16.3).
    const dir = $('raise-dir');
    const key = `${portKey(s.a)}|${portKey(s.b)}`;
    if (dir.dataset.joint !== key) {
      dir.dataset.joint = key;
      dir.dataset.side = s.a.piece > s.b.piece ? 'a' : 'b';
    }
    dir.textContent = `${name(s[dir.dataset.side === 'a' ? 'a' : 'b'])} の方へ`;
    $('bend-closure').hidden = linked;
    const pitch = linked ? (jointBend(course, s.a, s.b).pitch ?? 0) : 0;
    setAngleField('bend-pitch', pitch);
    showLimit('bend-warn', pitch, BEND_LIMIT, '折れ角');
    $('shift-row').hidden = !linked;
    if (linked) showShift(asLink(course, s.a, s.b), layout, s.a, s.b);
  }
  const near = s?.kind === 'port' ? joinableNear(layout, s.ref) : null;
  $('port-panel').hidden = s?.kind !== 'port';
  $('join-row').hidden = !near;
  if (near) $('join-name').textContent = `近くの口（${pieceLabel(layout, near.piece)}）`;

  renderPropPanel(layout, s);

  // Settings for the selection, at the top of the side panel (#45, #134).
  $('context').hidden = s === null;
}

/**
 * The pieces a raise from the joint between `from` and `into` would move,
 * to blink, with a note on how far it reaches (spec 16.3).
 */
export function runMarks(course: Course, from: PortRef, into: PortRef, count: number): RunMarks {
  const { pieces, end } = previewRun(course, from, into, count);
  const short = pieces.length < count;
  const note = $('raise-note');
  note.classList.toggle('warn', short);
  if (pieces.length === 0) note.textContent = 'この向きには上げられるピースがありません（先頭のピースや、自由に置いたピースは動かせません）';
  else {
    const span = pieces.length === 1 ? `#${pieces[0] + 1} の` : `#${pieces[0] + 1} から #${pieces[pieces.length - 1] + 1} までの`;
    note.textContent = `点滅している ${span} ${pieces.length} ピースを上げます${short ? `（${count} ピースにあと ${count - pieces.length} ピース足りません。足りなくても上げられます）` : ''}`;
  }
  return { pieces, end, missing: count - pieces.length };
}

/**
 * The joint's sideways shift, as seen looking out of the piece it hangs off,
 * with the arrows off where no lane would meet (#60).
 */
function showShift(course: Course, layout: Layout, a: PortRef, b: PortRef): void {
  const shift = jointShift(course, a, b);
  $('shift-value').textContent = shift === 0 ? 'なし' : `${shift > 0 ? '右' : '左'}へ ${Math.abs(shift)} レーン`;
  const base = linkHolder(course, a, b) === a.piece ? b : a;
  $('shift-from').textContent = `（${pieceLabel(layout, base.piece)} から見て）`;
  $<HTMLButtonElement>('shift-left').disabled = setShift(course, a, b, shift - 1) === course;
  $<HTMLButtonElement>('shift-right').disabled = setShift(course, a, b, shift + 1) === course;
}

function setAngleField(id: string, deg: number): void {
  const input = $<HTMLInputElement>(id);
  if (document.activeElement !== input) input.value = String(deg);
}

/** Warn when an angle is past what real parts give (spec 16.4); it is still allowed. */
function showLimit(id: string, deg: number, limit: number, what: string): void {
  const warn = $(id);
  warn.hidden = Math.abs(deg) <= limit;
  warn.textContent = `${what}が上限の目安 ${limit}° を超えています（目安は実測待ちの仮の値です）`;
}
