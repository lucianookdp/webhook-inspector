import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
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
