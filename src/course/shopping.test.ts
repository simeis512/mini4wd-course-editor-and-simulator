import { describe, expect, it } from 'vitest';
import { addAttachment } from './attachments';
import { emptyCourse } from './course';
import { addPiece, setLength, setVariant } from './edit';
import { basicOval, chain } from './presets';
import { sectionName, shoppingList, type ShoppingList } from './shopping';

const counts = (lines: ShoppingList['used']) => Object.fromEntries(lines.map((l) => [l.key, l.count]));
const bought = (list: ShoppingList) => Object.fromEntries(list.buy.map((b) => [b.product.item, b.count]));

describe('shoppingList (#18)', () => {
  it('counts sections by colour, the lane change centre as its bridges and under-bridge', () => {
    expect(counts(shoppingList(basicOval()).used)).toEqual({
      'straight/white': 2,
      'wave/white': 1,
      'curve45/red': 8,
      'bridge-approach/white': 2,
      'over-bridge/white': 2,
      'under-bridge/white': 1,
    });
  });

  it('buys the lane change set and counts the straights and wave that come with it', () => {
    const list = shoppingList(basicOval());
    // 8 red curves: two packs of four of each colour, leaving 8 blue ones.
    expect(bought(list)).toEqual({ '69579': 1, '69578': 2 });
    expect(counts(list.spare)).toEqual({ 'curve45/blue': 8 });
    expect(list.missing).toEqual([]);
  });

  it('fills up big packs first and buys the rest in small ones', () => {
    let c = chain(['curve45', 'curve45', 'curve45', 'curve45', 'curve45', 'curve45']);
    c = setVariant(c, 5, 1);
    // 5 red and 1 blue: one pack of four each, then one of two each.
    const list = shoppingList(c);
    expect(bought(list)).toEqual({ '69578': 1, '69573': 1 });
    expect(counts(list.spare)).toEqual({ 'curve45/red': 1, 'curve45/blue': 5 });
  });

  it('takes an owned basic set off first', () => {
    const list = shoppingList(basicOval(), [{ item: '94892', count: 1 }]);
    // The set's 4 red curves fall 4 short; its 4 blue ones are left over.
    expect(bought(list)).toEqual({ '69578': 1 });
    expect(counts(list.spare)).toEqual({ 'curve45/blue': 8 });
  });

  it('lists what no item on sale has', () => {
    const c = setVariant(chain(['straight', 'straight']), 0, 1);
    const list = shoppingList(c);
    expect(counts(list.missing)).toEqual({ 'straight/gray': 1 });
    expect(sectionName('straight/gray')).toBe('ストレート（グレー（旧））');
    expect(bought(shoppingList(c, [{ item: '69506', count: 1 }]))).toEqual({ '69574': 1 });
  });

  it('buys washboards in their pack', () => {
    let c = chain(['straight']);
    for (const kind of ['washboard-10', 'washboard-10', 'washboard-10', 'washboard-5']) c = addAttachment(c, kind, 0);
    const list = shoppingList(c);
    expect(bought(list)['69572']).toBe(2);
    expect(counts(list.spare)).toMatchObject({ 'washboard-5': 3, 'washboard-10': 1 });
  });

  it('lists home-made straights apart, by length (#69)', () => {
    let c = addPiece(emptyCourse(), 'free-straight', null);
    c = addPiece(c, 'free-straight', { piece: 0, port: 1 });
    c = addPiece(c, 'free-straight', { piece: 1, port: 1 });
    c = setLength(setLength(c, 0, 100), 2, 100);
    const list = shoppingList(c);
    expect(list.custom).toEqual([
      { length: 100, count: 2 },
      { length: 270, count: 1 },
    ]);
    expect(list.used).toEqual([]);
    expect(list.buy).toEqual([]);
  });
});
