import { makeQr, printFit, PRINT_SIZES_MM, QR_QUIET_MODULES, type Qr } from '../course/qr';
import { CARD_STYLES, cardPixels, cardSvg, qrCard, type Card, type CardStyle } from '../course/qr-card';
import { $, toast } from './dom';
import { QrScanner } from './qr-scan';
import { download } from './share';

// The QR code of the course URL: shown large, saved for printing (#66).

export interface QrHost {
  /** The page URL holding the latest course. */
  url(): Promise<string>;
  /** The course's name (its own, or the save it is or matches), offered to write under the code. */
  name(): Promise<string>;
  /** Names saved files when nothing is written under the code. */
  readonly fileName: string;
}

/** Print resolution of a saved PNG. */
const PNG_DPI = 300;
/** Default print width: the second of `PRINT_SIZES_MM` (5cm). */
const DEFAULT_SIZE = PRINT_SIZES_MM[1];
/** Remembers the chosen card style. */
const STYLE_KEY = 'qr.style';

/** Draw `card` on `canvas`, `scale` pixels to a module. */
function draw(canvas: HTMLCanvasElement, card: Card, qr: Qr, scale: number): void {
  const { width, height, rgba } = cardPixels(card, qr, scale);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const t of card.texts) {
    ctx.fillStyle = t.fill;
    ctx.font = `${t.bold ? 'bold ' : ''}${t.size * scale}px sans-serif`;
    ctx.fillText(t.text, t.x * scale, t.y * scale, card.width * scale * 0.92);
  }
}

export function bindQr(host: QrHost): void {
  const dialog = $<HTMLDialogElement>('qr-dialog');
  const size = $<HTMLSelectElement>('qr-size');
  const caption = $<HTMLInputElement>('qr-caption');
  const style = $<HTMLSelectElement>('qr-style');
  size.innerHTML = PRINT_SIZES_MM.map((mm) => `<option value="${mm}">幅 ${mm / 10}cm</option>`).join('');
  size.value = String(DEFAULT_SIZE);
  style.innerHTML = CARD_STYLES.map((s) => `<option value="${s.id}">${s.label}</option>`).join('');
  try {
    const kept = localStorage.getItem(STYLE_KEY);
    if (CARD_STYLES.some((s) => s.id === kept)) style.value = kept!;
  } catch {
    // Storage blocked: start from the first style.
  }
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
    warn.textContent = `このサイズでは細かすぎて読めないことがあります。幅 ${Math.ceil(fit.minWidthMm / 10)}cm 以上で印刷してください（保存はできます）。`;
  };
  size.addEventListener('change', describe);

  /** The card as it would be saved now. */
  const card = () => qrCard(qr!, style.value as CardStyle, caption.value.trim());
  /** Redraw the card on screen: sharp on high-density screens, whole device pixels to a module. */
  const preview = () => {
    if (qr) draw($<HTMLCanvasElement>('qr-canvas'), card(), qr, Math.max(2, Math.ceil((360 * devicePixelRatio) / qr.size)));
  };
  style.addEventListener('change', () => {
    try {
      localStorage.setItem(STYLE_KEY, style.value);
    } catch {
      // Storage blocked: the choice lasts until the page is closed.
    }
    preview();
  });
  caption.addEventListener('input', preview);

  /** Show the make or read tab; leaving the read tab stops the camera. */
  const showTab = (read: boolean) => {
    $('qr-tab-make').setAttribute('aria-selected', String(!read));
    $('qr-tab-read').setAttribute('aria-selected', String(read));
    $('qr-make').hidden = read;
    $('qr-read').hidden = !read;
    if (!read) scanner.stop();
  };
  $('qr-tab-make').addEventListener('click', () => showTab(false));
  $('qr-tab-read').addEventListener('click', () => showTab(true));

  $('qr').addEventListener('click', async () => {
    showTab(false);
    const url = await host.url();
    try {
      qr = makeQr(url);
    } catch {
      qr = null;
    }
    $('qr-made').hidden = !qr;
    $('qr-too-long').hidden = !!qr;
    if (qr) {
      $('qr-info').textContent = `URL ${url.length} 文字・QRバージョン ${qr.version}（${qr.size}×${qr.size} マス）`;
      caption.value = await host.name();
      preview();
      describe();
    }
    dialog.showModal();
  });

  $('qr-png').addEventListener('click', () => {
    if (!qr) return;
    const mm = Number(size.value);
    const pixels = (mm / 25.4) * PNG_DPI;
    const canvas = document.createElement('canvas');
    draw(canvas, card(), qr, Math.max(1, Math.round(pixels / (qr.size + 2 * QR_QUIET_MODULES))));
    canvas.toBlob((blob) => (blob ? download(blob, file('png')) : toast('画像を作れませんでした')));
  });
  $('qr-svg').addEventListener('click', () => {
    if (!qr) return;
    const svg = cardSvg(card(), qr, Number(size.value));
    download(new Blob([svg], { type: 'image/svg+xml' }), file('svg'));
  });
  dialog.addEventListener('close', () => scanner.stop());
}
