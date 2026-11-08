import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/* La app de Custodia. En desarrollo, /api va al backend local; con
   VITE_DEMO=1 la API simulada responde dentro del navegador (demo estática). */
const HOST_CONFIG = {
  host: '127.0.0.1' as const,
  port: 4184,
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
  server: HOST_CONFIG,
  preview: HOST_CONFIG,
});
