import { expect, mockAuthenticatedApp, test } from '../../support/fixtures';

const AA_METRIC = {
  source: 'advanced_analytics', state: 'ready', window_days: 30, timezone: 'UTC', scope: 'dlp', unit: 'incidents',
  buckets: [{ key: 'high', count: 12 }, { key: 'low', count: 3 }], total: 15,
  fetched_at: '2026-10-02T18:00:00Z', cache_expires_at: '2026-10-02T18:05:00Z',
};
const AA_PATH = '**/api/cmdb/netskope/aa/severity';
const PREFERENCES = { widgets: [{ id: 'alerts_by_severity', size: 'md', filters: {} }], is_default: false };

test('AA severity renders its saved period and aggregate without requesting local alert snapshots (UX-AUD2-009)', async ({ page }) => {
  const localAlertRequests: string[] = [];
  let aaRequests = 0;
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/api/cmdb/netskope/alerts' || path === '/api/cmdb/netskope/metrics' || path.includes('/investigations')) localAlertRequests.push(path);
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({ json: PREFERENCES }));
  await page.route(AA_PATH, (route) => { aaRequests += 1; return route.fulfill({ json: AA_METRIC }); });
  await page.goto('/netskope');
  const chart = page.locator('.netskope-alert-dimension');
  await expect(chart.getByText('Severidad DLP · Advanced Analytics')).toBeVisible();
  await expect(chart.getByText('Ventana guardada: últimos 30 días · UTC · Incidentes')).toBeVisible();
  await expect(chart.getByText(/15 incidentes · Consultado/)).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', test.info().project.name.includes('light') ? 'light' : 'dark');
  await expect(chart.locator('time[datetime="2026-10-02T18:00:00Z"]')).toHaveAttribute("title", /^hace /);
  await expect(chart.getByRole('button', { name: /Alta/ })).toBeVisible();
  await expect(chart.getByRole('img', { name: 'Distribución' })).toBeVisible();
  await expect(chart.locator('.pie-chart-total')).toHaveText('15');
  await expect(chart.locator('.pie-chart-total-label')).toHaveText('total');
  await expect(chart.locator('.pie-chart-legend-pct')).toHaveText(['80%', '20%']);
  expect(aaRequests).toBe(1);
  expect(localAlertRequests).toEqual([]);
});

test('a failed inventory projection leaves selected AA available and retries only SQL', async ({ page }) => {
  let sqlRequests = 0;
  let aaRequests = 0;
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({ json: {
    widgets: [{ id: 'devices_total', size: 'sm', filters: {} }, ...PREFERENCES.widgets], is_default: false,
  } }));
  await page.route('**/api/cmdb/netskope/metrics*', (route) => {
    sqlRequests++;
    return route.fulfill({ status: 503, json: { detail: 'Inventario temporalmente no disponible' } });
  });
  await page.route(AA_PATH, (route) => { aaRequests++; return route.fulfill({ json: AA_METRIC }); });
  await page.goto('/netskope');
  await expect(page.getByText('No se pudieron cargar las métricas de algunos bloques.')).toBeVisible();
  await expect(page.getByText('Severidad DLP · Advanced Analytics')).toBeVisible();
  await expect(page.locator('.netskope-alert-dimension .pie-chart-total')).toHaveText('15');
  expect(sqlRequests).toBe(1);
  expect(aaRequests).toBe(1);
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect.poll(() => sqlRequests).toBe(2);
  expect(aaRequests).toBe(1);
});

test('AA empty, unconfigured and failed states never display a local fallback or an invented zero', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({ json: PREFERENCES }));
  let state: 'empty' | 'not_configured' | 'pending_validation' | 'error' = 'empty';
  await page.route(AA_PATH, (route) => state === 'error'
    ? route.fulfill({ status: 502, json: { detail: 'AA temporalmente no disponible' } })
    : route.fulfill({ json: { ...AA_METRIC, state, buckets: [], total: null } }));
  await page.goto('/netskope');
  const chart = page.locator('.netskope-alert-dimension');
  await expect(chart.getByText('El widget AA no devolvió filas')).toBeVisible();
  await expect(chart.getByText(/0 incidentes/)).toHaveCount(0);
  await expect(chart.getByRole('img')).toHaveCount(0);
  state = 'not_configured';
  await page.reload();
  await expect(chart.getByText('Widget AA sin configurar')).toBeVisible();
  state = 'pending_validation';
  await page.reload();
  await expect(chart.getByText('Definición AA pendiente de validación')).toBeVisible();
  await expect(chart.getByRole('img')).toHaveCount(0);
  state = 'error';
  await page.reload();
  await expect(chart.getByText('No se pudo consultar Advanced Analytics')).toBeVisible();
  await expect(chart.getByRole('button', { name: 'Reintentar' })).toBeVisible();
  await expect(chart.getByRole('img')).toHaveCount(0);
});

test('AA is not requested when the severity widget is absent', async ({ page }) => {
  let aaRequests = 0;
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({ json: { widgets: [{ id: 'devices_by_os', size: 'md', filters: {} }], is_default: false } }));
  await page.route(AA_PATH, (route) => { aaRequests += 1; return route.fulfill({ json: AA_METRIC }); });
  await page.goto('/netskope');
  await expect(page.getByRole('region', { name: 'Mi panel de métricas Netskope', exact: true })).toBeVisible();
  await expect(page.getByText('Dispositivos por sistema operativo', { exact: true })).toBeVisible();
  expect(aaRequests).toBe(0);
});
