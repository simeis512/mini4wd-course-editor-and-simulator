import type { Course } from '../course/course';
import { BASE_SETS, PRODUCTS, shoppingList, type Line, type Product } from '../course/shopping';
import { $ } from './dom';
import { AMAZON_DISCLOSURE, AMAZON_PRICE_NOTE, amazonLinks, officialUrl } from '../course/store-links';
import { amazonChoice, askAmazon } from './amazon-link';

// The shopping list in the course box (spec 7, #18).

/** The basic set the user has, and how many; kept in this browser only. */
interface Owned {
  item: string;
  count: number;
}

const STORE_KEY = 'shopping.owned';
const MAX_SETS = 9;

function loadOwned(): Owned {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Owned | null;
    if (data && BASE_SETS.some((p) => p.item === data.item)) return { item: data.item, count: Math.min(MAX_SETS, Math.max(1, data.count | 0)) };
  } catch {
    // Storage off or broken: start with no set.
  }
  return { item: '', count: 1 };
}

let owned = loadOwned();

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const rows = (lines: readonly Line[]) => lines.map((l) => `<tr><td>${escape(l.name)}</td><td class="num">${l.count}</td></tr>`).join('');

const products = new Map(PRODUCTS.map((p) => [p.item, p]));

/** Buttons to Tamiya's shop and Amazon for an item, where it is sold there. */
function storeLinks(item: string, stores: Product['stores']): string {
  const out: string[] = [];
  if (stores?.tamiyaShop) out.push(`<a class="store" href="${escape(stores.tamiyaShop)}" target="_blank" rel="noopener">タミヤショップ</a>`);
  const amazon = amazonLinks(stores);
  if (amazon) {
    const choice = amazonChoice();
    out.push(
      choice === 'ask'
        ? `<button class="store" data-amazon="${item}">Amazon で見る</button>`
        : `<a class="store amazon" href="${choice === 'tag' ? amazon.tagged : amazon.plain}" target="_blank" rel="noopener">Amazon で見る</a>`,
    );
    if (stores?.amazonNote) out.push(`<span class="muted">${AMAZON_PRICE_NOTE}</span>`);
  }
  return out.join('');
}

/** The shopping list for a course, as HTML for the course box. */
export function shoppingHtml(course: Course): string[] {
  const list = shoppingList(course, owned.item ? [owned] : []);
  if (!list.used.length && !list.custom.length) return [];
  const sets = BASE_SETS.map((p) => `<option value="${p.item}"${p.item === owned.item ? ' selected' : ''}>${p.item} ${escape(p.name)}</option>`);
  const out = [
    '<h3>購入リスト</h3>',
    `<div class="row owned"><select id="owned-set" title="持っている基本セットの分を差し引きます"><option value="">基本セットなしで数える</option>${sets.join('')}</select>
      ${owned.item ? `× <input id="owned-count" type="number" min="1" max="${MAX_SETS}" value="${owned.count}" />` : ''}</div>`,
  ];
  if (list.used.length) out.push(`<table class="laps"><tr><th>使うパーツ</th><th>数</th></tr>${rows(list.used)}</table>`);
  if (list.buy.length) {
    let amazon = false;
    const buy = list.buy.map((b) => {
      const p = b.product;
      const links = storeLinks(p.item, p.stores);
      if (links.includes('amazon')) amazon = true;
      const name = `<a href="${officialUrl(p.item)}" target="_blank" rel="noopener" title="タミヤの商品ページ">${escape(p.name)}</a>`;
      return `<tr><td>${p.item}</td><td>${name}${links ? `<div class="stores">${links}</div>` : ''}</td><td class="num">${b.count}</td></tr>`;
    });
    out.push(`<table class="laps"><tr><th>品番</th><th>買うもの</th><th>数</th></tr>${buy.join('')}</table>`);
    // The disclosure stays by the links even when the box is no longer asked (owner, 2026-10-30).
    if (amazon) out.push(`<div class="muted">${escape(AMAZON_DISCLOSURE)}</div>`);
  } else if (list.used.length) {
    out.push('<div class="ok">買い足すものはありません</div>');
  }
  if (list.missing.length) {
    out.push('<div class="warn">今の単品の商品では手に入らないパーツ（基本セットなどに入っていた色）</div>', `<table class="laps">${rows(list.missing)}</table>`);
  }
  if (list.spare.length) out.push(`<details><summary>余るパーツ</summary><table class="laps">${rows(list.spare)}</table></details>`);
  if (list.custom.length) {
    const custom = list.custom.map((c) => `<tr><td>${c.length}mm</td><td class="num">${c.count}</td></tr>`);
    out.push(`<table class="laps"><tr><th>自作ストレート</th><th>数</th></tr>${custom.join('')}</table>`);
  }
  out.push('<div class="muted">セットの中身はタミヤの商品説明から。価格は考えていません</div>');
  return out;
}

/** Answer changes to the owned set; `changed` redraws the course box. */
export function bindShopping(changed: () => void): void {
  $('info').addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('[data-amazon]')?.dataset.amazon;
    const links = item && amazonLinks(products.get(item)?.stores);
    if (links) askAmazon(links);
  });
  $('info').addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t.id === 'owned-set') owned = { item: (t as HTMLSelectElement).value, count: owned.count };
    else if (t.id === 'owned-count') owned = { ...owned, count: Math.min(MAX_SETS, Math.max(1, Number((t as HTMLInputElement).value) | 0)) };
    else return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(owned));
    } catch {
      // Not kept between visits then.
    }
    changed();
  });
}
