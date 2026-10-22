import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Standalone fictional company: never load workplace env files or proxy /api.
export default defineConfig({
  plugins: [react()],
  envDir: false,
  define: { 'import.meta.env.VITE_API_URL': '""' },
  server: { host: '127.0.0.1', port: 4182, strictPort: true },
  preview: { host: '127.0.0.1', port: 4182, strictPort: true },
  build: { chunkSizeWarningLimit: 650 },
});
