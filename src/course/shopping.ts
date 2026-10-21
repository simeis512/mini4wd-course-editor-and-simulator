import { getAttachment, getPart, PARTS, variantOf } from './catalog';
import type { Course } from './course';

// What to buy to build a course (spec 7, #18): the sections it uses by
// colour, the Tamiya items that sell them, and what is left over.

/**
 * Sections as sold, where a part is more than one: the lane change centre
 * is two over-bridges (E) and the under-bridge (D, spec 3.5).
 */
const SECTIONS_OF: Record<string, [section: string, count: number][]> = {
  'lane-change-center': [
    ['over-bridge', 2],
    ['under-bridge', 1],
  ],
};

/** Names of sections that are not parts of their own. */
const SECTION_NAMES: Record<string, string> = { 'over-bridge': 'オーバーブリッジ' };

/** A Tamiya item and the sections in it, by `sectionKey` (jcjc-parts.json, products). */
export interface Product {
  item: string;
  name: string;
  contents: Record<string, number>;
  /** A basic set: only counted as owned, not suggested to buy. */
  base?: boolean;
  /** The sections it is bought for; the rest come with it. All of them when left out. */
  for?: string[];
  /** Bought only as many times as it is filled up, leaving the rest to a smaller pack after it. */
  bulk?: boolean;
}

/** Key of a section in a colour, e.g. `straight/white`; washboards have no colour. */
export const sectionKey = (section: string, color?: string): string => (color ? `${section}/${color}` : section);

/** The sections of a basic set in one colour scheme (spec 3.5): 16 pieces. */
function basicSet(straight: string, curves: [string, number][], rest: string): Record<string, number> {
  const out: Record<string, number> = { [sectionKey('straight', straight)]: 2, [sectionKey('wave', rest)]: 1 };
  for (const [color, n] of curves) out[sectionKey('curve45', color)] = n;
  for (const [section, n] of [['bridge-approach', 2], ['over-bridge', 2], ['under-bridge', 1]] as const) out[sectionKey(section, rest)] = n;
  return out;
}

const LANE_CHANGE_WHITE = ['bridge-approach', 'over-bridge', 'under-bridge'].map((s) => sectionKey(s, 'white'));

/** Items in the order they are worked through: the lane change set first, as it brings straights and a wave. */
export const PRODUCTS: readonly Product[] = [
  { item: '94892', name: 'ジャパンカップ ジュニアサーキット（レッド/ブルー/ホワイト）', contents: basicSet('white', [['red', 4], ['blue', 4]], 'white'), base: true },
  { item: '95677', name: 'ジャパンカップ ジュニアサーキット スペシャルカラー（イエロー）', contents: basicSet('black', [['yellow', 8]], 'black'), base: true },
  { item: '69506', name: 'ジャパンカップ ジュニアサーキット（グレー）', contents: basicSet('gray', [['gray', 8]], 'gray'), base: true },
  {
    item: '69579',
    name: 'レーンチェンジ拡張セット（ホワイト）',
    contents: { ...Object.fromEntries(LANE_CHANGE_WHITE.map((k, i) => [k, i === 2 ? 1 : 2])), 'straight/white': 2, 'wave/white': 1 },
    for: LANE_CHANGE_WHITE,
  },
  { item: '69578', name: 'カーブ（レッド/ブルー）各4枚セット', contents: { 'curve45/red': 4, 'curve45/blue': 4 }, bulk: true },
  { item: '69573', name: 'カーブ（レッド/ブルー）各2枚セット', contents: { 'curve45/red': 2, 'curve45/blue': 2 } },
  { item: '95491', name: 'カーブ（グリーン）4枚セット', contents: { 'curve45/green': 4 } },
  { item: '95522', name: 'カーブ（ブラック）4枚セット', contents: { 'curve45/black': 4 } },
  { item: '69574', name: 'ストレート（ホワイト）4枚セット', contents: { 'straight/white': 4 } },
  { item: '95506', name: 'ストレート（ブラック）4枚セット', contents: { 'straight/black': 4 } },
  { item: '69575', name: 'ウェーブ（ホワイト）4枚セット', contents: { 'wave/white': 4 } },
  { item: '69570', name: 'スロープセクション（レッド）', contents: { 'slope/red': 1 } },
  { item: '95447', name: 'スロープセクション（オレンジ）', contents: { 'slope/orange': 1 } },
  { item: '69571', name: 'バンクアプローチ20（レッド）', contents: { 'bank-approach-20/red': 1 } },
  { item: '95448', name: 'バンクアプローチ20（オレンジ）', contents: { 'bank-approach-20/orange': 1 } },
  { item: '95591', name: 'バンクアプローチ20（ブラック）', contents: { 'bank-approach-20/black': 1 } },
  { item: '69572', name: 'ウォッシュボードセクション 5mm・10mm 各2枚', contents: { 'washboard-5': 2, 'washboard-10': 2 } },
];

export const BASE_SETS = PRODUCTS.filter((p) => p.base);

/** A number of one section in one colour. */
export interface Line {
  key: string;
  name: string;
  count: number;
}

export interface ShoppingList {
  /** Sections the course uses, in the order they first come. */
  used: Line[];
  /** Items to buy, after what the owned sets cover. */
  buy: { product: Product; count: number }[];
  /** Sections no item on sale has, such as old grey ones. */
  missing: Line[];
  /** Sections left over from what is owned and bought. */
  spare: Line[];
  /** Home-made straights by length, shortest first: not Tamiya parts (#69). */
  custom: { length: number; count: number }[];
}

/** Name of a section key, with its colour. */
export function sectionName(key: string): string {
  const [section, color] = key.split('/');
  const base = SECTION_NAMES[section] ?? (PARTS.some((p) => p.id === section) ? getPart(section).name : getAttachment(section).name);
  const variant = color && PARTS.flatMap((p) => p.variants).find((v) => v.id === color);
  return variant ? `${base}（${variant.name}）` : base;
}

const add = <K>(map: Map<K, number>, key: K, n: number) => map.set(key, (map.get(key) ?? 0) + n);
const lines = (map: Map<string, number>): Line[] => [...map].map(([key, count]) => ({ key, name: sectionName(key), count }));

/**
 * What to buy for a course, given the sets already owned (item and how
 * many). Each item is bought as many times as the sections it is for
 * still need, taking what comes with it off the rest.
 */
export function shoppingList(course: Course, owned: readonly { item: string; count: number }[] = []): ShoppingList {
  const used = new Map<string, number>();
  const custom = new Map<number, number>();
  for (const rec of course.pieces) {
    const part = getPart(rec.part);
    if (part.lengths) {
      add(custom, rec.length ?? part.lengths.default, 1);
      continue;
    }
    const color = variantOf(part, rec.variant).id;
    for (const [section, n] of SECTIONS_OF[part.id] ?? [[part.id, 1]]) add(used, sectionKey(section, color), n);
  }
  for (const a of course.attachments ?? []) add(used, sectionKey(a.kind), 1);

  const need = new Map(used);
  const take = (product: Product, times: number) => {
    for (const [key, n] of Object.entries(product.contents)) add(need, key, -n * times);
  };
  for (const { item, count } of owned) {
    const product = PRODUCTS.find((p) => p.item === item);
    if (product) take(product, count);
  }
  const buy: ShoppingList['buy'] = [];
  for (const product of PRODUCTS) {
    if (product.base) continue;
    const keys = product.for ?? Object.keys(product.contents);
    const round = product.bulk ? Math.floor : Math.ceil;
    const count = Math.max(0, ...keys.map((k) => round(Math.max(0, need.get(k) ?? 0) / product.contents[k])));
    if (!count) continue;
    buy.push({ product, count });
    take(product, count);
  }
  const left = (sign: 1 | -1) => new Map([...need].filter(([, n]) => n * sign > 0).map(([k, n]) => [k, n * sign]));
  return {
    used: lines(used),
    buy,
    missing: lines(left(1)),
    spare: lines(left(-1)),
    custom: [...custom].sort((a, b) => a[0] - b[0]).map(([length, count]) => ({ length, count })),
  };
}
