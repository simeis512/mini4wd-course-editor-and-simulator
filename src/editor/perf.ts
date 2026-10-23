/** Opt-in User Timing spans; normal sessions never call the Performance API (#87). */
const enabled = typeof location !== 'undefined' && new URLSearchParams(location.search).has('perf');
let serial = 0;

export function perfSpan<T>(name: string, run: () => T): T {
  if (!enabled) return run();
  const start = `mini4wd:start:${++serial}`;
  performance.mark(start);
  try {
    return run();
  } finally {
    performance.measure(`mini4wd:${name}`, start);
    performance.clearMarks(start);
  }
}

export function perfReport<T>(name: string, run: () => T): T {
  if (!enabled) return run();
  const from = performance.now();
  try {
    return perfSpan(name, run);
  } finally {
    const entries = performance.getEntriesByType('measure').filter((e) => e.name.startsWith('mini4wd:') && e.startTime >= from);
    console.table(entries.map((e) => ({ section: e.name.slice(8), ms: Number(e.duration.toFixed(3)) })));
    // Bound retained entries during long drags while keeping the latest frame visible in DevTools.
    if (performance.getEntriesByType('measure').length > 2000) {
      for (const entry of entries) performance.clearMeasures(entry.name);
    }
  }
}
