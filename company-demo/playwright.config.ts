import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e', fullyParallel: true, workers: 2, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4183', browserName: 'chromium', viewport: { width: 1440, height: 1000 },
    launchOptions: process.env.CUSTODIA_CHROMIUM_PATH ? { executablePath: process.env.CUSTODIA_CHROMIUM_PATH } : {} },
  webServer: { command: 'npm run preview -- --port 4183', url: 'http://127.0.0.1:4183', reuseExistingServer: false },
});
