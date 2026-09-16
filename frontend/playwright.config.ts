import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '*.spec.ts',
  fullyParallel: true,
  workers: 2,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    colorScheme: 'dark',
    trace: 'retain-on-failure',
  },
  // Keep the full smoke suite fast while exercising the highest-risk theme
  // variation separately. Auth navigation is the shared shell for every
  // workspace, and its Axe assertions catch regressions in the global chrome.
  projects: [
    { name: 'chromium-dark', use: { browserName: 'chromium', colorScheme: 'dark' } },
    { name: 'chromium-light-shell', testMatch: /auth\.spec\.ts/, use: { browserName: 'chromium', colorScheme: 'light' } },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
