import type { Layout } from '../course/course';
import type { LapCheck } from '../course/laps';
import { makeQr, QR_QUIET_MODULES } from '../course/qr';
import { cardPixels, qrCard } from '../course/qr-card';
import { courseExtent, frameIn, SHARE_ASPECTS, shareFacts, shareLayout, type Rect, type ShareAspect } from '../course/share-image';
import { foldPanel } from './side-panel';
import { $, toast } from './dom';
import { download } from './share';
import type { EditorView } from './view';

// A picture of the course for social media (#75): the editor's own view
// (2D or 3D, as the user has turned it) framed to the picture's shape, with
// the course's length, size and QR code beside it. The settings sit in the
// side panel so the view stays usable behind them (#75 決定事項).

export interface ShareHost {
  /** The view on screen now. */
  readonly view: EditorView;
  readonly layout: Layout;
  readonly laps: LapCheck | null;
  /** The course's name, offered for the picture. */
  name(): Promise<string>;
  /** The page URL holding the latest course, for the QR code. */
  url(): Promise<string>;
  /** Names the saved file when the picture has no name. */
  readonly fileName: string;
}

/** Gap round the framed view inside the stage, px. */
const FRAME_MARGIN = 16;
/** How long the view settles before the preview is drawn again, ms. */
const PREVIEW_DELAY_MS = 250;
/** Remembers the chosen shape. */
const ASPECT_KEY = 'share.aspect';

const BG = '#1b1d22';
const PANEL = '#24272e';
const TEXT = '#e8eaed';
const MUTED = '#9aa0a6';
const FONT = 'system-ui, sans-serif';
const APP_NAME = 'ミニ四駆コース作成シミュレーター';

/** Write `text` at (x, y) from the top left, no wider than `max`. */
function write(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, max: number, bold = false): void {
  ctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(text, x, y, max);
}

/** The QR code of `url` in a white square `size` px wide at (x, y); false when the URL is too long for one. */
function drawQr(ctx: CanvasRenderingContext2D, url: string, x: number, y: number, size: number): boolean {
  let qr;
  try {
    qr = makeQr(url);
  } catch {
    return false;
  }
  const card = qrCard(qr, 'plain');
  const scale = Math.max(1, Math.floor(size / (qr.size + 2 * QR_QUIET_MODULES)));
  const { width, height, rgba } = cardPixels(card, qr, scale);
  const tile = document.createElement('canvas');
  tile.width = width;
  tile.height = height;
  tile.getContext('2d')!.putImageData(new ImageData(rgba, width, height), 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, size, size);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tile, x, y, size, size);
  ctx.imageSmoothingEnabled = true;
  return true;
}

export class ShareImage {
  private aspect: ShareAspect = 'landscape';
  private timer = 0;
  private panel = $('share-panel');
  private views = [$('view2d'), $('view3d')];

  constructor(private host: ShareHost) {
    try {
      const kept = localStorage.getItem(ASPECT_KEY);
      if (SHARE_ASPECTS.some((a) => a.id === kept)) this.aspect = kept as ShareAspect;
    } catch {
      // Storage blocked: start landscape.
    }
    $('share').addEventListener('click', () => (this.isOpen ? this.close() : void this.open()));
    $('share-close').addEventListener('click', () => this.close());
    $('share-fit').addEventListener('click', () => this.host.view.fit());
    $('share-save').addEventListener('click', () => void this.save());
    for (const a of SHARE_ASPECTS) $(`share-${a.id}`).addEventListener('click', () => this.setAspect(a.id));
    for (const id of ['share-name', 'share-facts', 'share-qr']) $(id).addEventListener('input', () => this.later());
    new ResizeObserver(() => this.isOpen && this.frame()).observe($('stage'));
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  private async open(): Promise<void> {
    this.panel.hidden = false;
    // Its settings are in the side panel.
    foldPanel(false);
    $('palette-section').hidden = true;
    $('share').setAttribute('aria-pressed', 'true');
    $<HTMLInputElement>('share-name').value = await this.host.name();
    this.setAspect(this.aspect);
  }

  close(): void {
    this.panel.hidden = true;
    $('palette-section').hidden = false;
    $('share').setAttribute('aria-pressed', 'false');
    $('stage').classList.remove('framing');
    for (const v of this.views) v.removeAttribute('style');
  }

  private setAspect(aspect: ShareAspect): void {
    this.aspect = aspect;
    try {
      localStorage.setItem(ASPECT_KEY, aspect);
    } catch {
      // Storage blocked: the choice lasts until the page is closed.
    }
    for (const a of SHARE_ASPECTS) $(`share-${a.id}`).setAttribute('aria-pressed', String(a.id === aspect));
    this.frame();
    // Once the views have their new shape, frame the course in it.
    requestAnimationFrame(() => this.host.view.fit());
  }

  /** Shape the views to the course's part of the picture, so what is on screen is what is saved. */
  private frame(): void {
    const stage = $('stage');
    const { course } = shareLayout(this.aspect);
    const f: Rect = frameIn(stage.clientWidth, stage.clientHeight, course.w / course.h, FRAME_MARGIN);
    stage.classList.add('framing');
    for (const v of this.views) Object.assign(v.style, { left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: `${f.h}px` });
    this.later();
  }

  /** The view moved or a setting changed: draw the preview again once it settles. */
  later(): void {
    if (!this.isOpen) return;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.preview(), PREVIEW_DELAY_MS);
  }

  private async preview(): Promise<void> {
    const picture = await this.compose();
    const canvas = $<HTMLCanvasElement>('share-preview');
    canvas.width = picture.width;
    canvas.height = picture.height;
    canvas.getContext('2d')!.drawImage(picture, 0, 0);
  }

  private async compose(): Promise<HTMLCanvasElement> {
    const { width, height, course, info } = shareLayout(this.aspect);
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(this.host.view.snapshot(course.w, course.h), course.x, course.y);
    ctx.fillStyle = PANEL;
    ctx.fillRect(info.x, info.y, info.w, info.h);

    const pad = 56;
    const landscape = this.aspect === 'landscape';
    const withQr = $<HTMLInputElement>('share-qr').checked;
    // The QR code: at the foot of the band (landscape) or on its right (portrait).
    const label = 40;
    const qrSize = landscape ? info.w - 2 * pad : info.h - 2 * pad - label;
    const qrAt = landscape
      ? { x: info.x + pad, y: info.y + info.h - pad - label - qrSize }
      : { x: info.x + info.w - pad - qrSize, y: info.y + pad };
    const textWidth = landscape || !withQr ? info.w - 2 * pad : qrAt.x - info.x - 2 * pad;
    if (withQr) {
      if (drawQr(ctx, await this.host.url(), qrAt.x, qrAt.y, qrSize)) {
        write(ctx, '読み取るとこのコースを開けます', qrAt.x, qrAt.y + qrSize + 12, 22, MUTED, qrSize);
      } else {
        toast('コースが大きすぎて、QRコードに入りません');
      }
    }

    let y = info.y + pad;
    const name = $<HTMLInputElement>('share-name').value.trim();
    if (name) {
      write(ctx, name, info.x + pad, y, 52, TEXT, textWidth, true);
      y += 88;
    }
    if ($<HTMLInputElement>('share-facts').checked) {
      const { layout, laps } = this.host;
      for (const fact of shareFacts(laps, courseExtent(layout), layout.pieces.length)) {
        write(ctx, fact.label, info.x + pad, y, 24, MUTED, textWidth);
        write(ctx, fact.value, info.x + pad, y + 32, 44, TEXT, textWidth, true);
        y += 100;
      }
    }
    write(ctx, APP_NAME, info.x + pad, info.y + info.h - (landscape && withQr ? 36 : pad), 20, MUTED, textWidth);
    return out;
  }

  private async save(): Promise<void> {
    const picture = await this.compose();
    const name = $<HTMLInputElement>('share-name').value.trim() || this.host.fileName;
    picture.toBlob((blob) => (blob ? download(blob, `${name}-${this.aspect === 'landscape' ? '16x9' : '9x16'}.png`) : toast('画像を作れませんでした')));
  }
}
