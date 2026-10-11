import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Expose on the LAN so a phone can open the dev server for AR testing.
    host: true,
  },
});
