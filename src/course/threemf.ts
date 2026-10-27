import { forEachTriangle, shownColor, type ModelSolid } from './model-export';

// A 3MF file of the print (#89): one object per colour, so a multi-colour
// printer can give each its filament. 3MF is XML in a zip; the zip is
// written here uncompressed ("stored"), which every reader takes.

/** The 3MF model XML (mm): a base material per colour, one object per colour holding its solids. */
export function threeMfModel(solids: readonly ModelSolid[]): string {
  const byColor = new Map<string, ModelSolid[]>();
  for (const s of solids) {
    const c = shownColor(s);
    byColor.set(c, [...(byColor.get(c) ?? []), s]);
  }
  const colors = [...byColor.keys()];
  const objects = colors.map((color, k) => {
    const vertices: string[] = [];
    const triangles: string[] = [];
    for (const s of byColor.get(color)!) {
      const base = vertices.length;
      const pos = s.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) vertices.push(`<vertex x="${num(pos.getX(i))}" y="${num(pos.getY(i))}" z="${num(pos.getZ(i))}"/>`);
      forEachTriangle(s.geometry, (_a, _b, _c, ia, ib, ic) => triangles.push(`<triangle v1="${base + ia}" v2="${base + ib}" v3="${base + ic}"/>`));
    }
    return `<object id="${k + 2}" type="model" pid="1" pindex="${k}" name="${color}"><mesh><vertices>${vertices.join('')}</vertices><triangles>${triangles.join('')}</triangles></mesh></object>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    '<resources>',
    `<basematerials id="1">${colors.map((c) => `<base name="${c}" displaycolor="${c.toUpperCase()}"/>`).join('')}</basematerials>`,
    ...objects,
    '</resources>',
    `<build>${colors.map((_, k) => `<item objectid="${k + 2}"/>`).join('')}</build>`,
    '</model>',
  ].join('\n');
}

const num = (v: number) => String(Math.round(v * 1e4) / 1e4);

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;

/** The 3MF file. */
export function threeMf(solids: readonly ModelSolid[]): Uint8Array {
  return zipStored([
    ['[Content_Types].xml', CONTENT_TYPES],
    ['_rels/.rels', RELS],
    ['3D/3dmodel.model', threeMfModel(solids)],
  ]);
}

let crcTable: Uint32Array | null = null;

export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of data) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A zip of the files (name, text), stored without compression. */
export function zipStored(files: readonly [string, string][]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(text);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    // Flag 0x800: names are UTF-8.
    local.setUint16(6, 0x800, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x800, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, data);
    central.push(new Uint8Array(entry.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
