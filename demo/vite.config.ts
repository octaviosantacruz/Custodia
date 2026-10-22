import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Build independiente: sin .env, sin red, sin backend. `base: './'` permite
// servir la demo bajo cualquier ruta pública.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { fs: { allow: ['..'] } },
});
