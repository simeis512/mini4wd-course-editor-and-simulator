import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { courseToHash } from './codec';
import { basicOval } from './presets';
import { makeQr, QR_QUIET_MODULES } from './qr';
import { CARD_HEADING, CARD_STYLES, cardPixels, cardSvg, qrCard } from './qr-card';

const url = async () => `https://mini4wd-lab.simeis512.com/${await courseToHash(basicOval())}`;

describe('qrCard', () => {
  it.each(CARD_STYLES.map((s) => s.id))('still reads as the URL in the %s style', async (style) => {
    const text = await url();
    const qr = makeQr(text);
    const { width, height, rgba } = cardPixels(qrCard(qr, style, 'コース'), qr, 4);
    expect(jsQR(rgba, width, height)?.data).toBe(text);
  });

  it.each(CARD_STYLES.map((s) => s.id))('keeps bands and texts off the code and its quiet zone in the %s style', async (style) => {
    const qr = makeQr(await url());
    const card = qrCard(qr, style, 'コース');
    const side = qr.size + 2 * QR_QUIET_MODULES;
    const eps = 1e-9;
    const overlaps = (y0: number, y1: number) => y0 < card.qrY + side - eps && y1 > card.qrY + eps;
    for (const r of card.rects) expect(overlaps(r.y, r.y + r.h)).toBe(false);
    for (const t of card.texts) expect(overlaps(t.y - t.size / 2, t.y + t.size / 2)).toBe(false);
  });

  it('says what the code is for, except in the plain style', async () => {
    const qr = makeQr(await url());
    expect(qrCard(qr, 'checker').texts.map((t) => t.text)).toEqual([CARD_HEADING]);
    expect(qrCard(qr, 'tricolor').texts.map((t) => t.text)).toEqual([CARD_HEADING]);
    expect(qrCard(qr, 'plain').texts).toEqual([]);
  });

  it('is just the code and its quiet zone in the plain style without a caption', () => {
    const qr = makeQr('https://example.com/');
    const card = qrCard(qr, 'plain');
    const side = qr.size + 2 * QR_QUIET_MODULES;
    expect([card.width, card.height, card.qrY, card.rects.length]).toEqual([side, side, 0, 0]);
  });

  it('grows by the caption band when given one', () => {
    const qr = makeQr('https://example.com/');
    expect(qrCard(qr, 'checker', 'A').height).toBeGreaterThan(qrCard(qr, 'checker').height);
  });
});

describe('cardSvg', () => {
  const qr = makeQr('https://example.com/');

  it('is as wide as asked, in mm', () => {
    expect(cardSvg(qrCard(qr, 'plain'), qr, 50)).toContain('width="50mm" height="50mm"');
  });

  it('writes the heading and the caption, escaped', () => {
    const svg = cardSvg(qrCard(qr, 'tricolor', 'A&B <コース>'), qr, 50);
    expect(svg).toContain(`>${CARD_HEADING}</text>`);
    expect(svg).toContain('A&#38;B &#60;コース&#62;</text>');
  });
});
