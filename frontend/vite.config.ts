import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const HOST_CONFIG = {
  host: '0.0.0.0' as const,
  port: 5173,
  allowedHosts: ['dshub.itti.digital'],
  proxy: {
    '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
  },
};

export default defineConfig({
  plugins: [react()],
  build: {
    // Advanced charts are already loaded on demand, but ECharts' optional
    // renderer/chart modules form one intentional lazy chunk (~588 kB).
    // Keep Vite's warning useful for the eagerly loaded application chunks.
    chunkSizeWarningLimit: 650,
  },
  // `server` drives `vite`/`npm run web`; `preview` drives `vite preview`
  // (`npm run web:frontend:prod`), which serves the built frontend/dist --
  // without this block `deploy` only brought up the backend on :8000 and
  // silently skipped the frontend port entirely.
  server: HOST_CONFIG,
  preview: HOST_CONFIG,
});
