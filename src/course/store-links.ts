// Where to buy the items in the shopping list (#128, owner 2026-10-30): the
// item's page on Tamiya's site, Tamiya's own shop, and Amazon, where an
// associate link is offered next to a plain one and the user picks.
//
// Amazon's rules (#128): links are real <a> the user clicks, straight to
// amazon.co.jp (no redirects, no window.open), say "Amazon" on them, show
// no prices, and the disclosure below stands near them.

/** Where an item is sold besides Tamiya's product page; each left out where it is not. */
export interface ProductStores {
  /** Amazon's id of the item (10 letters and digits). */
  asin?: string;
  /** Amazon sells it only above list price, or only through other sellers: said next to the button (owner). */
  amazonNote?: boolean;
  /** The item's page in Tamiya's shop. */
  tamiyaShop?: string;
}

/**
 * This site's Amazon associate tracking ID. Empty until the site is public
 * (#21) and added to the owner's existing associate account; while empty,
 * no Amazon button shows (owner, 2026-10-30).
 */
export const AMAZON_TRACKING_ID = '';

/** The required disclosure, with the site's name (owner, 2026-10-30). */
export const AMAZON_DISCLOSURE = 'Amazonのアソシエイトとして、Mini4WD Labは適格販売により収入を得ています。';
export const AMAZON_COOKIE_NOTE = 'Amazon のページを開くと、Amazon の Cookie が使われます。';
export const AMAZON_PRICE_NOTE = '定価より高い出品しかないことがあります';

export const isAsin = (s: string): boolean => /^[A-Z0-9]{10}$/.test(s);

/** The item's page on Tamiya's site. */
export function officialUrl(item: string): string {
  return `https://www.tamiya.com/japan/products/${encodeURIComponent(item)}/index.html`;
}

/** The item's page on amazon.co.jp, with the associate tag or without. */
export function amazonUrl(asin: string, tag = ''): string {
  if (!isAsin(asin)) throw new Error(`not an ASIN: ${asin}`);
  return `https://www.amazon.co.jp/dp/${asin}${tag ? `?tag=${encodeURIComponent(tag)}` : ''}`;
}

/** Both Amazon links to offer for an item, or null when no button shows (no ASIN, or no tracking ID yet). */
export function amazonLinks(stores: ProductStores | undefined, tag = AMAZON_TRACKING_ID): { tagged: string; plain: string } | null {
  if (!tag || !stores?.asin) return null;
  return { tagged: amazonUrl(stores.asin, tag), plain: amazonUrl(stores.asin) };
}

/** How the user wants Amazon opened: asked each time, or always one way (kept in this browser). */
export type AmazonChoice = 'ask' | 'tag' | 'plain';
export const AMAZON_CHOICES: Record<AmazonChoice, string> = { ask: '毎回聞く', tag: 'アソシエイトリンクで開く', plain: 'アソシエイトなしで開く' };
