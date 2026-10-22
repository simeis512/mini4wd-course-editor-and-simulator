import { encode } from 'uqr';
import { HASH_KEY } from './codec';

// QR codes of course URLs (#66): the code, how big it must be printed to be
// read, drawing it, and telling a course URL from any other text read back.

/** The light margin round a QR code, in modules (the standard asks for 4). */
export const QR_QUIET_MODULES = 4;

/**
 * The smallest printed module a phone camera reads reliably, in mm.
 * provisional: general printing guidance for phone scanning puts it at
 * 0.4–0.5mm (#66 決定事項: warn past what can be read when printed); to be
 * checked by printing test codes.
 */
export const MIN_PRINT_MODULE_MM = 0.5;

/** Print widths offered for saving, in mm (#66). provisional: business card to poster corner. */
export const PRINT_SIZES_MM = [30, 50, 80, 120] as const;

/** Hosts whose course URLs are opened when read: the published app (#21). */
export const APP_HOSTS = ['mini4wd-lab.simeis512.com'];

export interface Qr {
  /** QR version, 1–40: the code is 17 + 4 × version modules wide. */
  version: number;
  /** Modules along a side, not counting the quiet zone. */
  size: number;
  /** Dark modules, by row then column. */
  dark: boolean[][];
}

/**
 * The QR code of `text`, as small as it fits, with as much error correction
 * as that size allows. Throws when the text is too long for any QR code.
 */
export function makeQr(text: string): Qr {
  const qr = encode(text, { ecc: 'L', boostEcc: true, border: 0 });
  return { version: qr.version, size: qr.size, dark: qr.data };
}

export interface PrintFit {
  /** One module at this print width, in mm. */
  moduleMm: number;
  /** The narrowest print width that reads reliably, in mm. */
  minWidthMm: number;
  readable: boolean;
}

/** How a code of `size` modules prints at `widthMm` wide, quiet zone included. */
export function printFit(size: number, widthMm: number): PrintFit {
  const modules = size + 2 * QR_QUIET_MODULES;
  const moduleMm = widthMm / modules;
  return { moduleMm, minWidthMm: modules * MIN_PRINT_MODULE_MM, readable: moduleMm >= MIN_PRINT_MODULE_MM };
}

/** The code as RGBA pixels, `scale` pixels to a module, quiet zone included. */
export function qrPixels(qr: Qr, scale: number): { width: number; rgba: Uint8ClampedArray<ArrayBuffer> } {
  const width = (qr.size + 2 * QR_QUIET_MODULES) * scale;
  const rgba = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let y = 0; y < width; y++) {
    const row = qr.dark[Math.floor(y / scale) - QR_QUIET_MODULES];
    for (let x = 0; x < width; x++) {
      if (!row?.[Math.floor(x / scale) - QR_QUIET_MODULES]) continue;
      const i = (y * width + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
    }
  }
  return { width, rgba };
}

const escapeXml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Caption height under the code, in modules. */
const CAPTION_MODULES = 6;

/**
 * The code as an SVG `widthMm` wide, quiet zone included, with `caption`
 * (the course name) written underneath when given.
 */
export function qrSvg(qr: Qr, widthMm: number, caption = ''): string {
  const side = qr.size + 2 * QR_QUIET_MODULES;
  const height = caption ? side + CAPTION_MODULES : side;
  // One path of horizontal runs keeps the file small.
  let path = '';
  qr.dark.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      const start = x;
      while (row[x + 1]) x++;
      path += `M${start + QR_QUIET_MODULES} ${y + QR_QUIET_MODULES}h${x - start + 1}v1h${start - x - 1}z`;
    }
  });
  const text = caption
    ? `<text x="${side / 2}" y="${side + CAPTION_MODULES / 2 - 1}" font-size="${CAPTION_MODULES / 2}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">${escapeXml(caption)}</text>`
    : '';
  const heightMm = (widthMm * height) / side;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${+heightMm.toFixed(2)}mm" viewBox="0 0 ${side} ${height}" shape-rendering="crispEdges">` +
    `<rect width="${side}" height="${height}" fill="#fff"/><path d="${path}" fill="#000"/>${text}</svg>`
  );
}

/**
 * The hash to open when `text` read from a QR code is a course URL of this
 * app: one on `here`'s host or a published host, with a course in its hash.
 * Null for anything else, which is not opened.
 */
export function courseHashOf(text: string, here: string): string | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.host !== new URL(here).host && !APP_HOSTS.includes(url.host)) return null;
  return new URLSearchParams(url.hash.replace(/^#/, '')).get(HASH_KEY) ? url.hash : null;
}
