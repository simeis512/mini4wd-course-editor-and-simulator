import { EditorApp } from './editor/app';

const app = new EditorApp();
void app.start().then(async () => {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('bench')) {
    const { installBench } = await import('./editor/bench-browser');
    installBench(app);
  }
});
