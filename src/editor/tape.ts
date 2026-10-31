import type { Course } from '../course/course';
import {
  defaultTape,
  FRICTION_RANGE,
  TAPE_KIND_ORDER,
  TAPE_KINDS,
  TAPE_WIDTH_RANGE,
  TAPE_WIDTHS,
  type JointTape,
  type TapeKind,
  type TapeSpec,
  type WallTape,
} from '../course/tape';
import { $ } from './dom';

// The joint tape setting in the course box (#133): floor and walls each on
// or off, with the kind of tape, its width and friction; walls also
// whether the dividers between the lanes are taped too.

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function specRow(where: 'floor' | 'wall', spec: TapeSpec | undefined, label: string): string {
  const on = !!spec;
  const s = spec ?? defaultTape();
  const kinds = TAPE_KIND_ORDER.map((k) => `<option value="${k}"${k === s.kind ? ' selected' : ''}>${escape(TAPE_KINDS[k].name)}</option>`).join('');
  const out = [`<div class="row tape"><label><input type="checkbox" data-tape="${where}"${on ? ' checked' : ''}>${label}</label>`];
  if (on) {
    out.push(
      `<select data-tape="${where}-kind" title="種類を選ぶと幅と摩擦係数が入ります">${kinds}</select>`,
      `<label title="つなぎ目をまたぐ向きの長さ">幅 <input type="number" list="tape-widths" min="${TAPE_WIDTH_RANGE[0]}" max="${TAPE_WIDTH_RANGE[1]}" step="1" data-tape="${where}-width" value="${s.width}">mm</label>`,
      `<label title="マシン（タイヤ・ローラー）とのあいだの摩擦係数。仮の値です">摩擦 <input type="number" min="${FRICTION_RANGE[0]}" max="${FRICTION_RANGE[1]}" step="0.05" data-tape="${where}-friction" value="${s.friction}"></label>`,
    );
  }
  out.push('</div>');
  return out.join('');
}

/** The joint tape section of the course box. */
export function tapeHtml(course: Course): string[] {
  if (!course.pieces.length) return [];
  const tape = course.tape ?? {};
  const out = ['<h3>つなぎ目のテープ</h3>', specRow('floor', tape.floor, '床'), specRow('wall', tape.wall, '壁')];
  if (tape.wall) {
    out.push(
      `<div class="row tape"><label><input type="checkbox" data-tape="wall-dividers"${tape.wall.dividers ? ' checked' : ''}>レーンの間の仕切りにも貼る</label></div>`,
      '<div class="muted">外側の壁（と仕切り）に上からかぶせて、上面と両側の面を覆います</div>',
    );
  }
  out.push(`<datalist id="tape-widths">${TAPE_WIDTHS.map((w) => `<option value="${w}">`).join('')}</datalist>`);
  out.push('<div class="muted">すべてのつなぎ目に同じように貼ります。摩擦係数は実測までの仮の値です</div>');
  return out;
}

const clamp = (n: number, [lo, hi]: readonly [number, number], fallback: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback);

/** The setting after a change to the control `name` (`floor`, `wall-kind`, ...), or null when it is not one of ours. */
export function changedTape(tape: JointTape, name: string, value: string, checked: boolean): JointTape | null {
  const [where, field] = name.split('-') as ['floor' | 'wall', string | undefined];
  if (where !== 'floor' && where !== 'wall') return null;
  const next: JointTape = { ...tape };
  const spec = tape[where];
  if (!field) {
    if (!checked) delete next[where];
    else if (where === 'wall') next.wall = { ...defaultTape(), dividers: false };
    else next.floor = defaultTape();
    return next;
  }
  if (!spec) return null;
  let changed: Partial<WallTape>;
  if (field === 'kind' && value in TAPE_KINDS) {
    // Picking a kind fills in its width and friction (owner, 2026-10-30).
    changed = defaultTape(value as TapeKind);
  } else if (field === 'width') {
    changed = { width: Math.round(clamp(Number(value), TAPE_WIDTH_RANGE, spec.width)) };
  } else if (field === 'friction') {
    changed = { friction: Math.round(clamp(Number(value), FRICTION_RANGE, spec.friction) * 1000) / 1000 };
  } else if (field === 'dividers' && where === 'wall') {
    changed = { dividers: checked };
  } else {
    return null;
  }
  if (where === 'wall') next.wall = { ...tape.wall!, ...changed };
  else next.floor = { ...spec, ...changed, kind: changed.kind ?? spec.kind };
  return next;
}

/** Answer changes to the tape setting in the course box. */
export function bindTape(course: () => Course, set: (tape: JointTape) => void): void {
  $('info').addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    const name = t.dataset.tape;
    if (!name) return;
    const next = changedTape(course().tape ?? {}, name, t.value, t.checked);
    if (next) set(next);
  });
}
