import { defineConfig } from '@playwright/test';

// E2E_PORT lets parallel runs (for example one per platform group) use their
// own preview server instead of colliding on 4173.
// In a task worktree (../Custodia-wt/<ID>, see scripts/wt.sh) the port is derived
// from the ID so parallel worktrees never share a preview server.
function worktreePort(): number | undefined {
  const id = process.cwd().match(/\/Custodia-wt\/([^/]+)/)?.[1];
  if (!id) return undefined;
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 700;
  return 4200 + hash;
}
const port = Number(process.env.E2E_PORT ?? worktreePort() ?? 4173);

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  workers: 2,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: 'line',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
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
    command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
