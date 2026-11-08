import { expect, mockAuthenticatedApp, test } from '../support/fixtures';
import type { Page } from '@playwright/test';

type Sample = [number, number];

// Records the left edge of every toast on each animation frame so the test
// asserts the real motion, not only the final resting position.
async function recordToastMotion(page: Page) {
  await page.evaluate(() => {
    const samples: Record<string, [number, number][]> = {};
    (window as unknown as { __toastSamples: typeof samples }).__toastSamples = samples;
    const started = performance.now();
    const tick = () => {
      for (const element of document.querySelectorAll<HTMLElement>('.sync-toast, .app-toast')) {
        const kind = element.classList.contains('sync-toast') ? 'sync' : element.classList.contains('error') ? 'error' : 'notice';
        (samples[kind] ||= []).push([performance.now() - started, element.getBoundingClientRect().left]);
      }
      if (performance.now() - started < 8000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function toastSamples(page: Page, kind: string): Promise<Sample[]> {
  return page.evaluate((key) => (window as unknown as { __toastSamples: Record<string, Sample[]> }).__toastSamples[key] || [], kind);
}

function restingLeft(samples: Sample[]) {
  return Math.min(...samples.map(([, left]) => left));
}

test('toasts slide in from the right and leave through the right edge', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAuthenticatedApp(page);
  await page.route('**/api/ingestion/all/runs*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Falla simulada de comparación' }) });
  });
  await page.goto('/pam');
  await page.getByRole('button', { name: 'Abrir menú de usuario' }).click();
  await recordToastMotion(page);
  await page.getByRole('button', { name: /Actualizar datos/ }).click();

  // The running sync toast enters from the right.
  const errorToast = page.getByRole('alert').filter({ hasText: 'Falla simulada de comparación' });
  await expect(errorToast).toBeVisible();
  const sync = await toastSamples(page, 'sync');
  expect(sync[0][1]).toBeGreaterThan(restingLeft(sync) + 200);

  // The error toast enters the same way and a manual dismissal slides it out
  // to the right before it unmounts.
  await expect.poll(async () => {
    const samples = await toastSamples(page, 'error');
    return samples.length > 5 && samples[samples.length - 1][1] === restingLeft(samples);
  }).toBe(true);
  await errorToast.getByRole('button', { name: 'Cerrar error' }).click();
  await expect(errorToast).toHaveCount(0);
  const error = await toastSamples(page, 'error');
  const errorRest = restingLeft(error);
  expect(error[0][1]).toBeGreaterThan(errorRest + 200);
  expect(error[error.length - 1][1]).toBeGreaterThan(errorRest + 50);
});

test('toasts only fade when the user prefers reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockAuthenticatedApp(page);
  await page.route('**/api/ingestion/all/runs*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Falla simulada' }) }));
  await page.goto('/pam');
  await page.getByRole('button', { name: 'Abrir menú de usuario' }).click();
  await page.getByRole('button', { name: /Actualizar datos/ }).click();
  const errorToast = page.getByRole('alert').filter({ hasText: 'Falla simulada' });
  await expect(errorToast).toBeVisible();
  await expect(errorToast).toHaveCSS('animation-name', 'toast-fade-in');
});

test('the elapsed time of the running sync toast keeps counting', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAuthenticatedApp(page);
  await page.route('**/api/ingestion/all/runs*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4500));
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Falla simulada de comparación' }) });
  });
  await page.goto('/pam');
  await page.getByRole('button', { name: 'Abrir menú de usuario' }).click();
  await page.getByRole('button', { name: /Actualizar datos/ }).click();
  const toast = page.locator('.sync-toast');
  await expect(toast).toContainText('Sincronización en progreso');
  // Regression: the timer once never started, so the text stayed on a stale value.
  await expect(toast).toContainText(/Activa hace [1-9]\d* s/, { timeout: 4000 });
});
