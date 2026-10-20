import { $ } from './dom';

/** How the top view shows heights (spec 8). */
export interface HeightView {
  /** Colour the road by its height instead of the pieces' colours. */
  colors: boolean;
  /** Show only pieces that reach this height, mm; 0 shows everything. */
  level: number;
}

/** Colours from the floor (0) to the highest road (1). */
const STOPS = ['#3b82f6', '#22c55e', '#eab308', '#ef4444'];
/** Heights are coloured over at least this range, mm, so a small rise does not look like a tall one. */
const MIN_COLOR_RANGE = 100;
/** Steps of the level filter, mm. */
const LEVEL_STEP = 10;

function mix(a: string, b: string, t: number): string {
  const ca = parseInt(a.slice(1), 16);
  const cb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((ca >> shift) & 255) * (1 - t) + ((cb >> shift) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

/** Highest setting of the level filter for a course whose highest road is `top` mm. */
export function levelMax(top: number): number {
  return Math.ceil(top / LEVEL_STEP) * LEVEL_STEP;
}

/** Top of the colour scale for a course whose highest road is `top` mm. */
export function colorRange(top: number): number {
  return Math.max(MIN_COLOR_RANGE, levelMax(top));
}

/** Colour of road `height` mm up, on a scale up to `range` mm. */
export function heightColor(height: number, range: number): string {
  const t = Math.min(1, Math.max(0, height / range)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(t));
  return mix(STOPS[i], STOPS[i + 1], t - i);
}

/** Wire the height tools of the top view: `onChange` gets the new settings. */
export function bindLevelTools(onChange: (view: HeightView) => void): void {
  const read = () => onChange({ colors: $<HTMLInputElement>('height-colors').checked, level: Number($<HTMLInputElement>('level').value) });
  $('height-colors').addEventListener('change', read);
  $('level').addEventListener('input', read);
  $('height-legend').style.background = `linear-gradient(to right, ${STOPS.join(', ')})`;
}

/** Bring the height tools up to date for a course whose highest road is `top` mm. */
export function renderLevelTools(top: number, view: HeightView): void {
  const slider = $<HTMLInputElement>('level');
  const max = levelMax(top);
  slider.max = String(max);
  slider.step = String(LEVEL_STEP);
  slider.disabled = max === 0;
  slider.value = String(view.level);
  $('level-value').textContent = view.level > 0 ? `${view.level}mm 以上` : 'すべて';
  $('height-scale').hidden = !view.colors;
  $('legend-top').textContent = `${colorRange(top)}mm`;
}
