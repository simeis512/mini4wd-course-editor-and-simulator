import * as THREE from 'three';
import type { Layout } from '../course/course';
import { material, MM } from '../course/mesh';
import {
  BUILD_VOLUME,
  largestFit,
  modelSolids,
  printSolids,
  PRINT_MIN_THICKNESS,
  PRINT_SCALES,
  sizeOf,
  stlBinary,
  triangleCount,
  fitsVolume,
  type ModelIncludes,
  type ModelSolid,
} from '../course/model-export';
import { threeMf } from '../course/threemf';
import { $, toast } from './dom';
import { download, fileName } from './share';

// Saving the course as a 3D model (#89): GLB at full size for VRChat and
// other 3D tools, STL / 3MF shrunk for printing. The button sits in the
// header until the UI is tidied up (#106).

export interface ModelHost {
  readonly layout: Layout;
  /** The course's name (its own, or the save it is or matches), which names the saved file. */
  name(): Promise<string>;
}

type Format = 'glb' | 'stl' | '3mf';

interface Settings {
  format: Format;
  includes: ModelIncludes;
  scale: number;
  min: number;
  volume: [number, number, number];
}

/** Remembers the last settings. */
const SETTINGS_KEY = 'model.settings';

const DEFAULTS: Settings = {
  format: 'glb',
  includes: { supports: true, props: true, floor: false },
  scale: 20,
  min: PRINT_MIN_THICKNESS,
  volume: [...BUILD_VOLUME],
};

function loadSettings(): Settings {
  try {
    const kept = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<Settings> | null;
    return { ...DEFAULTS, ...kept, includes: { ...DEFAULTS.includes, ...kept?.includes } };
  } catch {
    return DEFAULTS;
  }
}

const mm = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(1));

/** The GLB file: the solids in metres, one mesh each, coloured as in the 3D view. */
async function glb(solids: readonly ModelSolid[]): Promise<ArrayBuffer> {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const course = new THREE.Group();
  course.name = 'course';
  course.scale.setScalar(MM);
  for (const s of solids) {
    const mesh = new THREE.Mesh(s.geometry, material(s.color, s.shade));
    mesh.name = s.name;
    course.add(mesh);
  }
  return (await new GLTFExporter().parseAsync(course, { binary: true })) as ArrayBuffer;
}

export function bindModelExport(host: ModelHost): void {
  const dialog = $<HTMLDialogElement>('model-dialog');
  const format = $<HTMLSelectElement>('model-format');
  const boxes = { supports: $<HTMLInputElement>('model-supports'), props: $<HTMLInputElement>('model-props'), floor: $<HTMLInputElement>('model-floor') };
  const scale = $<HTMLSelectElement>('model-scale');
  const min = $<HTMLInputElement>('model-min');
  const volume = (['w', 'd', 'h'] as const).map((k) => $<HTMLInputElement>(`model-vol-${k}`));
  const fit = $<HTMLButtonElement>('model-fit');
  scale.innerHTML = PRINT_SCALES.map((n) => `<option value="${n}">1/${n}</option>`).join('');

  const show = (s: Settings) => {
    format.value = s.format;
    for (const k of Object.keys(boxes) as (keyof ModelIncludes)[]) boxes[k].checked = s.includes[k];
    scale.value = String(s.scale);
    min.value = String(s.min);
    volume.forEach((input, i) => (input.value = String(s.volume[i])));
  };
  const read = (): Settings => ({
    format: format.value as Format,
    includes: { supports: boxes.supports.checked, props: boxes.props.checked, floor: boxes.floor.checked },
    scale: Number(scale.value),
    min: Math.max(0.1, Number(min.value) || PRINT_MIN_THICKNESS),
    volume: volume.map((input, i) => Number(input.value) || BUILD_VOLUME[i]) as Settings['volume'],
  });

  /** Say how big the model comes out and whether the print fits the printer. */
  const describe = () => {
    const s = read();
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      // Storage blocked: the settings are only for this visit.
    }
    const printing = s.format !== 'glb';
    $('model-print').hidden = !printing;
    const warn = $('model-warn');
    warn.hidden = true;
    fit.hidden = true;
    if (!host.layout.pieces.length) {
      $('model-size').textContent = 'コースにピースがありません。';
      return;
    }
    if (!printing) {
      const solids = modelSolids(host.layout, s.includes);
      const [x, y, z] = sizeOf(solids);
      const tris = solids.reduce((n, m) => n + triangleCount(m.geometry), 0);
      $('model-size').textContent = `大きさ ${(x / 1000).toFixed(2)} × ${(z / 1000).toFixed(2)} m、高さ ${(y / 1000).toFixed(2)} m（実寸）・${tris.toLocaleString()} 三角形`;
      return;
    }
    const sizes = new Map<number, [number, number, number]>();
    const sizeAt = (n: number) => {
      if (!sizes.has(n)) sizes.set(n, sizeOf(printSolids(host.layout, s.includes, n, s.min)));
      return sizes.get(n)!;
    };
    const [x, y, z] = sizeAt(s.scale);
    $('model-size').textContent = `1/${s.scale} で ${mm(x)} × ${mm(y)} × 高さ ${mm(z)} mm`;
    if (fitsVolume([x, y, z], s.volume)) return;
    const best = largestFit(sizeAt, s.volume);
    // Splitting into pieces comes later (#89 決定事項); for now only say so.
    warn.hidden = false;
    warn.textContent = best
      ? `造形範囲に収まりません。収まるいちばん大きい縮尺は 1/${best} です（分けて刷る機能は今後）。`
      : `どの縮尺でも造形範囲に収まりません（分けて刷る機能は今後）。保存はできます。`;
    if (best) {
      fit.hidden = false;
      fit.textContent = `1/${best} にする`;
      fit.dataset.scale = String(best);
    }
  };
  for (const el of [format, scale, min, ...volume, ...Object.values(boxes)]) el.addEventListener('change', describe);
  fit.addEventListener('click', () => {
    scale.value = fit.dataset.scale!;
    describe();
  });

  $('model').addEventListener('click', () => {
    show(loadSettings());
    describe();
    dialog.showModal();
  });

  $('model-save').addEventListener('click', async () => {
    const s = read();
    if (!host.layout.pieces.length) return toast('コースにピースがありません');
    const save = $<HTMLButtonElement>('model-save');
    save.disabled = true;
    try {
      const name = fileName(await host.name());
      if (s.format === 'glb') {
        download(new Blob([await glb(modelSolids(host.layout, s.includes))], { type: 'model/gltf-binary' }), `${name}.glb`);
      } else {
        const solids = printSolids(host.layout, s.includes, s.scale, s.min);
        const file = `${name}-1_${s.scale}`;
        if (s.format === 'stl') download(new Blob([stlBinary(solids)], { type: 'model/stl' }), `${file}.stl`);
        else download(new Blob([threeMf(solids) as Uint8Array<ArrayBuffer>], { type: 'model/3mf' }), `${file}.3mf`);
      }
      dialog.close();
    } catch (e) {
      console.error(e);
      toast('3Dモデルを作れませんでした');
    } finally {
      save.disabled = false;
    }
  });
}
