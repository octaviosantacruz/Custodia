import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Sitio de producto estático: inglés (/) y español (/es/), generados desde
// site/template.html por scripts/build-site.mjs. La demo es otra app (web/).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        site: resolve(import.meta.dirname, 'index.html'),
        siteEs: resolve(import.meta.dirname, 'es/index.html'),
      },
    },
  },
  server: { host: '127.0.0.1', port: 4186, strictPort: true },
  preview: { host: '127.0.0.1', port: 4186, strictPort: true },
});
