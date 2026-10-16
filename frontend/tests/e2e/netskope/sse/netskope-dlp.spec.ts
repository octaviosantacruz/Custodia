import AxeBuilder from '@axe-core/playwright';
import { expect, mockAuthenticatedApp, test } from '../../support/fixtures';

const DLP_PERMISSIONS = ['inventory:read', 'netskope:read', 'netskope:dlp_read'];

test('DLP alerts are listed by policy with volume, trend and mix, and no per-user column (NSK-DLP-001)', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: DLP_PERMISSIONS });
  await page.goto('/netskope/dlp');

  await expect(page.getByRole('heading', { name: 'Políticas que disparan alertas' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', test.info().project.name.includes('light') ? 'light' : 'dark');
  // FE-AUD-004: the fixture capture is old, so completeness is not presented as being up to date.
  await expect(page.getByText(/tiene más de 24 horas/).first()).toBeVisible();
  await expect(page.getByText('Captura al día')).toHaveCount(0);

  const table = page.locator('.netskope-dlp-table');
  const policyA = table.getByRole('row', { name: /Policy A/ });
  await expect(policyA.getByRole('cell', { name: '4', exact: true })).toBeVisible();
  await expect(policyA).toContainText('+200%');
  await expect(policyA).toContainText('High 3');
  await expect(table.getByRole('row', { name: /Policy B/ })).toContainText('−100%');
  await expect(page.getByText('1 alerta sin nombre de política no aparece en la tabla.')).toBeVisible();
  // The per-user view is gone: no user column, no "sin resolver" count.
  await expect(page.getByRole('columnheader', { name: 'Usuario' })).toHaveCount(0);
  await expect(page.getByText(/sin resolver/i)).toHaveCount(0);
  // No event artifact is presented or even named in the screen.
  const body = await page.locator('.netskope-dlp').innerText();
  for (const artifact of ['file_path', 'sha256', 'srcip', 'dlp_match_info', 'original_file']) {
    expect(body).not.toContain(artifact);
  }
  await expect(page.getByText('DS Hub no guarda archivo')).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).include('.netskope-dlp').analyze();
  expect(accessibility.violations).toEqual([]);
});

test('opening a policy shows only its few recent incidents, fetched for that policy', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: DLP_PERMISSIONS });
  const investigations: string[] = [];
  await page.route('**/api/cmdb/netskope/investigations*', async (route) => {
    investigations.push(route.request().url());
    await route.fallback();
  });
  await page.goto('/netskope/dlp');
  expect(investigations).toEqual([]);

  const toggle = page.getByRole('button', { name: 'Policy A' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => investigations.some((url) => url.includes('policy=Policy+A') && url.includes('limit=5'))).toBe(true);
  const incidents = page.getByRole('table', { name: 'Incidentes recientes de Policy A' });
  await expect(incidents.getByRole('cell', { name: '7', exact: true })).toBeVisible();
  await expect(incidents.getByRole('columnheader', { name: 'Usuario' })).toHaveCount(0);

  await toggle.click();
  await expect(incidents).toHaveCount(0);
});

test('the DLP screen shows an explicit error state and retries', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: DLP_PERMISSIONS });
  let failing = true;
  await page.route('**/api/cmdb/netskope/dlp/policies', async (route) => {
    if (failing) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Conteos no disponibles' }) });
      return;
    }
    await route.fallback();
  });
  await page.goto('/netskope/dlp');

  await expect(page.getByText('No se pudieron cargar las políticas DLP')).toBeVisible();
  await expect(page.locator('.state-block-hint')).toHaveText('Conteos no disponibles');
  failing = false;
  await page.getByRole('button', { name: 'Reintentar' }).first().click();
  await expect(page.getByRole('heading', { name: 'Políticas que disparan alertas' })).toBeVisible();
});

test('NSK-DLP-001 the DLP alerts workspace is not offered without the narrow permission', async ({ page }) => {
  // access:manage and netskope:read are present; netskope:dlp_read is not.
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read', 'access:manage'] });
  await page.goto('/netskope');
  await page.getByRole('button', { name: /Cambiar workspace/ }).click();
  await expect(page.getByText('Alertas DLP', { exact: true })).toHaveCount(0);
});

test('a denied Netskope deep link returns to an allowed Netskope view with a notice', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.goto('/netskope/dlp');

  await expect(page).toHaveURL(/\/netskope$/);
  await expect(page.getByRole('status').filter({ hasText: 'No tenés acceso a esta vista' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Métricas', exact: true })).toBeVisible();
});
