import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

/** The commit the app is built from, for bug reports (#137): Cloudflare Pages says it, else git. */
function commit(): string {
  const sha = process.env.CF_PAGES_COMMIT_SHA;
  if (sha) return sha.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

export default defineConfig({
  // WebXR only runs in a secure context, so serve over HTTPS with a
  // self-signed certificate. A phone on the LAN can then open AR.
  plugins: [basicSsl()],
  define: {
    // From package.json, not written twice (#137).
    __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync('package.json', 'utf8')).version),
    __APP_COMMIT__: JSON.stringify(commit()),
  },
  server: {
    // Expose on the LAN so a phone can open the dev server for AR testing.
    host: true,
  },
  preview: {
    host: true,
  },
});
