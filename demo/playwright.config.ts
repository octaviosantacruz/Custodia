import { defineConfig } from '@playwright/test';

// Recorrido completo del guion contra el build real (sin .env ni backend).
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4180', browserName: 'chromium' },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://127.0.0.1:4180',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
