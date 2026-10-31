// #104: record single-addition traces (L / 2D, 3D) in a real Chrome and summarise them.
// Usage: node trace-104.mjs <app url with ?perf&bench> <out dir> [runs=3] [--headless] [--bench]
// --bench also runs the full S/M/L benchmark (#87) once per run and keeps the L refresh medians.
// Needs playwright-core (no browser download): uses the installed Chrome unless --chromium.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(join(process.cwd(), 'x.js'));
const { chromium } = require('playwright-core');

const [url, out, runsArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const runs = Number(runsArg ?? 3);
const headless = process.argv.includes('--headless');
mkdirSync(out, { recursive: true });

const KINDS = {
  style: ['UpdateLayoutTree', 'RecalculateStyles'],
  layout: ['Layout'],
  paint: ['PrePaint', 'Paint', 'Layerize', 'UpdateLayer', 'PaintImage'],
  commit: ['Commit'],
  rAF: ['FireAnimationFrame'],
  gc: ['MinorGC', 'MajorGC', 'V8.GCScavenger', 'V8.GCCompactor', 'V8.GCFinalizeMC', 'BlinkGC.AtomicPhase', 'CppGC.AtomicMark'],
  task: ['RunTask'],
};
const union = (s) => s.sort((a, b) => a[0] - b[0]).reduce((o, [a, b]) => {
  if (o.length && a <= o.at(-1)[1]) o.at(-1)[1] = Math.max(o.at(-1)[1], b); else o.push([a, b]);
  return o;
}, []);
const clip = (s, lo, hi) => s.filter(([a, b]) => b > lo && a < hi).map(([a, b]) => [Math.max(a, lo), Math.min(b, hi)]);
const total = (s) => s.reduce((t, [a, b]) => t + b - a, 0);
const ms = (us) => Math.round(us / 10) / 100;

// Window: addition start .. end of the first main-thread Commit after it (the frame with the new piece).
export function analyse(events) {
  const main = events.find((e) => e.name === 'thread_name' && e.args.name === 'CrRendererMain');
  const begins = new Map(); const spans = {};
  for (const e of events) {
    if (e.cat !== 'blink.user_timing' || !e.name?.startsWith('mini4wd:') || !['b', 'e'].includes(e.ph)) continue;
    const key = e.name + JSON.stringify(e.id2 ?? e.id);
    if (e.ph === 'b') begins.set(key, e.ts);
    else if (begins.has(key)) (spans[e.name] ??= []).push([begins.get(key), e.ts]);
  }
  const add = Object.entries(spans).find(([k]) => k.startsWith('mini4wd:profile:add:'))[1][0];
  const refresh = Object.entries(spans).filter(([k]) => k.startsWith('mini4wd:refresh')).flatMap(([, v]) => v).filter((s) => s[0] >= add[0]);
  const byKind = Object.fromEntries(Object.keys(KINDS).map((k) => [k, []]));
  const commits = [];
  for (const e of events) {
    if (e.ph !== 'X' || e.pid !== main.pid || e.tid !== main.tid || e.dur === undefined) continue;
    for (const [kind, names] of Object.entries(KINDS)) if (names.includes(e.name)) byKind[kind].push([e.ts, e.ts + e.dur]);
    if (e.name === 'Commit' && e.ts >= add[1]) commits.push(e.ts + e.dur);
  }
  const end = commits.length ? Math.min(...commits) : add[1] + 100_000;
  const row = { add: ms(add[1] - add[0]), refresh: ms(total(refresh)), toFrame: ms(end - add[0]) };
  for (const [kind, s] of Object.entries(byKind)) {
    const u = clip(union(s), add[0], end);
    row[kind] = ms(total(u));
    row[kind + 'InRefresh'] = ms(refresh.reduce((t, [a, b]) => t + total(clip(u, a, b)), 0));
  }
  return row;
}

const browser = await chromium.launch({ headless, channel: process.argv.includes('--chromium') ? undefined : 'chrome' });
const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1209, height: 535 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url);
const ok = page.getByRole('button', { name: 'OK' });
if (await ok.isVisible().catch(() => false)) await ok.click();
await page.getByRole('button', { name: 'L / 2Dを準備 (#104)' }).waitFor({ timeout: 60000 });
const results = [];
const benches = [];
for (let run = 1; run <= runs; run++) {
  if (process.argv.includes('--bench')) {
    await page.getByRole('button', { name: 'S/M/Lを計測 (#87)' }).click();
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.startsWith('S/M/L'));
      return !b.disabled && document.querySelector('#bench-results').textContent.includes('"L"');
    }, null, { timeout: 900000, polling: 1000 });
    const data = JSON.parse((await page.locator('#bench-results').textContent()).split('\nERROR')[0]);
    benches.push({ run, L: data.results.filter((r) => r.size === 'L').map((r) => ({ mode: r.mode, refresh: r.refresh })) });
  }
  for (const mode of ['2D', '3D']) {
    await page.getByRole('button', { name: `L / ${mode}を準備 (#104)` }).click();
    await page.waitForFunction(() => document.querySelector('#bench-results')?.textContent.includes('DevTools'), null, { timeout: 300000 });
    await page.waitForTimeout(500);
    const path = join(out, `trace-${mode}-${run}.json`);
    await browser.startTracing(page, { path, categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing', 'v8', 'disabled-by-default-v8.gc'] });
    await page.getByRole('button', { name: '1ピース追加を記録 (#104)' }).click();
    await page.waitForTimeout(1500);
    await browser.stopTracing();
    const trace = JSON.parse(readFileSync(path, 'utf8'));
    results.push({ mode, run, ...analyse(trace.traceEvents ?? trace) });
  }
}
const browserVersion = browser.version();
await browser.close();
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const summary = {};
for (const mode of ['2D', '3D']) {
  const rows = results.filter((r) => r.mode === mode);
  summary[mode] = Object.fromEntries(Object.keys(rows[0]).filter((k) => typeof rows[0][k] === 'number' && k !== 'run').map((k) => [k, median(rows.map((r) => r[k]))]));
}
const report = { url, browser: browserVersion, headless, runs, results, summary, benches, errors };
writeFileSync(join(out, 'summary.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
