import { benchAddition, type BenchSize } from '../course/bench-courses';
import type { Course, Layout } from '../course/course';
import type { Selection } from './selection';
import type { EditorApp } from './app';
import type { EditorView } from './view';
import type { PaletteDrag } from './drag';

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
// A timer also progresses when an automated browser window is occluded.
const frame = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

export function installBench(editor: EditorApp): void {
  const app = editor as unknown as BenchApp;
  const box = document.createElement('section');
  box.style.cssText = 'position:fixed;bottom:0;right:0;z-index:10000;background:#fff;color:#111;padding:8px;max-height:50vh;overflow:auto;max-width:70vw';
  const button = document.createElement('button');
  button.textContent = 'S/M/Lを計測 (#87)';
  const output = document.createElement('pre');
  output.id = 'bench-results';
  box.append(button, output);
  document.body.append(box);
  button.onclick = async () => {
    button.disabled = true;
    try {
      const results = [];
      for (const size of ['S', 'M', 'L'] as BenchSize[]) {
        const { course, next, x, z } = benchAddition(size);
        for (const mode of ['2d', '3d'] as const) {
          const samples: Record<string, number>[] = [];
          const drags: Record<string, number>[] = [];
          const warmDrags: Record<string, number>[] = [];
          for (let i = 0; i < 25; i++) {
            app.load(structuredClone(course), false);
            app.setMode(mode);
            await frame();
            performance.clearMeasures();
            app.commit(structuredClone(next), null);
            const sample = entries();
            // Wait for asynchronous URL encoding and a rendered frame outside refresh timing.
            await frame();
            if (i >= 5) samples.push(sample);
            app.load(structuredClone(course), false);
            app.setMode(mode);
            await frame();
            const point = app.view.clientOf(x, 0, z)!;
            const drag = app.paletteDrag as unknown as { paletteDrag: unknown };
            drag.paletteDrag = { item: { part: 'straight' }, pointerId: 1, from: { x: 0, y: 0 }, active: true, preview: null };
            performance.clearMeasures();
            app.paletteDrag.move({ pointerId: 1, clientX: point[0], clientY: point[1], shiftKey: false } as PointerEvent);
            if (i >= 5) drags.push(entries());
            performance.clearMeasures();
            app.paletteDrag.move({ pointerId: 1, clientX: point[0] + 0.5, clientY: point[1], shiftKey: false } as PointerEvent);
            if (i >= 5) warmDrags.push(entries());
            drag.paletteDrag = null;
          }
          const summarize = (data: Record<string, number>[]) => Object.fromEntries(
            [...new Set(data.flatMap(Object.keys))].map((key) => [key, Number(median(data.map((s) => s[key] ?? 0)).toFixed(3))]),
          );
          results.push({ size, mode, refresh: summarize(samples), drag: summarize(drags), warmDrag: summarize(warmDrags) });
          output.textContent = JSON.stringify({ browser: navigator.userAgent, samples: 20, results }, null, 2);
          await frame();
        }
      }
    } catch (error) {
      output.textContent += `\nERROR: ${String(error)}`;
    } finally {
      button.disabled = false;
    }
  };
}

function entries(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of performance.getEntriesByType('measure')) {
    if (e.name.startsWith('mini4wd:')) out[e.name.slice(8)] = (out[e.name.slice(8)] ?? 0) + e.duration;
  }
  return out;
}
