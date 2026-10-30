import { MACHINE_CLEARANCE, type Clash } from '../course/clash';
import type { ContactTarget } from '../course/stopper-contact';
import { groupCount, portKey, type Course, type Layout, type PortRef, type Problem } from '../course/course';
import { BEND_LIMIT, TWIST_LIMIT } from '../course/flex';
import type { LapCheck } from '../course/laps';
import { floorExtent } from '../course/share-image';
import { $ } from './dom';
import { shoppingHtml } from './shopping';

// The course box: what the course is made of and what the checks found (spec 7).

/** What the checks found, besides what the layout itself knows. */
export interface CourseChecks {
  clashes: Clash[];
  laps: LapCheck | null;
}

/** What a click in the course box asks for. */
export interface CheckHandlers {
  /** Select a piece, an open port or a stopper. */
  pick(target: { piece: number } | PortRef | { stopper: number }): void;
  /** Mark an open port as left open on purpose, or clear the mark (#13). */
  intended(ref: PortRef, on: boolean): void;
  /** Run the course the other way round. */
  reverse(): void;
}

const PROBLEM_TEXT: Record<Problem['kind'], string> = {
  'not-level': '床側の端が水平ではありません（向きが逆かもしれません）',
  'cannot-join': 'このパーツ同士はつなげません',
  'forced-join': '無理な連結：実物のバンクアプローチは連結の爪がぶつかり合うので、つなぐには爪を折る必要があります',
  'bend-limit': `つなぎ目の折れ角が上限の目安 ${BEND_LIMIT}° を超えています`,
  'twist-limit': `ねじれが上限の目安 ${TWIST_LIMIT}° を超えています`,
};

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const mm = (n: number) => `${Math.round(n).toLocaleString('ja-JP')}mm`;

/** A piece's number and part name, as a button that selects it. */
function pieceLink(layout: Layout, piece: number): string {
  return `<button class="link" data-piece="${piece}">#${piece + 1} ${escape(layout.pieces[piece].part.name)}</button>`;
}

/** An open port: its piece and the port's name. */
function portLink(layout: Layout, ref: PortRef): string {
  const part = layout.pieces[ref.piece].part;
  return `<button class="link" data-port="${ref.piece}:${ref.port}">#${ref.piece + 1} ${escape(part.name)}・口 ${escape(part.ports[ref.port].id)}</button>`;
}

/** Open ports, each with a box to mark it as left open on purpose (spec 7, #13). */
function openPorts(layout: Layout): string[] {
  if (!layout.open.length) return [];
  const meant = new Set(layout.intended.map(portKey));
  const items = layout.open.map((ref) => {
    const on = meant.has(portKey(ref));
    return `<li class="${on ? 'muted' : 'warn'}">${portLink(layout, ref)}
      <label class="mark" title="ジャンプ台など、わざと開けている口は警告しません"><input type="checkbox" data-intended="${ref.piece}:${ref.port}"${on ? ' checked' : ''}>意図的</label></li>`;
  });
  const warned = layout.open.length - meant.size;
  const head = warned ? `<div class="warn">未接続の口: ${warned}</div>` : '<div class="ok">未接続の口はすべて意図的です</div>';
  return [head, `<ul class="checks">${items.join('')}</ul>`];
}

/** Lanes that end at a joint, each with a box to mark it as made that way (#60). */
function deadEnds(layout: Layout): string[] {
  if (!layout.deadEnds.length) return [];
  const items = layout.deadEnds.map((d) => {
    const lanes = d.lanes.length > 1 ? `${d.lanes.length} レーン` : '1 レーン';
    return `<li class="${d.intended ? 'muted' : 'warn'}"><span>${portLink(layout, d)} で ${lanes}</span>
      <label class="mark" title="ずらした接続などで、わざと行き止まりにしたレーンは警告しません"><input type="checkbox" data-intended="${d.piece}:${d.port}"${d.intended ? ' checked' : ''}>意図的</label></li>`;
  });
  const warned = layout.deadEnds.filter((d) => !d.intended).length;
  const head = warned ? `<div class="warn">行き止まりのレーン: ${warned}</div>` : '<div class="ok">行き止まりのレーンはすべて意図的です</div>';
  return [head, `<ul class="checks">${items.join('')}</ul>`];
}

/** A hose or box, as a button that selects it. */
function stopperLink(layout: Layout, index: number): string {
  const name = layout.stoppers[index].kind === 'hose' ? 'ホース' : '段ボール箱';
  return `<button class="link" data-stopper="${index}">${name} ${index + 1}</button>`;
}

/** What a stopper runs into, in words. */
function targetText(layout: Layout, t: ContactTarget): string {
  if (t.kind === 'piece') return pieceLink(layout, t.piece);
  if (t.kind === 'support') return `${pieceLink(layout, t.piece)} の支え`;
  if (t.kind === 'timer') return 'ラップタイマー';
  return stopperLink(layout, t.index);
}

/** Overlaps first: they cannot be built, while a low crossing only stops machines; stoppers in the way last. */
function clashLines(layout: Layout, clashes: readonly Clash[]): string[] {
  const rank: Record<Clash['kind'], number> = { interference: 0, clearance: 1, stopper: 2 };
  const order = [...clashes].sort((a, b) => rank[a.kind] - rank[b.kind]);
  return order.map((c) =>
    c.kind === 'interference'
      ? `<div class="err">${pieceLink(layout, c.pieces[0])} と ${pieceLink(layout, c.pieces[1])} が重なっています</div>`
      : c.kind === 'clearance'
        ? `<div class="warn">${pieceLink(layout, c.upper)} の下を通る ${pieceLink(layout, c.lower)} の上の高さが ${mm(c.gap)} しかありません（目安 ${MACHINE_CLEARANCE}mm）</div>`
        : `<div class="warn">${stopperLink(layout, c.stopper)} が ${targetText(layout, c.other)} に当たっています</div>`,
  );
}

/** Names of the lanes at the start line, left to right: inside and outside once the course turns one way. */
function laneNames(count: number, turn: LapCheck['turn']): string[] {
  const sides = count === 3 ? ['左', '中', '右'] : count === 2 ? ['左', '右'] : ['中'];
  if (!turn || count < 2) return sides;
  const ends = turn === 1 ? ['内', '外'] : ['外', '内'];
  return sides.map((s, i) => (i === 0 ? `${s}（${ends[0]}）` : i === count - 1 ? `${s}（${ends[1]}）` : s));
}

/** Where each lane goes lap by lap and how long its laps are (spec 7, #16). */
function lapLines(layout: Layout, laps: LapCheck): string[] {
  const out = ['<h3>レーン一巡と周長</h3>'];
  const broken = laps.laps.find((l) => l.broken);
  if (broken?.broken) {
    out.push(`<div class="warn">レーンが ${portLink(layout, broken.broken)} で途切れているため、一周をたどれません</div>`);
    return out;
  }
  if (laps.laps.some((l) => l.next === null)) {
    out.push('<div class="warn">スタートに戻ってこないレーンがあります</div>');
    return out;
  }
  const names = laneNames(laps.laps.length, laps.turn);
  const nameOf = (lane: number) => names[laps.laps.findIndex((l) => l.lane === lane)];
  const rows = laps.laps.map(
    (l, i) => `<tr><td>${names[i]}</td><td class="num">${mm(l.length)}</td><td>${l.next === l.lane ? '同じレーンへ' : `→ ${nameOf(l.next!)}`}</td></tr>`,
  );
  out.push(`<table class="laps"><tr><th>スタート</th><th>1周</th><th>次の周</th></tr>${rows.join('')}</table>`);
  const total = laps.laps.reduce((sum, l) => sum + l.length, 0);
  if (laps.allLanes) {
    out.push(`<div class="ok">${laps.cycle.length}周で全レーンを走ります（合計 ${mm(total)}）</div>`);
  } else {
    const n = laps.cycle.length;
    out.push(`<div class="warn">${n}周で同じレーンに戻り、全レーンを走りません（レーンチェンジを確かめてください）</div>`);
    out.push(`<div class="muted">各レーン1周の合計 ${mm(total)}</div>`);
  }
  out.push(`<div class="row"><span class="muted">#1 ${escape(layout.pieces[0].part.name)} に入るところから数えます</span><button id="reverse" class="small">走る向きを反転</button></div>`);
  return out;
}

/** Where the start line and timer are, or that there is no start yet; and the floor taken with the stoppers (#56, #53). */
function propLines(layout: Layout): string[] {
  if (!layout.pieces.length) return [];
  const { start, timer } = layout;
  const out = [
    start ? `<div>スタート: ${pieceLink(layout, start.piece)}</div>` : '<div class="muted">スタート未設定（置き物の「スタート」で置けます）</div>',
  ];
  if (timer) out.push(`<div>ラップタイマー: ${pieceLink(layout, timer.piece)}</div>`);
  if (layout.stoppers.length) {
    const { x, z } = floorExtent(layout);
    out.push(`<div class="muted">床の広さ（置き物込み）: ${mm(x)} × ${mm(z)}</div>`);
  }
  return out;
}

/** Bring the course box up to date: its summary line, the checks and the parts used. */
export function renderCourseInfo(course: Course, layout: Layout, checks: CourseChecks): void {
  const info: string[] = [];
  const islands = groupCount(layout);
  if (islands > 1) info.push(`<div class="muted">つながりのまとまり: ${islands} 個</div>`);
  info.push(...openPorts(layout));
  info.push(...deadEnds(layout));
  if (course.pieces.length > 0 && layout.open.length === 0) info.push('<div class="ok">コースは閉じています</div>');
  for (const pr of layout.problems) info.push(`<div class="warn">${pieceLink(layout, pr.piece)}: ${PROBLEM_TEXT[pr.kind]}</div>`);
  info.push(...clashLines(layout, checks.clashes));
  for (const c of layout.closures) {
    // Ports placed exactly together are simply joined; only real gaps are worth showing.
    if (c.distance < 0.05 && c.angle < 0.05) continue;
    info.push(`<div class="muted">ループ閉じ（#${c.a.piece + 1}–#${c.b.piece + 1}）: 誤差 ${c.distance.toFixed(1)}mm / ${c.angle.toFixed(1)}°</div>`);
  }
  info.push(...propLines(layout));
  if (checks.laps) info.push(...lapLines(layout, checks.laps));
  info.push(...shoppingHtml(course));
  $('info').innerHTML = info.join('');

  // The folded course box still shows the gist (#45).
  const open = layout.open.length - layout.intended.length;
  const errors = layout.problems.length + checks.clashes.length;
  const ends = layout.deadEnds.filter((d) => !d.intended).length;
  const lanesOk = !checks.laps || checks.laps.allLanes;
  const status =
    course.pieces.length === 0
      ? ''
      : [
          open ? `・未接続の口 ${open}` : '・閉じています',
          ends ? `・行き止まり ${ends}` : '',
          errors ? `・問題 ${errors}` : '',
          lanesOk ? '' : '・全レーンを走りません',
        ].join('');
  const bad = open || ends || errors || !lanesOk;
  $('course-summary').innerHTML = `コース: ${course.pieces.length} ピース<span class="${bad ? 'warn' : 'ok'}">${status}</span>`;
}

/** Answer clicks in the course box. */
export function bindCourseInfo(handlers: CheckHandlers): void {
  const info = $('info');
  info.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t) return;
    if (t.id === 'reverse') handlers.reverse();
    else if (t.dataset.piece) handlers.pick({ piece: Number(t.dataset.piece) });
    else if (t.dataset.stopper) handlers.pick({ stopper: Number(t.dataset.stopper) });
    else if (t.dataset.port) {
      const [piece, port] = t.dataset.port.split(':').map(Number);
      handlers.pick({ piece, port });
    }
  });
  info.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.dataset.intended) return;
    const [piece, port] = t.dataset.intended.split(':').map(Number);
    handlers.intended({ piece, port }, t.checked);
  });
}
