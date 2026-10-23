import { EditorApp } from './editor/app';

const app = new EditorApp();
void app.start().then(async () => {
  const params = new URLSearchParams(location.search);
  if (import.meta.env.DEV && params.has('perf') && params.has('bench')) {
    const { installBench } = await import('./editor/bench-browser');
    installBench(app);
  }
});
