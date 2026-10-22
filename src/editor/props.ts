import { distancesAlong } from '../course/geometry';
import type { Course, Layout } from '../course/course';
import {
  addStopper,
  BOX_SIZES,
  HOSE_COLORS,
  hoseLength,
  insertHosePoint,
  newStopper,
  removeHosePoint,
  removeStopper,
  setStopper,
  turnStopper,
} from '../course/stoppers';
import { isStraight, moveStart, nearestRoad, onRoad, pastStart, placeStart, placeTimer, removeStart, removeTimer, timerLane } from '../course/timing';
import { $, toast } from './dom';
import type { PropSelection, Selection } from './selection';
import type { EditorView } from './view';

// The start line, lap timer and floor stoppers (#56, #53): adding them from
// the parts list, and their settings beside the selection.

/** What the prop tools need from the editor. */
export interface PropHost {
  readonly course: Course;
  readonly layout: Layout;
  readonly selection: Selection;
  /** The view on show, and both views. */
  readonly view: EditorView;
  readonly views: readonly EditorView[];
  /** Apply an edit, recording it for undo. */
  commit(next: Course, selection?: Selection): void;
  select(selection: Selection): void;
}

const pieceName = (layout: Layout, piece: number) => `#${piece + 1} ${layout.pieces[piece].part.name}`;

export class PropTools {
  constructor(private host: PropHost) {
    this.bind();
  }

  /** Whether the hoses and boxes are on show. */
  get stoppersShown(): boolean {
    return $<HTMLInputElement>('show-stoppers').checked;
  }

  /**
   * Put the start line or timer on the selected piece, or else on the road
   * nearest the middle of the view; a hose or box goes in the middle of the
   * view. There is one start and one timer, so those move.
   */
  add(kind: 'start' | 'timer' | 'hose' | 'box', size = 1): void {
    const { course, layout, selection } = this.host;
    const [cx, cz] = this.host.view.centre;
    if (kind === 'hose' || kind === 'box') {
      const next = addStopper(course, newStopper(kind, cx, cz, size));
      this.showStoppers();
      this.host.commit(next, { kind: 'stopper', index: next.stoppers!.length - 1 });
      return;
    }
    // Halfway along the selected piece, else the straight nearest the middle of the view, else any road.
    const near = nearestRoad(layout, cx, cz, undefined, (pc) => isStraight(pc.part)) ?? nearestRoad(layout, cx, cz);
    const piece = selection?.kind === 'piece' && layout.pieces[selection.index].part.lanes.length ? selection.index : near?.piece;
    const middle = piece === undefined ? null : { piece, offset: distancesAlong(layout.pieces[piece].geometry.samples).at(-1)! / 2 };
    // A timer added on its own goes just past the start, unless a piece is chosen for it.
    const spot = kind === 'timer' && selection?.kind !== 'piece' ? (pastStart(course) ?? middle) : middle;
    if (!spot) {
      toast('先にコースを作ってください（道のあるピースに置きます）');
      return;
    }
    const had = kind === 'start' ? course.start : course.timer;
    const next = kind === 'start' ? placeStart(course, spot.piece, spot.offset) : placeTimer(course, { piece: spot.piece, offset: spot.offset });
    if (had) toast(kind === 'start' ? 'スタートはコースに1つなので、ここへ移しました' : 'ラップタイマーはコースに1つなので、ここへ移しました');
    this.host.commit(next, { kind });
  }

  /** Delete the selected prop, or the selected point of a hose; false when the selection is not one. */
  deleteSelected(): boolean {
    const { course, selection: s } = this.host;
    if (s?.kind === 'start') this.host.commit(removeStart(course));
    else if (s?.kind === 'timer') this.host.commit(removeTimer(course));
    else if (s?.kind === 'stopper' && s.point !== undefined) {
      const next = removeHosePoint(course, s.index, s.point);
      if (next === course) toast('これ以上は点を減らせません');
      else this.host.commit(next, { kind: 'stopper', index: s.index });
    } else if (s?.kind === 'stopper') this.host.commit(removeStopper(course, s.index));
    else return false;
    return true;
  }

  /** Turn the selected stopper about its middle, + to the left; false when the selection is not one. */
  turnSelected(deg: number): boolean {
    const s = this.host.selection;
    if (s?.kind !== 'stopper') return false;
    this.host.commit(turnStopper(this.host.course, s.index, deg), { kind: 'stopper', index: s.index });
    return true;
  }

  /** Put the hoses and boxes on show, as when one is added or picked. */
  showStoppers(): void {
    const box = $<HTMLInputElement>('show-stoppers');
    if (box.checked) return;
    box.checked = true;
    for (const view of this.host.views) view.setStoppersShown(true);
  }

  /** Apply an edit to the selected prop, keeping it selected. */
  private edit(change: (course: Course, s: PropSelection) => Course): void {
    const s = this.host.selection;
    if (s?.kind === 'start' || s?.kind === 'timer' || s?.kind === 'stopper') this.host.commit(change(this.host.course, s), s);
  }

  private bind(): void {
    $('props-palette').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (b?.dataset.prop) this.add(b.dataset.prop as 'start', Number(b.dataset.size ?? 1));
    });
    $('show-stoppers').addEventListener('change', () => {
      for (const view of this.host.views) view.setStoppersShown(this.stoppersShown);
      if (!this.stoppersShown && this.host.selection?.kind === 'stopper') this.host.select(null);
    });
    $<HTMLSelectElement>('hose-color').append(...HOSE_COLORS.map((c, i) => new Option(c.name, String(i))));
    $<HTMLSelectElement>('box-size').append(...BOX_SIZES.map((b, i) => new Option(`${b.name}（${b.width}×${b.depth}×${b.height}mm）`, String(i))));
    $('prop-offset').addEventListener('change', (e) => {
      const offset = Number((e.target as HTMLInputElement).value) || 0;
      this.edit((c, s) => (s.kind === 'start' ? moveStart(c, { offset }) : s.kind === 'timer' ? placeTimer(c, { offset }) : c));
    });
    $('start-flip').addEventListener('click', () => this.edit((c) => moveStart(c, { reverse: !c.start?.reverse })));
    $('timer-side').addEventListener('change', (e) => this.edit((c) => placeTimer(c, { side: (e.target as HTMLSelectElement).value as 'left' })));
    $('timer-mode').addEventListener('change', (e) => this.edit((c) => placeTimer(c, { everyLane: (e.target as HTMLSelectElement).value === 'every' })));
    const stopper = (change: (c: Course, index: number) => Course) => this.edit((c, s) => (s.kind === 'stopper' ? change(c, s.index) : c));
    $('hose-color').addEventListener('change', (e) => stopper((c, i) => setStopper(c, i, { color: Number((e.target as HTMLSelectElement).value) })));
    $('hose-closed').addEventListener('change', (e) => stopper((c, i) => setStopper(c, i, { closed: (e.target as HTMLInputElement).checked })));
    $('hose-add-point').addEventListener('click', () => {
      const s = this.host.selection;
      if (s?.kind !== 'stopper') return;
      // After the selected point, or on the longest span.
      const next = insertHosePoint(this.host.course, s.index, s.point);
      this.host.commit(next, { kind: 'stopper', index: s.index, point: s.point === undefined ? undefined : s.point + 1 });
    });
    $('hose-remove-point').addEventListener('click', () => this.deleteSelected());
    $('box-size').addEventListener('change', (e) => stopper((c, i) => setStopper(c, i, { size: Number((e.target as HTMLSelectElement).value) })));
    $('box-way').addEventListener('change', (e) => stopper((c, i) => setStopper(c, i, { upright: (e.target as HTMLSelectElement).value === 'up' })));
    $('prop-rot-left').addEventListener('click', (e) => this.turnSelected(e.shiftKey ? 1 : 15));
    $('prop-rot-right').addEventListener('click', (e) => this.turnSelected(e.shiftKey ? -1 : -15));
    $('prop-delete').addEventListener('click', () => this.deleteSelected());
  }
}

/** Show the settings of the selected prop, if a prop is selected. */
export function renderPropPanel(layout: Layout, s: Selection): void {
  const kind = s?.kind === 'start' || s?.kind === 'timer' || s?.kind === 'stopper' ? s.kind : null;
  $('prop-panel').hidden = !kind;
  if (!kind) return;
  const stopper = s?.kind === 'stopper' ? layout.stoppers[s.index] : undefined;
  const on = kind === 'start' ? layout.start : kind === 'timer' ? layout.timer : null;
  $('start-row').hidden = kind !== 'start';
  $('timer-rows').hidden = kind !== 'timer';
  $('hose-rows').hidden = stopper?.kind !== 'hose';
  $('box-rows').hidden = stopper?.kind !== 'box';
  $('prop-offset-row').hidden = !on;
  $('prop-turn-row').hidden = !stopper;
  const field = <T extends HTMLInputElement | HTMLSelectElement>(id: string, value: string) => {
    const el = $<T>(id);
    if (document.activeElement !== el) el.value = value;
    return el;
  };
  if (on) {
    const pc = layout.pieces[on.piece];
    field('prop-offset', String(onRoad(pc, on.offset)));
    $('prop-offset-from').textContent = `（${pieceName(layout, on.piece)} の口 ${pc.part.ports[0].id} の端から）`;
  }
  if (kind === 'start' && layout.start) {
    $('prop-name').textContent = 'スタート';
    $('prop-hint').textContent = `START のステッカーを全レーンに貼ります。矢印が走り出す向きです。ドラッグで道に沿って動かせます。${layout.start.reverse ? '（口 ' + layout.pieces[layout.start.piece].part.ports[0].id + ' の方へ走ります）' : ''}`;
  } else if (kind === 'timer' && layout.timer) {
    const timer = layout.timer;
    $('prop-name').textContent = 'ラップタイマー（15184）';
    field('timer-side', timer.side);
    field('timer-mode', timer.everyLane ? 'every' : 'covered');
    const lanes = layout.pieces[timer.piece].part.lanes;
    const lane = timerLane(layout.pieces[timer.piece], timer);
    const name = lanes.length < 2 ? '' : lane === Math.min(...lanes) ? '左の' : '右の';
    const straight = isStraight(layout.pieces[timer.piece].part);
    $('prop-hint').innerHTML = `${straight ? '' : '<span class="warn">ストレート以外では、実物は壁にうまく取り付けられないことがあります。</span>'}本体を${timer.side === 'left' ? '左' : '右'}の壁の外に立て、${name}レーンの上に張り出します。寸法は箱絵からの仮の値です。実物どおりの計測では、3 レーンを一巡して同じレーンに戻るごとに 1 周になります。`;
  } else if (stopper?.kind === 'hose') {
    $('prop-name').textContent = `ホース${s?.kind === 'stopper' && s.point !== undefined ? `（点 ${s.point + 1}）` : ''}`;
    field('hose-color', String(stopper.color));
    $<HTMLInputElement>('hose-closed').checked = !!stopper.closed;
    $<HTMLButtonElement>('hose-remove-point').disabled = s?.kind !== 'stopper' || s.point === undefined;
    $('hose-length').textContent = `長さ 約 ${(hoseLength(stopper) / 1000).toFixed(2)} m（外径 15mm の仮の値で表示）`;
    $('prop-hint').textContent = '床に置くホースです。白い点をドラッグすると形を変えられ、線をドラッグすると全体が動きます。';
  } else if (stopper?.kind === 'box') {
    $('prop-name').textContent = '段ボール箱';
    field('box-size', String(stopper.size));
    field('box-way', stopper.upright ? 'up' : 'side');
    $('prop-hint').textContent = '飛び出したマシンを受け止める箱です。横倒しでは、2D の明るい線の側が開いた口です。大きさは仮の値です。';
  }
}
