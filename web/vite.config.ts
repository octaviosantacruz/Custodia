import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Un sitio estático con tres páginas: el sitio de producto en inglés (/) y
// español (/es/), generadas por scripts/build-site.mjs, y la demo (/demo/).
// Comparten tokens y tipografías.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        site: resolve(import.meta.dirname, 'index.html'),
        siteEs: resolve(import.meta.dirname, 'es/index.html'),
        demo: resolve(import.meta.dirname, 'demo/index.html'),
      },
    },
  },
  server: { host: '127.0.0.1', port: 4184, strictPort: true },
  preview: { host: '127.0.0.1', port: 4184, strictPort: true },
});
