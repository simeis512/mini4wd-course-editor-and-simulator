import { encode } from 'uqr';
import { HASH_KEY } from './codec';

// QR codes of course URLs (#66): the code, how big it must be printed to be
// read, and taking the course out of a URL read back. Drawing: qr-card.ts.

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

/**
 * Longest course value taken from a QR code: more than any QR code holds
 * (2953 bytes at version 40-L), so longer text is not a course of ours.
 */
const MAX_COURSE_VALUE = 3000;
/** A course value as `encodeCourse` writes it: format version, dot, base64url. */
const COURSE_VALUE = /^\d{1,3}\.[A-Za-z0-9_-]+$/;

/**
 * The course value (`c` in the hash) of a URL read from a QR code, whatever
 * its host: a code made on another address (localhost, a LAN IP, the
 * published site) opens here too (#66). Only the value is taken, and only
 * when it has the shape of one; the caller still decodes and validates the
 * course before opening it. Null for anything else.
 */
export function courseValueOf(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  const value = new URLSearchParams(url.hash.replace(/^#/, '')).get(HASH_KEY);
  return value && value.length <= MAX_COURSE_VALUE && COURSE_VALUE.test(value) ? value : null;
}
