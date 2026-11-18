import {
  BATTERIES,
  BRAKE_SPONGES,
  byId,
  CHASSIS,
  DAMPER_WEIGHTS,
  GEARS,
  REGULATION,
  ROLLER_KINDS,
  ROLLER_SIZES,
  TYRE_KINDS,
  TYRES,
} from '../machine/parts';
import { kitRollers, massOf, motorsFor, ROLLER_PRESETS, withChassis, type MachineSetup } from '../machine/setup';

// The machine screen's settings (#31): the parts picked and where they go,
// drawn afresh from the setup after every change.

type Change = (next: MachineSetup) => void;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
}

function select(value: string, options: readonly { value: string; label: string }[], set: (v: string) => void, title = ''): HTMLSelectElement {
  const s = el('select', { title });
  for (const o of options) s.append(el('option', { value: o.value, textContent: o.label }));
  s.value = value;
  s.addEventListener('change', () => set(s.value));
  return s;
}

/** A number box in mm (or g), stepping by `step`; empty only where `optional`. */
function number(value: number | undefined, step: number, set: (v: number | undefined) => void, opts: { min?: number; optional?: boolean; placeholder?: string } = {}): HTMLInputElement {
  const i = el('input', { type: 'number', step: String(step), value: value === undefined ? '' : String(value), placeholder: opts.placeholder ?? '' });
  if (opts.min !== undefined) i.min = String(opts.min);
  i.addEventListener('change', () => {
    if (i.value === '' && opts.optional) return set(undefined);
    const v = Number(i.value);
    if (i.value === '' || !Number.isFinite(v) || (opts.min !== undefined && v < opts.min)) {
      i.value = value === undefined ? '' : String(value);
      return;
    }
    set(v);
  });
  return i;
}

const field = (label: string, input: HTMLElement, unit = '', title = '') => el('label', { className: 'mfield', title }, el('span', {}, label), input, unit);

function section(title: string, ...kids: Node[]): HTMLElement {
  return el('section', { className: 'msection' }, el('h3', {}, title), ...kids);
}

/** A list of items with a remove button each and an add button below. */
function list<T>(items: readonly T[], row: (item: T, set: (next: T) => void) => HTMLElement[], update: (items: T[]) => void, add: () => T, addLabel: string): HTMLElement[] {
  const rows = items.map((item, i) => {
    const set = (next: T) => update(items.map((x, j) => (j === i ? next : x)));
    const remove = el('button', { className: 'small', textContent: '×', title: '外す' });
    remove.setAttribute('aria-label', '外す');
    remove.addEventListener('click', () => update(items.filter((_, j) => j !== i)));
    return el('div', { className: 'mitem' }, el('div', { className: 'mitem-head' }, el('span', { className: 'muted' }, `${i + 1}`), remove), el('div', { className: 'mgrid' }, ...row(item, set)));
  });
  const addButton = el('button', { textContent: addLabel });
  addButton.addEventListener('click', () => update([...items, add()]));
  return [...rows, addButton];
}

const opts = <T,>(items: readonly T[], value: (t: T) => string, label: (t: T) => string) => items.map((t) => ({ value: value(t), label: label(t) }));

export function renderMachineForm(root: HTMLElement, setup: MachineSetup, change: Change): void {
  const set = (patch: Partial<MachineSetup>) => change({ ...setup, ...patch });
  const chassis = byId(CHASSIS, setup.chassis);
  const mass = massOf(setup);

  const basics = section(
    '基本',
    field('シャーシ', select(setup.chassis, opts(CHASSIS, (c) => c.id, (c) => c.name), (v) => change(withChassis(setup, v)))),
    field('モーター', select(setup.motor, opts(motorsFor(setup.chassis), (m) => m.id, (m) => m.name), (v) => set({ motor: v }), chassis.shaft === 'dual' ? '両軸モーター' : '片軸モーター')),
    field('ギヤ比', select(String(setup.gearRatio), opts(GEARS, (g) => String(g.ratio), (g) => g.name), (v) => set({ gearRatio: Number(v) }))),
    field('電池', select(setup.battery, opts(BATTERIES, (b) => b.id, (b) => b.name), (v) => set({ battery: v }))),
  );

  // Front and rear alike unless asked otherwise (owner 2026-11-19).
  const split = setup.rearTyre !== undefined || setup.rearTyreKind !== undefined;
  const splitBox = el('input', { type: 'checkbox' });
  splitBox.checked = split;
  splitBox.addEventListener('change', () =>
    change(splitBox.checked ? { ...setup, rearTyre: setup.tyre, rearTyreKind: setup.tyreKind } : { ...setup, rearTyre: undefined, rearTyreKind: undefined }),
  );
  const tyreFields = (end: string, tyre: string, kind: string, setTyre: (v: string) => void, setKind: (v: string) => void) => [
    field(`${end}タイヤ`, select(tyre, opts(TYRES, (t) => t.id, (t) => t.name), setTyre)),
    field(`${end}種類`, select(kind, opts(TYRE_KINDS, (t) => t.id, (t) => t.name), setKind)),
  ];
  const tyres = section(
    'タイヤ',
    ...tyreFields(split ? '前の' : '', setup.tyre, setup.tyreKind, (v) => set({ tyre: v }), (v) => set({ tyreKind: v })),
    ...(split
      ? tyreFields('後ろの', setup.rearTyre ?? setup.tyre, setup.rearTyreKind ?? setup.tyreKind, (v) => set({ rearTyre: v }), (v) => set({ rearTyreKind: v }))
      : []),
    el('label', { className: 'mcheck' }, splitBox, '前後で変える'),
  );

  const weight = section(
    '重さ',
    el('p', { className: 'hint' }, `パーツからの目安 ${mass.estimated.toFixed(1)} g（シャーシ・電池 ${mass.base.toFixed(1)}、ローラー ${mass.rollers.toFixed(1)}、マスダンパー ${mass.dampers.toFixed(1)}、おもり ${mass.weights.toFixed(1)}）`),
    field(
      '実測',
      number(setup.measuredMass, 0.1, (v) => set({ measuredMass: v }), { min: 0.1, optional: true, placeholder: '空なら目安' }),
      'g',
      '量りで量った重さ（電池込み）。入れると目安の代わりに使います',
    ),
  );

  const presets = select(
    '',
    [{ value: '', label: 'ひな形から選ぶ…' }, ...ROLLER_PRESETS.map((p, i) => ({ value: String(i), label: p.name }))],
    (v) => v !== '' && set({ rollers: ROLLER_PRESETS[Number(v)].rollers(chassis.length) }),
  );
  const rollers = section(
    'ローラー',
    el('p', { className: 'hint' }, `ふつうは左右 1 組で、「左だけ」「右だけ」にすると片側に 1 個だけ置けます。前後はシャーシの真ん中から前が +。高さはローラーの真ん中の路面からの高さ。幅は左右のローラーの外側どうし（片側だけなら、真ん中から外側までの 2 倍。規定 ${REGULATION.width}mm まで）。`),
    presets,
    ...list(
      setup.rollers,
      (r, setR) => [
        field(
          '左右',
          select(r.side ?? 'both', [{ value: 'both', label: '左右とも' }, { value: 'left', label: '左だけ' }, { value: 'right', label: '右だけ' }], (v) => {
            const { side: _, ...rest } = r;
            setR(v === 'both' ? rest : { ...rest, side: v as 'left' | 'right' });
          }),
        ),
        field('径', select(String(r.diameter), opts([...ROLLER_SIZES].sort((a, b) => a - b), String, (d) => `${d}mm`), (v) => setR({ ...r, diameter: Number(v) }))),
        field('種類', select(r.kind, opts(ROLLER_KINDS, (k) => k.id, (k) => k.name), (v) => setR({ ...r, kind: v }))),
        field('前後', number(r.z, 0.5, (v) => setR({ ...r, z: v! })), 'mm'),
        field('高さ', number(r.y, 1.5, (v) => setR({ ...r, y: v! }), { min: 0 }), 'mm', 'スペーサー 1.5mm 刻みで上下します（数値は自由に入れられます）'),
        field('幅', number(r.width, 0.5, (v) => setR({ ...r, width: v! }), { min: 0 }), 'mm'),
      ],
      (items) => set({ rollers: items }),
      () => kitRollers(chassis.length)[0],
      '＋ ローラーを足す',
    ),
  );

  const dampers = section(
    'マスダンパー',
    el('p', { className: 'hint' }, '高さは下がりきったときのウエイトの真ん中。動く幅を 0 にすると動かない重りになります。左右は左が +。'),
    ...list(
      setup.dampers,
      (d, setD) => [
        field('ウエイト', select(d.weight, opts(DAMPER_WEIGHTS, (w) => w.id, (w) => `${w.name}（${w.mass}g）`), (v) => setD({ ...d, weight: v }))),
        field('動く幅', number(d.stroke, 0.5, (v) => setD({ ...d, stroke: v! }), { min: 0 }), 'mm'),
        field('前後', number(d.z, 1, (v) => setD({ ...d, z: v! })), 'mm'),
        field('左右', number(d.x, 1, (v) => setD({ ...d, x: v! })), 'mm'),
        field('高さ', number(d.y, 0.5, (v) => setD({ ...d, y: v! }), { min: 0 }), 'mm'),
      ],
      (items) => set({ dampers: items }),
      () => ({ weight: 'heavy', x: 0, y: 15, z: -chassis.length / 2 + 15, stroke: 3 }),
      '＋ マスダンパーを足す',
    ),
  );

  const brakes = section(
    'ブレーキ',
    el('p', { className: 'hint' }, `スポンジの下面の路面からの高さ（平らなところで）。規定の最低地上高は ${REGULATION.clearance}mm。`),
    ...list(
      setup.brakes,
      (b, setB) => [
        field('スポンジ', select(b.sponge, opts(BRAKE_SPONGES, (s) => s.id, (s) => s.name), (v) => setB({ ...b, sponge: v }))),
        field('地上高', number(b.gap, 0.5, (v) => setB({ ...b, gap: v! })), 'mm'),
        field('前後', number(b.z, 1, (v) => setB({ ...b, z: v! })), 'mm'),
        field('幅', number(b.width, 1, (v) => setB({ ...b, width: v! }), { min: 1 }), 'mm'),
        field('長さ', number(b.length, 1, (v) => setB({ ...b, length: v! }), { min: 1 }), 'mm'),
      ],
      (items) => set({ brakes: items }),
      () => ({ sponge: 'white', z: -chassis.length / 2 - 2, width: 40, length: 10, gap: 2 }),
      '＋ ブレーキを足す',
    ),
  );

  const weights = section(
    'おもり',
    ...list(
      setup.weights,
      (w, setW) => [
        field('重さ', number(w.mass, 0.1, (v) => setW({ ...w, mass: v! }), { min: 0.1 }), 'g'),
        field('前後', number(w.z, 1, (v) => setW({ ...w, z: v! })), 'mm'),
        field('左右', number(w.x, 1, (v) => setW({ ...w, x: v! })), 'mm'),
        field('高さ', number(w.y, 0.5, (v) => setW({ ...w, y: v! }), { min: 0 }), 'mm'),
      ],
      (items) => set({ weights: items }),
      () => ({ mass: 2, x: 0, y: 8, z: 0 }),
      '＋ おもりを足す',
    ),
  );

  root.replaceChildren(basics, tyres, weight, rollers, dampers, brakes, weights);
}
