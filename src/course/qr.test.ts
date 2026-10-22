import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { courseToHash } from './codec';
import { basicOval } from './presets';
import { courseHashOf, makeQr, MIN_PRINT_MODULE_MM, printFit, qrPixels, qrSvg, QR_QUIET_MODULES } from './qr';

const HERE = 'https://localhost:5173/';

describe('makeQr', () => {
  it('encodes a course URL so it reads back the same', async () => {
    const url = `https://mini4wd-lab.simeis512.com/${await courseToHash(basicOval())}`;
    const qr = makeQr(url);
    expect(qr.size).toBe(17 + 4 * qr.version);
    const { width, rgba } = qrPixels(qr, 4);
    expect(jsQR(rgba, width, width)?.data).toBe(url);
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

describe('qrSvg', () => {
  const qr = makeQr('https://example.com/');

  it('is as wide as asked, in mm', () => {
    expect(qrSvg(qr, 50)).toContain('width="50mm" height="50mm"');
  });

  it('adds the caption underneath, escaped', () => {
    const svg = qrSvg(qr, 50, 'A&B <コース>');
    expect(svg).toContain('A&#38;B &#60;コース&#62;</text>');
    expect(svg).not.toContain('height="50mm"');
  });
});

describe('courseHashOf', () => {
  it('takes a course URL of this host or the published app', () => {
    expect(courseHashOf('https://localhost:5173/#c=5.abc', HERE)).toBe('#c=5.abc');
    expect(courseHashOf(' https://mini4wd-lab.simeis512.com/#c=5.abc\n', HERE)).toBe('#c=5.abc');
  });

  it('refuses other sites, URLs without a course, and plain text', () => {
    expect(courseHashOf('https://example.com/#c=5.abc', HERE)).toBeNull();
    expect(courseHashOf('https://localhost:5173/', HERE)).toBeNull();
    expect(courseHashOf('こんにちは', HERE)).toBeNull();
  });
});
