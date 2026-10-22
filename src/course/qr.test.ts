import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { courseToHash, decodeCourse } from './codec';
import { basicOval } from './presets';
import { cardPixels, qrCard } from './qr-card';
import { courseValueOf, makeQr, MIN_PRINT_MODULE_MM, printFit, QR_QUIET_MODULES } from './qr';

describe('makeQr', () => {
  it('encodes a course URL so it reads back the same', async () => {
    const url = `https://mini4wd-lab.simeis512.com/${await courseToHash(basicOval())}`;
    const qr = makeQr(url);
    expect(qr.size).toBe(17 + 4 * qr.version);
    const { width, height, rgba } = cardPixels(qrCard(qr, 'plain'), qr, 4);
    expect(jsQR(rgba, width, height)?.data).toBe(url);
  });

  it('keeps the basic oval small', async () => {
    const url = `https://mini4wd-lab.simeis512.com/${await courseToHash(basicOval())}`;
    expect(makeQr(url).version).toBeLessThanOrEqual(6);
  });

  it('throws when the text is too long for any QR code', () => {
    expect(() => makeQr('x'.repeat(4000))).toThrow();
  });
});

describe('printFit', () => {
  it('counts the quiet zone in the module size', () => {
    const fit = printFit(21, 29 * MIN_PRINT_MODULE_MM);
    expect(fit.moduleMm).toBeCloseTo(MIN_PRINT_MODULE_MM);
    expect(fit.readable).toBe(true);
    expect(fit.minWidthMm).toBeCloseTo((21 + 2 * QR_QUIET_MODULES) * MIN_PRINT_MODULE_MM);
  });

  it('is not readable when printed too small', () => {
    expect(printFit(101, 30).readable).toBe(false);
  });
});

describe('courseValueOf', () => {
  it('takes the course out of a URL on any host', () => {
    expect(courseValueOf('https://localhost:5173/#c=5.abc')).toBe('5.abc');
    expect(courseValueOf(' https://192.168.0.10:5173/#c=5.a-b_c\n')).toBe('5.a-b_c');
    expect(courseValueOf('https://mini4wd-lab.simeis512.com/?x=1#c=5.abc&z=2')).toBe('5.abc');
  });

  it('refuses URLs without a course, and plain text', () => {
    expect(courseValueOf('https://localhost:5173/')).toBeNull();
    expect(courseValueOf('https://example.com/#x=5.abc')).toBeNull();
    expect(courseValueOf('こんにちは')).toBeNull();
  });

  it('refuses values that are not shaped like a course', () => {
    expect(courseValueOf('https://example.com/#c=<script>')).toBeNull();
    expect(courseValueOf('https://example.com/#c=5.ab%22c')).toBeNull();
    expect(courseValueOf('https://example.com/#c=abc')).toBeNull();
    expect(courseValueOf(`https://example.com/#c=5.${'a'.repeat(3000)}`)).toBeNull();
  });

  it('gives a value that decodes back to the course', async () => {
    const value = courseValueOf(`https://192.168.0.10:5173/${await courseToHash(basicOval())}`);
    expect((await decodeCourse(value!)).pieces).toHaveLength(basicOval().pieces.length);
  });
});
