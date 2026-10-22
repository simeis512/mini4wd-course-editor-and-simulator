import { decodeCourse, HASH_KEY } from '../course/codec';
import { courseValueOf } from '../course/qr';
import { $, toast } from './dom';

// Reading a course QR code with the camera or from an image (#66). The
// browser's BarcodeDetector first; jsQR, loaded only then, where there is none.

/** What a code can be read from. */
type Source = HTMLVideoElement | ImageBitmap;
/** The text of the QR code in a source, or null when none is found. */
type Detect = (source: Source) => Promise<string | null>;

/** The parts of BarcodeDetector used here (not in TypeScript's DOM types yet). */
interface BarcodeDetectorLike {
  detect(source: Source): Promise<{ rawValue: string }[]>;
}
interface BarcodeDetectorClass {
  new (options: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats(): Promise<string[]>;
}

/** A mouse or trackpad device, where there is no gallery to pick from. */
const FINE_POINTER = '(hover: hover) and (pointer: fine)';
/** Time between looks at the camera picture. */
const SCAN_INTERVAL_MS = 200;
/** Longest side a picture is shrunk to before jsQR reads it, for speed. */
const JSQR_MAX_SIDE = 1024;

async function makeDetect(): Promise<Detect> {
  const Native = (window as unknown as { BarcodeDetector?: BarcodeDetectorClass }).BarcodeDetector;
  if (Native && (await Native.getSupportedFormats().catch((): string[] => [])).includes('qr_code')) {
    const detector = new Native({ formats: ['qr_code'] });
    return async (source) => (await detector.detect(source))[0]?.rawValue ?? null;
  }
  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return async (source) => {
    const [w, h] = source instanceof HTMLVideoElement ? [source.videoWidth, source.videoHeight] : [source.width, source.height];
    if (!w || !h) return null;
    const k = Math.min(1, JSQR_MAX_SIDE / Math.max(w, h));
    canvas.width = Math.round(w * k);
    canvas.height = Math.round(h * k);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(image.data, image.width, image.height)?.data ?? null;
  };
}

export class QrScanner {
  private detect: Promise<Detect> | null = null;
  private stream: MediaStream | null = null;
  private timer = 0;
  private video = $<HTMLVideoElement>('qr-video');
  private sheet = $<HTMLDialogElement>('qr-sheet');

  constructor(private dialog: HTMLDialogElement) {
    const gallery = $<HTMLInputElement>('qr-image-file');
    gallery.addEventListener('change', () => {
      if (gallery.files?.[0]) void this.readImage(gallery.files[0]);
      gallery.value = '';
    });
    // Pressing the drop area: on a phone or tablet, our own sheet offers the
    // camera, read live in the sheet as soon as a code is in sight (owner
    // 2026-10-22: taking a photo first was clumsy), or the gallery (an
    // images-only input opens the photo picker); a PC goes straight to its
    // file picker.
    const sheet = this.sheet;
    $('qr-sheet-camera').addEventListener('click', () => void this.startCamera());
    $('qr-sheet-gallery').addEventListener('click', () => {
      sheet.close();
      gallery.click();
    });
    sheet.addEventListener('close', () => this.stop());
    const choose = () => (matchMedia(FINE_POINTER).matches ? gallery.click() : sheet.showModal());
    const drop = $('qr-drop');
    drop.addEventListener('click', choose);
    drop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        choose();
      }
    });
    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.classList.add('over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      const image = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (image) void this.readImage(image);
      else toast('画像ファイルをドロップしてください');
    });
  }

  private detector(): Promise<Detect> {
    // Forget a failed load so the next try loads again.
    this.detect ??= makeDetect().catch((e) => {
      this.detect = null;
      throw e;
    });
    return this.detect;
  }

  private async readImage(file: File): Promise<void> {
    if (file.type && !file.type.startsWith('image/')) {
      toast('QRコードの画像を選んでください');
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const text = await (await this.detector())(bitmap);
      bitmap.close();
      if (text === null) toast('画像からQRコードが見つかりませんでした');
      else await this.open(text);
    } catch (e) {
      toast(`画像を読めませんでした: ${(e as Error).message}`);
    }
  }

  private async startCamera(): Promise<void> {
    // Open the picture's place at once; the camera fills it when it starts.
    this.live(true);
    try {
      const [detect, stream] = await Promise.all([
        this.detector(),
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }),
      ]);
      if (!this.sheet.open) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play();
      // A code that is not a course is said once, and the camera goes on looking.
      let refused: string | null = null;
      const look = async () => {
        if (!this.stream) return;
        const text = await detect(this.video).catch(() => null);
        if (text !== null && text !== refused && this.stream) {
          if (await this.open(text)) return;
          refused = text;
        }
        if (this.stream) this.timer = window.setTimeout(look, SCAN_INTERVAL_MS);
      };
      void look();
    } catch (e) {
      this.stop();
      toast(`カメラを使えませんでした: ${(e as Error).message}`);
    }
  }

  stop(): void {
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.live(false);
  }

  /** Show the camera picture in the sheet in place of the camera button, or put the button back. */
  private live(on: boolean): void {
    $('qr-live').hidden = !on;
    $('qr-sheet-camera').hidden = on;
  }

  /** Open the course in the text read, or say why not; resolves to whether it opened. */
  private async open(text: string): Promise<boolean> {
    // Only the course is taken from the URL, whatever its host, and it must
    // decode to a valid course before it is opened.
    const value = courseValueOf(text);
    if (!value) {
      toast('コースのQRコードではありません');
      return false;
    }
    try {
      await decodeCourse(value);
    } catch (e) {
      toast(`QRコードのコースを読み込めませんでした: ${(e as Error).message}`);
      return false;
    }
    // Closing the sheet stops the camera.
    this.sheet.close();
    this.dialog.close();
    const hash = `#${HASH_KEY}=${value}`;
    if (hash === location.hash) toast('このコースはもう開いています');
    // The page's hash change opens it, as a shared URL would.
    else location.hash = hash;
    return true;
  }
}
