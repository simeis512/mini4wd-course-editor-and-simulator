import { getPart, PARTS, variantOf } from '../course/catalog';
import { compatible, groupCount, movingGroup, partCounts, placementOf, portKey, type Course, type Layout, type PortRef, type Problem } from '../course/course';
import { footprint, jointBend } from '../course/edit';
import { BEND_LIMIT, TWIST_LIMIT } from '../course/flex';
import { bendable, joinableNear } from '../course/joining';
import { previewRun } from '../course/raise';
import { $ } from './dom';
import { floatSpot, rectAround, type Rect } from './float';
import { partIcon } from './icons';
import type { Selection } from './selection';
import type { EditorView, RunMarks } from './view';

export const POSE_FIELDS = ['pose-x', 'pose-y', 'pose-z', 'pose-yaw', 'pose-pitch', 'pose-roll'] as const;

/** What a button in the parts list does: `port` is the way round chosen, if the part has two. */
export interface PaletteHandlers {
  click(partId: string, port: number | undefined): void;
  down(e: PointerEvent, partId: string, port: number | undefined): void;
  move(e: PointerEvent): void;
  up(e: PointerEvent, cancelled: boolean): void;
}

/** Fill the parts list with a button per part, or per way round. */
export function buildPalette(handlers: PaletteHandlers): void {
  const palette = $('palette');
  for (const part of PARTS) {
    // A part that differs turned round comes both ways: port 0 first, then port 1 (#43).
    const sides: [number | undefined, string][] = part.ways ? [[0, part.ways[0]], [1, part.ways[1]]] : [[undefined, '']];
    for (const [port, side] of sides) {
      const b = document.createElement('button');
      b.dataset.part = part.id;
      const label = document.createElement('span');
      label.innerHTML = `${part.name}${side ? ` ${side}` : ''}${part.setCode ? ` <small>${part.setCode}</small>` : ''}`;
      b.append(partIcon(part, port ?? 0), label);
      b.title = `${part.name}${side ? `（${side}）` : ''}：クリックで追加、ドラッグでコースに置く`;
      b.addEventListener('click', () => handlers.click(part.id, port));
      b.addEventListener('pointerdown', (e) => handlers.down(e, part.id, port));
      b.addEventListener('pointermove', (e) => handlers.move(e));
      b.addEventListener('pointerup', (e) => handlers.up(e, false));
      b.addEventListener('pointercancel', (e) => handlers.up(e, true));
      palette.appendChild(b);
    }
  }
}

/** Bring the parts list, the selection's settings and the course summary up to date. */
export function renderPanels(course: Course, layout: Layout, s: Selection): void {
  // Parts list: joins to the selected open port where it can, else adds on its own.
  const empty = course.pieces.length === 0;
  const target = s?.kind === 'port' ? layout.pieces[s.ref.piece].part : null;
  for (const b of $('palette').querySelectorAll<HTMLButtonElement>('button')) {
    const part = getPart(b.dataset.part!);
    const joins = target && s?.kind === 'port' && part.ports.some((_, p) => compatible(target, s.ref.port, part, p));
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
    $('selection-name').textContent = `#${s.index + 1} ${pc.part.name}`;
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
    const twist = pc.rec.twist ?? 0;
    setAngleField('twist', twist);
    showLimit('twist-warn', twist, TWIST_LIMIT, 'ねじれ');

    const group = movingGroup(layout, s.index);
    $('group-info').textContent =
      group.size > 1
        ? `点線のピースとつながっています。ドラッグするとつながった ${group.size} 個が一緒に動きます`
        : 'ほかのピースとつながっていません';
    const { base, pose } = placementOf(pc.rec);
    const from = base ? `#${base.piece + 1} ${layout.pieces[base.piece].part.name} の口から` : 'ワールド原点から';
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
    const name = (r: { piece: number }) => `#${r.piece + 1} ${layout.pieces[r.piece].part.name}`;
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
  }
  const near = s?.kind === 'port' ? joinableNear(layout, s.ref) : null;
  $('port-panel').hidden = s?.kind !== 'port';
  $('join-row').hidden = !near;
  if (near) $('join-name').textContent = `近くの口（#${near.piece + 1} ${layout.pieces[near.piece].part.name}）`;

  renderCourseInfo(course, layout);

  // Settings for the selection float over the editor, next to it (#45).
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

const PROBLEM_TEXT: Record<Problem['kind'], string> = {
  'not-level': '床側の端が水平ではありません（向きが逆かもしれません）',
  'cannot-join': 'このパーツ同士はつなげません',
  'bend-limit': `つなぎ目の折れ角が上限の目安 ${BEND_LIMIT}° を超えています`,
  'twist-limit': `ねじれが上限の目安 ${TWIST_LIMIT}° を超えています`,
};

function renderCourseInfo(course: Course, layout: Layout): void {
  const info: string[] = [];
  const islands = groupCount(layout);
  if (islands > 1) info.push(`<div class="muted">つながりのまとまり: ${islands} 個</div>`);
  const counts = [...partCounts(course)].map(([id, n]) => `<li>${getPart(id).name} × ${n}</li>`);
  if (counts.length) info.push(`<ul>${counts.join('')}</ul>`);
  if (layout.open.length > 0) {
    info.push(`<div class="warn">未接続の口: ${layout.open.length}</div>`);
  } else if (course.pieces.length > 0) {
    info.push('<div class="ok">コースは閉じています</div>');
  }
  for (const pr of layout.problems) {
    info.push(`<div class="warn">#${pr.piece + 1} ${layout.pieces[pr.piece].part.name}: ${PROBLEM_TEXT[pr.kind]}</div>`);
  }
  for (const c of layout.closures) {
    // Ports placed exactly together are simply joined; only real gaps are worth showing.
    if (c.distance < 0.05 && c.angle < 0.05) continue;
    info.push(`<div class="muted">ループ閉じ（#${c.a.piece + 1}–#${c.b.piece + 1}）: 誤差 ${c.distance.toFixed(1)}mm / ${c.angle.toFixed(1)}°</div>`);
  }
  $('info').innerHTML = info.join('');
  // The folded course box still shows the gist (#45).
  const status = course.pieces.length === 0 ? '' : layout.open.length > 0 ? `・未接続の口 ${layout.open.length}` : '・閉じています';
  $('course-summary').innerHTML = `コース: ${course.pieces.length} ピース<span class="${layout.open.length || layout.problems.length ? 'warn' : 'ok'}">${status}</span>${layout.problems.length ? '<span class="warn">・問題あり</span>' : ''}`;
}

/** Where a piece lies on screen, roughly: its footprint between its lowest and highest port. */
function pieceRect(view: EditorView, layout: Layout, index: number, stage: DOMRect): Rect | null {
  const pc = layout.pieces[index];
  const [x0, x1, z0, z1] = footprint(pc);
  const ys = pc.ports.map((p) => p.elements[13]);
  const pts: [number, number][] = [];
  for (const y of [Math.min(...ys), Math.max(...ys)]) {
    for (const [x, z] of [[x0, z0], [x0, z1], [x1, z0], [x1, z1]]) {
      const q = view.clientOf(x, y, z);
      if (q) pts.push([q[0] - stage.left, q[1] - stage.top]);
    }
  }
  return rectAround(pts);
}

/**
 * Put the selection's settings beside it on screen, keeping them inside the
 * editor and off the selection and the pieces `lit` up for it.
 */
export function placeContext(view: EditorView, layout: Layout, s: Selection, lit: readonly number[] = []): void {
  const box = $('context');
  if (box.hidden || !s) return;
  const stage = $('stage').getBoundingClientRect();
  let anchor: Rect | null;
  if (s.kind === 'piece') {
    anchor = pieceRect(view, layout, s.index, stage);
  } else {
    const ref = s.kind === 'port' ? s.ref : s.a;
    const e = layout.pieces[ref.piece].ports[ref.port].elements;
    const q = view.clientOf(e[12], e[13], e[14]);
    anchor = q && rectAround([[q[0] - stage.left, q[1] - stage.top]]);
  }
  const avoid = lit.map((i) => pieceRect(view, layout, i, stage)).filter((r): r is Rect => r !== null);
  if (anchor) avoid.push(anchor);
  const [left, top] = floatSpot(box.offsetWidth, box.offsetHeight, stage.width, stage.height, anchor, avoid);
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
}
