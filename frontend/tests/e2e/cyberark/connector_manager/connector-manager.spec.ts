import AxeBuilder from '@axe-core/playwright';
import { expect, mockAuthenticatedApp, test } from '../../support/fixtures';

const evidence = { source_system: 'cyberark_connector_manager', queried_at: '2026-10-19T12:00:00Z' };
const pools = Array.from({ length: 52 }, (_, index) => ({
  id: `pool-${index + 1}`, name: `Pool ${index + 1}`, description: 'Acceso operativo',
  assigned_network_count: 1, identifiers_count: index === 1 ? null : 0,
  platform_connectors_count: 2, access_connectors_count: 0,
  created_at: null, updated_at: '2026-10-18T12:00:00Z',
}));

for (const theme of ['dark', 'light']) {
  test(`CMGR-001 ${theme}: independent catalogs, live evidence, search and progressive rows`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('custodia-theme:v1', value), theme);
    await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'pam:catalogs_read'] });
    const calls: string[] = [];
    await page.route('**/api/connector-manager/*', async (route) => {
      calls.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      const isPools = route.request().url().endsWith('/pools');
      await route.fulfill({ json: { ...evidence, catalog: isPools ? 'pools' : 'networks', rows: isPools ? pools : [{
        id: 'network-1', name: 'Red de operaciones', assigned_pool_count: null, created_at: null, updated_at: null,
      }], total: isPools ? 52 : 1 } });
    });
    await page.goto('/pam/connectors');
    await expect(page.getByRole('searchbox', { name: 'Buscar conectores PSM' })).toBeVisible();
    expect(calls).toEqual([]);
    await page.getByRole('button', { name: 'Elegir inventario de conectores' }).click();
    await page.getByRole('option', { name: 'Pools · Connector Manager', exact: true }).click();
    const catalog = page.getByRole('region', { name: 'Inventario de Connector Manager' });
    await expect(catalog.locator('tbody tr')).toHaveCount(50);
    await expect(page.getByRole('heading', { name: 'Conectores', exact: true })).toBeVisible();
    await expect(page.locator('.pam-connectors-table')).toHaveCount(0);
    await expect(catalog.locator('header time')).toHaveAttribute('datetime', evidence.queried_at);
    await expect(catalog.getByRole('rowheader', { name: 'Pool 1', exact: true }).locator('..').getByRole('cell').nth(2)).toHaveText('0');
    await expect(catalog.getByRole('rowheader', { name: 'Pool 2', exact: true }).locator('..').getByRole('cell').nth(2)).toHaveText('Sin dato');
    await catalog.getByRole('button', { name: 'Cargar 2 más', exact: true }).click();
    await expect(catalog.locator('tbody tr')).toHaveCount(52);
    await catalog.getByRole('searchbox', { name: 'Buscar pools de Connector Manager' }).fill('Pool 52');
    await expect(catalog.locator('tbody tr')).toHaveCount(1);
    await expect(catalog.getByRole('rowheader', { name: 'Pool 52', exact: true })).toBeVisible();
    await catalog.getByRole('searchbox').fill('no existe');
    await expect(catalog.getByText('Sin resultados para esta búsqueda')).toBeVisible();
    await catalog.getByRole('button', { name: 'Limpiar búsqueda', exact: true }).click();
    await expect(catalog.locator('tbody tr')).toHaveCount(50);
    await catalog.getByRole('button', { name: 'Elegir inventario de conectores' }).click();
    await page.getByRole('option', { name: 'Redes · Connector Manager', exact: true }).click();
    await expect(catalog.getByRole('table', { name: 'Redes de Connector Manager' })).toBeVisible();
    await expect(catalog.getByRole('rowheader', { name: 'Red de operaciones' })).toBeVisible();
    await expect(catalog).not.toContainText('Pool 52');
    await expect(catalog.getByRole('rowheader', { name: 'Red de operaciones' }).locator('..').getByRole('cell').first()).toHaveText('Sin dato');
    expect(calls).toEqual(['GET /api/connector-manager/pools', 'GET /api/connector-manager/networks']);
    expect((await new AxeBuilder({ page }).include('.connector-manager-catalog').analyze()).violations).toEqual([]);
    await catalog.getByRole('button', { name: 'Elegir inventario de conectores' }).click();
    await page.getByRole('option', { name: 'SIA', exact: true }).click();
    await expect(page.getByRole('searchbox', { name: 'Buscar conectores SIA' })).toBeVisible();
  });
}

test('CMGR-001 failed reads stay unknown, retry distinguishes an empty catalog and manual refresh replaces evidence', async ({ page }) => {
  await mockAuthenticatedApp(page);
  let attempts = 0;
  await page.route('**/api/connector-manager/pools', async (route) => {
    attempts += 1;
    if (attempts === 1) return route.fulfill({ status: 502, json: { detail: 'No se pudo consultar el catálogo completo de Connector Manager.' } });
    return route.fulfill({ json: { ...evidence, queried_at: attempts === 2 ? evidence.queried_at : '2026-10-19T13:00:00Z', catalog: 'pools', rows: attempts === 2 ? [] : [pools[0]], total: attempts === 2 ? 0 : 1 } });
  });
  await page.goto('/pam/connectors');
  await page.getByRole('button', { name: 'Elegir inventario de conectores' }).click();
  await page.getByRole('option', { name: 'Pools · Connector Manager', exact: true }).click();
  const catalog = page.getByRole('region', { name: 'Inventario de Connector Manager' });
  await expect(catalog.getByText('No se pudo consultar Connector Manager', { exact: true })).toBeVisible();
  await expect(catalog.locator('.database-toolbar-count')).toHaveText('Sin dato');
  await expect(catalog.getByRole('table')).toHaveCount(0);
  await catalog.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(catalog.getByText('Connector Manager no informó pools')).toBeVisible();
  await expect(catalog.locator('.database-toolbar-count')).toHaveText('0 pools');
  await catalog.getByRole('button', { name: 'Consultar ahora', exact: true }).click();
  await expect(catalog.getByRole('rowheader', { name: 'Pool 1', exact: true })).toBeVisible();
  await expect(catalog.locator('header time')).toHaveAttribute('datetime', '2026-10-19T13:00:00Z');
});
