import { QR_QUIET_MODULES, type Qr } from './qr';

// The card a course QR code is shown and saved on (#66): a heading that says
// what the code is for, bands patterned after a chequered flag or a
// tricolour, and the caption. The code and its quiet zone stay plain black
// on white so it reads as well as a bare code; everything else is outside.
// Lengths are in modules of the code.

export type CardStyle = 'checker' | 'tricolor' | 'plain';

/** Styles offered, in order, with their names on screen. */
export const CARD_STYLES: readonly { id: CardStyle; label: string }[] = [
  { id: 'checker', label: 'チェッカーフラッグ' },
  { id: 'tricolor', label: 'トリコロール' },
  { id: 'plain', label: 'シンプル（QRコードだけ）' },
];

/** What the heading says, so the code is known for a course before it is read. */
export const CARD_HEADING = 'ミニ四駆コース';

const INK = '#111111';
const BLUE = '#1d4fa8';
const RED = '#d0202e';

export interface CardRect {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}

export interface CardText {
  /** Centre of the text. */
  x: number;
  y: number;
  size: number;
  text: string;
  fill: string;
  bold: boolean;
}

export interface Card {
  width: number;
  height: number;
  /** Top left of the quiet zone round the code. */
  qrX: number;
  qrY: number;
  /** Drawn in order over a white card. */
  rects: CardRect[];
  /** Drawn last; never over the code. */
  texts: CardText[];
}

/** Heading band height and its text size. */
const HEADING = 6;
const HEADING_TEXT = 3.4;
/** Caption band height and its text size. */
const CAPTION = 5;
const CAPTION_TEXT = 2.8;
/** Squares of the chequered bands are about this wide. */
const CHECKER_SQUARE = 2.5;
/** Thin stripes of the tricolour. */
const STRIPE = 1.2;

/** A band of black and white squares `rows` high across `width`, from `y`. */
function checkerBand(width: number, y: number, rows: number): { rects: CardRect[]; height: number } {
  const n = Math.max(2, Math.round(width / CHECKER_SQUARE));
  const c = width / n;
  const rects: CardRect[] = [];
  for (let row = 0; row < rows; row++) {
    for (let i = (row % 2); i < n; i += 2) rects.push({ x: i * c, y: y + row * c, w: c, h: c, fill: INK });
  }
  return { rects, height: rows * c };
}

/** Lay out the card of `qr` in `style`, with `caption` (the course name) under the code when given. */
export function qrCard(qr: Qr, style: CardStyle, caption = ''): Card {
  const side = qr.size + 2 * QR_QUIET_MODULES;
  const rects: CardRect[] = [];
  const texts: CardText[] = [];
  const heading = (y: number, fill: string) =>
    texts.push({ x: side / 2, y: y + HEADING / 2, size: HEADING_TEXT, text: CARD_HEADING, fill, bold: true });
  let y = 0;
  if (style === 'checker') {
    const band = checkerBand(side, y, 2);
    rects.push(...band.rects);
    y += band.height;
    heading(y, INK);
    y += HEADING;
  } else if (style === 'tricolor') {
    rects.push({ x: 0, y, w: side, h: HEADING, fill: BLUE });
    heading(y, '#ffffff');
    y += HEADING;
    rects.push({ x: 0, y: y + STRIPE / 2, w: side, h: STRIPE, fill: RED });
    y += STRIPE * 1.5;
  }
  const qrY = y;
  y += side;
  if (caption) {
    texts.push({ x: side / 2, y: y + CAPTION / 2 - 0.5, size: CAPTION_TEXT, text: caption, fill: INK, bold: false });
    y += CAPTION;
  }
  if (style === 'checker') {
    const band = checkerBand(side, y, 1);
    rects.push(...band.rects);
    y += band.height;
  } else if (style === 'tricolor') {
    rects.push({ x: 0, y, w: side, h: STRIPE, fill: BLUE }, { x: 0, y: y + STRIPE * 1.6, w: side, h: STRIPE, fill: RED });
    y += STRIPE * 2.6;
  }
  return { width: side, height: y, qrX: 0, qrY, rects, texts };
}

const hex = (fill: string) => [1, 3, 5].map((i) => parseInt(fill.slice(i, i + 2), 16));

/**
 * The card as RGBA pixels, `scale` pixels to a module, without its texts
 * (a canvas writes those). Bands are rounded to whole pixels.
 */
export function cardPixels(card: Card, qr: Qr, scale: number): { width: number; height: number; rgba: Uint8ClampedArray<ArrayBuffer> } {
  const width = Math.round(card.width * scale);
  const height = Math.round(card.height * scale);
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  const fill = (x0: number, y0: number, x1: number, y1: number, [r, g, b]: number[]) => {
    for (let y = Math.max(0, y0); y < Math.min(height, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) {
        const i = (y * width + x) * 4;
        rgba[i] = r;
        rgba[i + 1] = g;
        rgba[i + 2] = b;
      }
    }
  };
  const px = (v: number) => Math.round(v * scale);
  for (const r of card.rects) fill(px(r.x), px(r.y), px(r.x + r.w), px(r.y + r.h), hex(r.fill));
  const ox = px(card.qrX + QR_QUIET_MODULES);
  const oy = px(card.qrY + QR_QUIET_MODULES);
  qr.dark.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) fill(ox + x * scale, oy + y * scale, ox + (x + 1) * scale, oy + (y + 1) * scale, [0, 0, 0]);
    }),
  );
  return { width, height, rgba };
}

const escapeXml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const num = (v: number) => +v.toFixed(3);

/** The card as an SVG `widthMm` wide. */
export function cardSvg(card: Card, qr: Qr, widthMm: number): string {
  // One path of horizontal runs keeps the file small.
  let path = '';
  const ox = card.qrX + QR_QUIET_MODULES;
  const oy = card.qrY + QR_QUIET_MODULES;
  qr.dark.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      const start = x;
      while (row[x + 1]) x++;
      path += `M${ox + start} ${oy + y}h${x - start + 1}v1h${start - x - 1}z`;
    }
  });
  const rects = card.rects
    .map((r) => `<rect x="${num(r.x)}" y="${num(r.y)}" width="${num(r.w)}" height="${num(r.h)}" fill="${r.fill}"/>`)
    .join('');
  const texts = card.texts
    .map(
      (t) =>
        `<text x="${num(t.x)}" y="${num(t.y)}" font-size="${t.size}"${t.bold ? ' font-weight="bold"' : ''} fill="${t.fill}" text-anchor="middle" dominant-baseline="central" font-family="sans-serif">${escapeXml(t.text)}</text>`,
    )
    .join('');
  const heightMm = (widthMm * card.height) / card.width;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${num(heightMm)}mm" viewBox="0 0 ${num(card.width)} ${num(card.height)}">` +
    `<rect width="100%" height="100%" fill="#fff"/>${rects}<path d="${path}" fill="#000" shape-rendering="crispEdges"/>${texts}</svg>`
  );
}
