import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Set by the GitHub Pages deploy workflow (deploy-pages.yml) to
  // actions/configure-pages's `base_path` output — "/" for a custom domain
  // or a user/org page, "/<repo-name>/" for a project page without one.
  // Every other build (local dev, Docker/other static hosts) leaves this
  // unset and gets the normal root-relative "/".
  base: process.env.BASE_PATH || '/',
  build: {
    // Two independent single-page apps sharing one build: the disposable
    // inspector (index.html) and the admin stats page (admin.html, see
    // src/admin/). Without this, the production build would only emit the
    // former — dev mode serves both automatically, which is what makes
    // this easy to miss.
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
});
