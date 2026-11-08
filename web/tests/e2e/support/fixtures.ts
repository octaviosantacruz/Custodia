import { test as base, expect, type Page } from '@playwright/test';
import { createMockApi, type MockOptions } from '../../../src/demo/mock-api.ts';

export * from '../../../src/demo/mock-api.ts';

/* La API simulada vive en src/demo/mock-api.ts para que la demo estática la
   reutilice; aquí sólo se conecta a Playwright. */
export async function mockAuthenticatedApp(page: Page, options: MockOptions = {}) {
  const handle = createMockApi(options);
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    let body: unknown = null;
    try { body = request.postDataJSON(); } catch { body = null; }
    await route.fulfill(await handle({ url: request.url(), method: request.method(), body }));
  });
}

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    if (testInfo.title.includes('UX-AUD2-')) {
      const theme = testInfo.project.use.colorScheme === 'light' ? 'light' : 'dark';
      await page.addInitScript((value) => localStorage.setItem('dshub-theme:v1', value), theme);
    }
    await use(page);
  },
});
export { expect };
