import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  performance.clearMarks();
  performance.clearMeasures();
});

it('does not record or log anything without ?perf (#87)', async () => {
  vi.resetModules();
  vi.stubGlobal('location', { search: '' });
  const mark = vi.spyOn(performance, 'mark');
  const table = vi.spyOn(console, 'table').mockImplementation(() => {});
  const { perfReport, perfSpan } = await import('./perf');
  expect(perfReport('refresh:2d', () => perfSpan('layout', () => 87))).toBe(87);
  expect(mark).not.toHaveBeenCalled();
  expect(table).not.toHaveBeenCalled();
});

it('records named measures and a timing breakdown only with ?perf (#87)', async () => {
  vi.resetModules();
  vi.stubGlobal('location', { search: '?perf' });
  const table = vi.spyOn(console, 'table').mockImplementation(() => {});
  const { perfReport, perfSpan } = await import('./perf');
  expect(perfReport('refresh:3d', () => perfSpan('layout', () => 87))).toBe(87);
  expect(performance.getEntriesByType('measure').map((e) => e.name)).toEqual(['mini4wd:refresh:3d', 'mini4wd:layout']);
  expect(table).toHaveBeenCalledOnce();
});
