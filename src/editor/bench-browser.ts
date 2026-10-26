import { benchAddition, type BenchSize } from '../course/bench-courses';
import type { Course, Layout } from '../course/course';
import type { Selection } from './selection';
import type { EditorApp } from './app';
import type { EditorView } from './view';
import type { PaletteDrag } from './drag';
import { perfSpan } from './perf';

/** Dev-only adapter exercising the real edit/refresh and pointermove paths (#87). */
interface BenchApp {
  load(course: Course, writeUrl: boolean): void;
  commit(course: Course, selection: Selection): void;
  setMode(mode: '2d' | '3d'): void;
  layout: Layout;
  view: EditorView;
  paletteDrag: PaletteDrag;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const WARMUP = 5;
const SAMPLES = 20;
// A timer also progresses when an automated browser window is occluded.
const frame = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

async function loadFixture(app: BenchApp, course: Course, mode: '2d' | '3d'): Promise<void> {
  app.load(structuredClone(course), false);
  app.setMode(mode);
  await frame();
}

export function installBench(editor: EditorApp): void {
  const app = editor as unknown as BenchApp;
  const box = document.createElement('section');
  box.style.cssText = 'position:fixed;bottom:0;right:0;z-index:10000;background:#fff;color:#111;padding:8px;max-height:50vh;overflow:auto;max-width:70vw';
  const button = document.createElement('button');
  button.textContent = 'S/M/Lを計測 (#87)';
  const output = document.createElement('pre');
  output.id = 'bench-results';
  box.append(button, output);
  const trace = traceControls(app, output, button);
  box.insertBefore(trace.box, output);
  document.body.append(box);
  button.onclick = async () => {
    button.disabled = true;
    trace.reset(true);
    try {
      const results = [];
      for (const size of ['S', 'M', 'L'] as BenchSize[]) {
        const { course, next, x, z } = benchAddition(size);
        for (const mode of ['2d', '3d'] as const) {
          const samples: Record<string, number>[] = [];
          const drags: Record<string, number>[] = [];
          const warmDrags: Record<string, number>[] = [];
          for (let i = 0; i < WARMUP + SAMPLES; i++) {
            await loadFixture(app, course, mode);
            performance.clearMeasures();
            app.commit(structuredClone(next), null);
            const sample = entries();
            // Wait for asynchronous URL encoding and a rendered frame outside refresh timing.
            await frame();
            if (i >= WARMUP) samples.push(sample);
            await loadFixture(app, course, mode);
            const point = app.view.clientOf(x, 0, z)!;
            const drag = app.paletteDrag as unknown as { paletteDrag: unknown };
            drag.paletteDrag = { item: { part: 'straight' }, pointerId: 1, from: { x: 0, y: 0 }, active: true, preview: null };
            performance.clearMeasures();
            app.paletteDrag.move({ pointerId: 1, clientX: point[0], clientY: point[1], shiftKey: false } as PointerEvent);
            if (i >= WARMUP) drags.push(entries());
            performance.clearMeasures();
            app.paletteDrag.move({ pointerId: 1, clientX: point[0] + 0.5, clientY: point[1], shiftKey: false } as PointerEvent);
            if (i >= WARMUP) warmDrags.push(entries());
            drag.paletteDrag = null;
          }
          const summarize = (data: Record<string, number>[]) => Object.fromEntries(
            [...new Set(data.flatMap(Object.keys))].map((key) => [key, Number(median(data.map((s) => s[key] ?? 0)).toFixed(3))]),
          );
          results.push({ size, mode, refresh: summarize(samples), drag: summarize(drags), warmDrag: summarize(warmDrags) });
          output.textContent = JSON.stringify({ browser: navigator.userAgent, samples: SAMPLES, results }, null, 2);
          await frame();
        }
      }
    } catch (error) {
      output.textContent += `\nERROR: ${String(error)}`;
    } finally {
      button.disabled = false;
      trace.reset(false);
    }
  };
}

/** Prepare outside the recording, then capture exactly one real addition (#104). */
function traceControls(app: BenchApp, output: HTMLElement, bench: HTMLButtonElement) {
  const box = document.createElement('div');
  const add = document.createElement('button');
  add.textContent = '1ピース追加を記録 (#104)';
  add.disabled = true;
  let prepared: { next: Course; mode: '2d' | '3d' } | null = null;
  const prepare = (['2d', '3d'] as const).map((mode) => {
    const button = document.createElement('button');
    button.textContent = `L / ${mode.toUpperCase()}を準備 (#104)`;
    button.onclick = async () => {
      bench.disabled = true;
      add.disabled = true;
      for (const b of prepare) b.disabled = true;
      prepared = null;
      output.textContent = '計測用のコースを準備中…';
      try {
        const { course, next } = benchAddition('L');
        // Match the regular benchmark's warmup; exclude setup from the trace.
        for (let i = 0; i < WARMUP; i++) {
          await loadFixture(app, course, mode);
          app.commit(structuredClone(next), null);
          await frame();
        }
        await loadFixture(app, course, mode);
        prepared = { next, mode };
        add.disabled = false;
        output.textContent = 'DevTools の Performance で記録を開始し、「1ピース追加を記録」を押してから記録を停止してください。';
      } catch (error) {
        output.textContent = `ERROR: ${String(error)}`;
      } finally {
        bench.disabled = false;
        for (const b of prepare) b.disabled = false;
      }
    };
    return button;
  });
  add.onclick = () => {
    if (!prepared) return;
    const { next, mode } = prepared;
    prepared = null;
    add.disabled = true;
    performance.clearMeasures();
    // Distinguish the addition from fixture setup in the Performance timeline.
    // The next rAF mark is a scheduling boundary, not GPU/presentation time.
    perfSpan(`profile:add:${mode}`, () => app.commit(structuredClone(next), null));
    requestAnimationFrame(() => performance.mark('mini4wd:profile:next-frame'));
    // Keep the report DOM unchanged so its own layout/paint does not enter the trace.
  };
  box.append(...prepare, add);
  return {
    box,
    reset(busy: boolean) {
      prepared = null;
      add.disabled = true;
      for (const button of prepare) button.disabled = busy;
    },
  };
}

function entries(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of performance.getEntriesByType('measure')) {
    if (e.name.startsWith('mini4wd:')) out[e.name.slice(8)] = (out[e.name.slice(8)] ?? 0) + e.duration;
  }
  return out;
}
