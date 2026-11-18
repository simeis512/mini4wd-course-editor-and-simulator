// Compact binary data for URLs: LEB128 varints (signed ones zigzag
// encoded), deflate-raw and base64url. Used by the course and machine formats.

export class Writer {
  bytes: number[] = [];
  uint(n: number): void {
    if (!Number.isInteger(n) || n < 0) throw new RangeError(`not a uint: ${n}`);
    while (n >= 0x80) {
      this.bytes.push((n % 0x80) | 0x80);
      n = Math.floor(n / 0x80);
    }
    this.bytes.push(n);
  }
  int(n: number): void {
    this.uint(n >= 0 ? n * 2 : -n * 2 - 1);
  }
  tenths(x: number): void {
    this.int(Math.round(x * 10));
  }
  hundredths(x: number): void {
    this.int(Math.round(x * 100));
  }
}

export class Reader {
  pos = 0;
  constructor(private bytes: Uint8Array) {}
  uint(): number {
    let n = 0;
    let scale = 1;
    for (;;) {
      if (this.pos >= this.bytes.length) throw new Error('truncated course data');
      const b = this.bytes[this.pos++];
      n += (b & 0x7f) * scale;
      if (b < 0x80) return n;
      scale *= 0x80;
      if (scale > 2 ** 49) throw new Error('varint too long');
    }
  }
  int(): number {
    const u = this.uint();
    return u % 2 === 0 ? u / 2 : -(u + 1) / 2;
  }
  tenths(): number {
    return this.int() / 10;
  }
  hundredths(): number {
    return this.int() / 100;
  }
  take(n: number): Uint8Array {
    if (this.pos + n > this.bytes.length) throw new Error('truncated course data');
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
}

export async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
