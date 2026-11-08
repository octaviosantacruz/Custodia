import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  mockAuthenticatedApp,
  PERSON_CLIENT_COVERAGE_DETAILS,
  test,
} from '../support/fixtures';
import type { PersonClientCoverageDetail } from '../../../src/cross/lib/chains-api';

// The client evidence lives in the Netskope panel: pick the Netskope node first.
const openNetskopeEvidence = async (page: import('@playwright/test').Page) => {
  await page.getByRole('group', { name: 'Herramientas de la persona' }).getByRole('button', { name: /^Netskope:/ }).click();
  await page.getByText('Evidencia del cliente Netskope', { exact: true }).click();
};

const selectPerson = async (page: import('@playwright/test').Page, query: string, name: RegExp) => {
  await page.getByRole('searchbox', { name: 'Buscar persona por correo o nombre' }).fill(query);
  await page.getByRole('option', { name }).click();
};

for (const theme of ['dark', 'light'] as const) {
  test(`retired client coverage redirects to Personas and preserves selected-person evidence in ${theme} theme (UX-AUD2-009)`, async ({ page }) => {
    await page.addInitScript((value) => window.localStorage.setItem('dshub-theme:v1', value), theme);
    const requests: string[] = [];
    await mockAuthenticatedApp(page, { onRequest: (path) => requests.push(path) });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/connections/coverage');
    await expect(page).toHaveURL(/\/chains\/person$/);
    await expect(page.getByRole('heading', { name: 'Personas', level: 1 })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await selectPerson(page, 'ada', /Ada Lovelace/);

    // The person view shows only the selected person's evidence, never the population summary.
    await expect(page.locator('.person-client-coverage')).toHaveCount(0);
    await openNetskopeEvidence(page);
    const detail = page.getByLabel('Detalle de cobertura de la persona seleccionada');
    await expect(detail).toContainText('ada@acme.example');
    await expect(detail).toContainText('Parcial');
    await expect(detail).toContainText('recientes 1 · no recientes / sin fecha 1');
    await expect(page).toHaveURL(/\/chains\/person$/);

    await selectPerson(page, 'riesgo', /Riesgo Parcial/);
    await openNetskopeEvidence(page);
    await expect(detail).toContainText('riesgo@acme.example');
    await expect(detail).toContainText('Por verificar');
    await expect(detail).toContainText('no hay una contraparte Netskope observada');
    await expect(detail).not.toContainText('ada@acme.example');

    expect(requests).not.toContain('/api/chains/person/coverage');
    await page.getByRole('button', { name: /Cambiar workspace/ }).click();
    const menu = page.getByRole('region', { name: 'Workspaces' });
    await expect(menu.getByRole('link', { name: /^Cobertura de cliente\b/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Abrir command center' }).click();
    const dialog = page.getByRole('dialog', { name: 'Command center' });
    await dialog.getByRole('combobox').fill('Cobertura de cliente');
    await expect(dialog.getByRole('option').filter({ hasText: 'Cobertura de cliente' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    const accessibility = await new AxeBuilder({ page })
      .include('.person-connection-evidence')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(accessibility.violations.map((violation) => violation.id), `CONN-001 axe ${theme}`).toEqual([]);
  });
}

test('CONN-UX-001 presents stale-source causes from the selected detail snapshot', async ({ page }) => {
  const baselineDetail = PERSON_CLIENT_COVERAGE_DETAILS['ada@acme.example'] as PersonClientCoverageDetail;
  const staleNetskopeDetail: PersonClientCoverageDetail = {
    ...baselineDetail,
    status: 'unknown',
    explanation: 'La evidencia individual no alcanza para clasificar a esta persona.',
    sources: {
      identity: { ...baselineDetail.sources.identity, freshness: 'fresh' },
      netskope: {
        ...baselineDetail.sources.netskope,
        run_id: 'netskope-stale-detail-run-fixture',
        freshness: 'stale',
        age_hours: 36,
      },
    },
  };

  await mockAuthenticatedApp(page);
  await page.route('**/api/chains/person/coverage/detail**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(staleNetskopeDetail),
  }));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/chains/person');
  const search = page.getByRole('searchbox', { name: 'Buscar persona por correo o nombre' });
  await search.fill('ada');
  await page.getByRole('option', { name: /Ada Lovelace/ }).click();
  await openNetskopeEvidence(page);
  const detail = page.getByLabel('Detalle de cobertura de la persona seleccionada');
  await expect(detail).toContainText('Por verificar');
  await expect(detail).toContainText('No se puede determinar: Netskope desactualizada.');
  await expect(detail).not.toContainText('Identity Administration desactualizada');
});

test('CONN-001 does not request coverage with Identity-only permission', async ({ page }) => {
  const requests: string[] = [];
  await mockAuthenticatedApp(page, {
    permissions: ['identity:catalogs_read'], onRequest: (pathname) => requests.push(pathname),
  });
  await page.goto('/chains/person');
  await selectPerson(page, 'ada', /Ada Lovelace/);
  await expect(page.getByRole('heading', { name: /Personas/, level: 1 })).toBeVisible();
  expect(requests.filter((path) => path.includes('/api/chains/person/coverage'))).toEqual([]);
  // The retired URL follows the same per-source permission boundary.
  await page.goto('/connections/coverage');
  await expect(page).toHaveURL(/\/chains\/person$/);
  expect(requests.filter((path) => path.includes('/api/chains/person/coverage'))).toEqual([]);
});

test('CONN-001 does not request coverage with Netskope-only permission', async ({ page }) => {
  const requests: string[] = [];
  await mockAuthenticatedApp(page, {
    permissions: ['netskope:read'], onRequest: (pathname) => requests.push(pathname),
  });
  await page.goto('/chains/person');
  await selectPerson(page, 'ada', /Ada Lovelace/);
  await expect(page.getByRole('heading', { name: /Personas/, level: 1 })).toBeVisible();
  expect(requests.filter((path) => path.includes('/api/chains/person/coverage'))).toEqual([]);
});

test('CONN-001 keeps a visible retry when the selected-person detail request fails', async ({ page }) => {
  let failures = 1;
  await mockAuthenticatedApp(page);
  await page.route('**/api/chains/person/coverage/detail**', async (route) => {
    if (failures-- > 0) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Error temporal' }) });
      return;
    }
    await route.fallback();
  });
  await page.goto('/chains/person');
  await selectPerson(page, 'ada', /Ada Lovelace/);

  await openNetskopeEvidence(page);
  const detail = page.getByLabel('Detalle de cobertura de la persona seleccionada');
  await expect(detail.getByText('No se pudo cargar el detalle', { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Reintentar detalle' }).click();
  await expect(detail).toContainText('ada@acme.example');
  await expect(detail.getByText('No se pudo cargar el detalle', { exact: true })).toHaveCount(0);
});
