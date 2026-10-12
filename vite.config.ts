import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

export default defineConfig({
  // WebXR only runs in a secure context, so serve over HTTPS with a
  // self-signed certificate. A phone on the LAN can then open AR.
  plugins: [basicSsl()],
  server: {
    // Expose on the LAN so a phone can open the dev server for AR testing.
    host: true,
  },
  preview: {
    host: true,
  },
});
