import { describe, expect, it } from 'vitest';
import { amazonLinks, amazonUrl, isAsin, officialUrl } from './store-links';
import { PRODUCTS } from './shopping';

describe('store links (#128)', () => {
  it("makes Tamiya's product page from the item number", () => {
    expect(officialUrl('94892')).toBe('https://www.tamiya.com/japan/products/94892/index.html');
  });

  it('links straight to amazon.co.jp, with the tag or without', () => {
    expect(amazonUrl('B0ABCDEFGH', 'site-22')).toBe('https://www.amazon.co.jp/dp/B0ABCDEFGH?tag=site-22');
    expect(amazonUrl('B0ABCDEFGH')).toBe('https://www.amazon.co.jp/dp/B0ABCDEFGH');
    expect(() => amazonUrl('nope')).toThrow();
  });

  it('shows no Amazon button without an ASIN or without a tracking ID', () => {
    expect(amazonLinks({ asin: 'B0ABCDEFGH' }, '')).toBeNull();
    expect(amazonLinks({}, 'site-22')).toBeNull();
    expect(amazonLinks({ asin: 'B0ABCDEFGH' }, 'site-22')).toEqual({ tagged: amazonUrl('B0ABCDEFGH', 'site-22'), plain: amazonUrl('B0ABCDEFGH') });
  });

  it('has well-formed store data for every item', () => {
    for (const p of PRODUCTS) {
      if (p.stores?.asin) expect(isAsin(p.stores.asin), p.item).toBe(true);
      if (p.stores?.tamiyaShop) expect(p.stores.tamiyaShop, p.item).toMatch(/^https:\/\//);
    }
  });
});
