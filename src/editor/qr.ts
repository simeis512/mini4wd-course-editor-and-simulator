import { makeQr, printFit, PRINT_SIZES_MM, QR_QUIET_MODULES, qrPixels, qrSvg, type Qr } from '../course/qr';
import { $, toast } from './dom';
import { QrScanner } from './qr-scan';
import { download } from './share';

// The QR code of the course URL: shown large, saved for printing (#66).

export interface QrHost {
  /** The page URL holding the latest course. */
  url(): Promise<string>;
  /** The course name, offered to write under a saved code. */
  name(): Promise<string>;
  /** Names saved files when nothing is written under the code. */
  readonly fileName: string;
}

/** Print resolution of a saved PNG. */
const PNG_DPI = 300;
/** Default print width: the second of `PRINT_SIZES_MM` (5cm). */
const DEFAULT_SIZE = PRINT_SIZES_MM[1];
/** Caption band under a saved PNG, as a share of the code's width. */
const PNG_CAPTION = 0.14;

/** Draw `qr` on `canvas`, `scale` pixels to a module, with `caption` underneath. */
function draw(canvas: HTMLCanvasElement, qr: Qr, scale: number, caption = ''): void {
  const { width, rgba } = qrPixels(qr, scale);
  const band = caption ? Math.round(width * PNG_CAPTION) : 0;
  canvas.width = width;
  canvas.height = width + band;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.putImageData(new ImageData(rgba, width, width), 0, 0);
  if (!caption) return;
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(band * 0.5)}px sans-serif`;
  ctx.fillText(caption, width / 2, width + band * 0.4, width * 0.92);
}

export function bindQr(host: QrHost): void {
  const dialog = $<HTMLDialogElement>('qr-dialog');
  const size = $<HTMLSelectElement>('qr-size');
  const caption = $<HTMLInputElement>('qr-caption');
  size.innerHTML = PRINT_SIZES_MM.map((mm) => `<option value="${mm}">${mm / 10}cm 角</option>`).join('');
  size.value = String(DEFAULT_SIZE);
  let qr: Qr | null = null;
  const scanner = new QrScanner(dialog);
  /** Saved files are named after the caption, or the course. */
  const file = (ext: string) => `${caption.value.trim() || host.fileName}-qr.${ext}`;

  /** Say how the code prints at the chosen size, warning past what reads. */
  const describe = () => {
    if (!qr) return;
    const fit = printFit(qr.size, Number(size.value));
    $('qr-fit').textContent = `1マス ${fit.moduleMm.toFixed(2)}mm`;
    const warn = $('qr-warn');
    warn.hidden = fit.readable;
    warn.textContent = `このサイズでは細かすぎて読めないことがあります。${Math.ceil(fit.minWidthMm / 10)}cm 角以上で印刷してください（保存はできます）。`;
  };
  size.addEventListener('change', describe);

  $('qr').addEventListener('click', async () => {
    const url = await host.url();
    try {
      qr = makeQr(url);
    } catch {
      qr = null;
    }
    $('qr-made').hidden = !qr;
    $('qr-too-long').hidden = !!qr;
    if (qr) {
      // Sharp on high-density screens: whole device pixels to a module.
      draw($<HTMLCanvasElement>('qr-canvas'), qr, Math.max(2, Math.ceil((360 * devicePixelRatio) / qr.size)));
      $('qr-info').textContent = `URL ${url.length} 文字・QRバージョン ${qr.version}（${qr.size}×${qr.size} マス）`;
      caption.value = await host.name();
      describe();
    }
    dialog.showModal();
  });

  $('qr-png').addEventListener('click', () => {
    if (!qr) return;
    const mm = Number(size.value);
    const pixels = (mm / 25.4) * PNG_DPI;
    const canvas = document.createElement('canvas');
    draw(canvas, qr, Math.max(1, Math.round(pixels / (qr.size + 2 * QR_QUIET_MODULES))), caption.value.trim());
    canvas.toBlob((blob) => (blob ? download(blob, file('png')) : toast('画像を作れませんでした')));
  });
  $('qr-svg').addEventListener('click', () => {
    if (!qr) return;
    const svg = qrSvg(qr, Number(size.value), caption.value.trim());
    download(new Blob([svg], { type: 'image/svg+xml' }), file('svg'));
  });
  dialog.addEventListener('close', () => scanner.stop());
}
