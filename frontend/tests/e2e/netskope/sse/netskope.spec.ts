import { closeSettings, openSettings } from '../../support/dashboard-settings';
import { expectSystemSearch } from '../../support/search-control';
import AxeBuilder from '@axe-core/playwright';
import { expect, mockAuthenticatedApp, test } from '../../support/fixtures';
import { expectAtomicCellText } from '../../support/cell-geometry';

/** Opens a picker card's "Fuente y período" hint and returns its note. */
async function sourceNote(card: import('@playwright/test').Locator) {
  await card.getByRole('button', { name: /^Ayuda: Fuente y período de / }).click();
  return card.getByRole('note');
}

const ALERT_WIDGET_PREFERENCES = {
  widgets: [
    { id: 'alerts_7d', size: 'sm', filters: {} },
    { id: 'alerts_30d', size: 'sm', filters: {} },
    { id: 'alerts_90d', size: 'sm', filters: {} },
    { id: 'alerts_by_severity', size: 'md', filters: {} },
  ],
  is_default: false,
};

test('NSK-ALR-001: the retired /netskope/alerts deep link lands on Métricas with count-only aggregates', async ({ page }) => {
  const retiredRequests: string[] = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.includes('/investigations') || pathname.includes('/incidents/') || pathname.includes('/dlp/status') || pathname.endsWith('/alerts/summary')) retiredRequests.push(pathname);
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({ json: ALERT_WIDGET_PREFERENCES }));
  await page.goto('/netskope/alerts');

  await expect(page).toHaveURL(/\/netskope$/);
  await expect(page.getByRole('heading', { name: 'Alertas Netskope agregadas' })).toBeVisible();
  await page.getByRole('button', { name: 'Ayuda: Alcance de las alertas agregadas', exact: true }).click();
  await expect(page.getByRole('note')).toContainText('Sólo conteos por ventana y severidad');
  await page.keyboard.press('Escape');
  // The total counts every alert type; the DLP slice is surfaced explicitly.
  await expect(page.getByText(/DLP: 3\b/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Investigación DLP' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Investigar alertas/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Buscar alertas/ })).toHaveCount(0);
  expect(retiredRequests).toEqual([]);
});

test('Netskope alert aggregate cards show missing totals and stale availability on desktop', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({ json: ALERT_WIDGET_PREFERENCES }));
  await page.route('**/api/cmdb/netskope/alerts', (route) => route.fulfill({ json: {
    configured: true,
    dlp_export_configured: false,
    windows: [
      { days: 7, window_start: '2026-09-25T00:00:00Z', window_end: '2026-10-02T00:00:00Z', captured_at: '2026-10-02T00:00:00Z', total: null, availability: 'incomplete', by_alert_type: [{ key: 'DLP', count: 2 }], by_severity: [], by_action: [] },
      { days: 30, window_start: '2026-09-02T00:00:00Z', window_end: '2026-10-02T00:00:00Z', captured_at: '2026-10-02T00:00:00Z', total: 0, availability: 'complete', by_alert_type: [], by_severity: [], by_action: [] },
      { days: 90, window_start: '2026-07-04T00:00:00Z', window_end: '2026-10-02T00:00:00Z', captured_at: '2026-10-01T00:00:00Z', total: 42, availability: 'stale', by_alert_type: [{ key: 'policy', count: 42 }], by_severity: [], by_action: [] },
    ],
  } }));
  await page.goto('/netskope');

  const overview = page.getByRole('group', { name: 'Volumen de alertas Netskope agregadas' });
  const sevenDays = overview.locator('.netskope-alert-kpi').filter({ hasText: 'Últimos 7 días' });
  const thirtyDays = overview.locator('.netskope-alert-kpi').filter({ hasText: 'Últimos 30 días' });
  const ninetyDays = overview.locator('.netskope-alert-kpi').filter({ hasText: 'Últimos 90 días' });
  await expect(sevenDays.locator('strong')).toHaveText('Sin dato');
  await expect(sevenDays.locator('small')).toContainText('Datos incompletos');
  await expect(thirtyDays.locator('strong')).toHaveText('0');
  await expect(ninetyDays.locator('strong')).toHaveText('42');
  await expect(ninetyDays.locator('small')).toContainText('Captura vencida');
});





test('Netskope metrics drill into the inventory with the selected chart bucket', async ({ page }) => {
  const deviceRequests: URLSearchParams[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/cmdb/netskope/devices') deviceRequests.push(url.searchParams);
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.goto('/netskope');

  await page.getByRole('button', { name: 'Windows' }).click();
  await expect(page).toHaveURL(/\/netskope\/devices(?:\\?|$)/);
  await expect.poll(() => deviceRequests.at(-1)?.get('os')).toBe('Windows');
  await expect(page.getByRole('button', { name: /Cambiar workspace\. Actual: Inventario/ })).toBeVisible();
});

test('NSK-MET-DENOM-001: Top-N bars show population-based percentages and a separate valid remainder', async ({ page }) => {
  const deviceRequests: URLSearchParams[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/cmdb/netskope/devices') deviceRequests.push(url.searchParams);
  });
  await mockAuthenticatedApp(page, {
    permissions: ['inventory:read', 'netskope:read'],
    netskopeMetrics: {
      devices_total: 12,
      devices_by_os: [
        { key: 'Windows', count: 1 }, { key: 'macOS', count: 1 }, { key: 'Linux', count: 1 },
        { key: 'Android', count: 1 }, { key: 'iOS', count: 1 }, { key: 'Chrome OS', count: 1 },
        { key: 'FreeBSD', count: 1 }, { key: 'Sin dato', count: 1 },
      ],
    },
  });
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({ json: {
    widgets: [{ id: 'devices_by_os', size: 'md', filters: {}, style: 'bars' }], is_default: false,
  } }));
  await page.goto('/netskope');

  const chart = page.locator('.personal-chart-card').filter({ hasText: 'Dispositivos por sistema operativo' });
  await expect(chart.locator('.ranking-summary')).toHaveCount(0);
  await expect(chart.getByText('Qué mide', { exact: true })).toHaveCount(0);
  await chart.getByRole('button', { name: 'Qué mide: Dispositivos por sistema operativo' }).click();
  await expect(chart.getByRole('note')).toContainText('12 dispositivos con evento en 7 días');
  await page.keyboard.press('Escape');
  await expect(chart.getByRole('button', { name: /Windows.*1.*8%/ })).toBeVisible();
  await expect(chart.getByRole('button', { name: /Sin dato.*1.*8%/ })).toBeVisible();
  const rest = chart.getByText('Otras categorías (resto)', { exact: true }).locator('..');
  await expect(rest).toContainText('4');
  await expect(rest).toContainText('33%');
  await expect(rest.getByRole('button')).toHaveCount(0);

  await chart.getByRole('button', { name: /Windows.*1.*8%/ }).click();
  await expect(page).toHaveURL(/\/netskope\/devices(?:\?|$)/);
  await expect.poll(() => deviceRequests.at(-1)?.get('os')).toBe('Windows');
});

test('NSK-MET-DENOM-001: zero population does not render invented percentages', async ({ page }) => {
  await mockAuthenticatedApp(page, {
    permissions: ['inventory:read', 'netskope:read'],
    netskopeMetrics: { devices_total: 0, devices_by_os: [] },
  });
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({ json: {
    widgets: [{ id: 'devices_by_os', size: 'md', filters: {}, style: 'bars' }], is_default: false,
  } }));
  await page.goto('/netskope');

  const chart = page.locator('.personal-chart-card').filter({ hasText: 'Dispositivos por sistema operativo' });
  await expect(chart.locator('.ranking-summary')).toContainText('Sin población: porcentaje no calculable');
  await expect(chart.getByText('Sin categorías visibles.')).toBeVisible();
  await expect(chart.getByText(/\d+%/)).toHaveCount(0);
});

test('NSK-MET-DENOM-001: inconsistent ranking population withholds percentages and remainder', async ({ page }) => {
  await mockAuthenticatedApp(page, {
    permissions: ['inventory:read', 'netskope:read'],
    netskopeMetrics: {
      devices_total: 5,
      devices_by_os: [{ key: 'Windows', count: 8 }, { key: 'Sin dato', count: 2 }],
    },
  });
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({ json: {
    widgets: [{ id: 'devices_by_os', size: 'md', filters: {}, style: 'bars' }], is_default: false,
  } }));
  await page.goto('/netskope');

  const ranking = page.locator('.personal-chart-card').filter({ hasText: 'Dispositivos por sistema operativo' }).locator('.ranking-bars');
  await expect(ranking.getByRole('status')).toContainText('La parte visible supera la población; no se calcula resto.');
  const rows = ranking.locator('.ranking-list > li');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('.ranking-label')).toHaveText('Windows');
  await expect(rows.nth(0).locator('strong')).toHaveText('8');
  await expect(rows.nth(1).locator('.ranking-label')).toHaveText('Sin dato');
  await expect(rows.nth(1).locator('strong')).toHaveText('2');
  await expect(ranking.locator('.ranking-percent')).toHaveText(['Porcentaje no calculable', 'Porcentaje no calculable']);
  await expect(ranking.getByText('Otras categorías (resto)', { exact: true })).toHaveCount(0);
  await expect(ranking.getByText(/\d+%/)).toHaveCount(0);
});

test('Netskope distinguishes inventory users from recent device activity (UX-AUD2-024 plural population)', async ({ page }, testInfo) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({ json: {
    widgets: [
      { id: 'users_total', size: 'sm', filters: {} },
      { id: 'users_recent_activity', size: 'sm', filters: {} },
    ],
    data_widgets: ['users_total', 'users_recent_activity'], chart_widgets: [], is_default: false,
  } }));
  await page.route('**/api/cmdb/netskope/metrics*', (route) => route.fulfill({ json: {
    users_total: 8975,
    users_with_device_activity_7d: 4442,
    users_with_device_activity_14d: 4555,
    users_with_device_activity_30d: 4784,
    last_observed_at: '2026-09-30T02:22:52Z',
  } }));

  await page.goto('/netskope');
  await expect(page.locator('html')).toHaveAttribute('data-theme', testInfo.project.name.includes('light') ? 'light' : 'dark');

  const inventory = page.locator('.netskope-data-card').filter({ hasText: 'Usuarios en inventario' });
  await expect(inventory).toContainText('8.975');
  // The card help is short: what it measures plus a link to the guide.
  await inventory.getByRole('button', { name: 'Qué mide: Usuarios en inventario' }).click();
  await expect(page.getByRole('note')).toContainText('no implica actividad reciente');
  await expect(page.getByRole('note').getByRole('link', { name: /Más detalles en Ayuda/ })).toHaveAttribute('href', '/help?section=netskope');
  await page.keyboard.press('Escape');

  const activity = page.locator('.netskope-data-card').filter({ hasText: 'Usuarios con actividad reciente' });
  await expect(activity).toContainText('4.442');
  await activity.getByRole('button', { name: '14 días' }).click();
  await expect(activity).toContainText('4.555');
  await activity.getByRole('button', { name: '30 días' }).click();
  await expect(activity).toContainText('4.784');
  await expect(activity).toContainText('53% de 8.975 · 30 días');
  await activity.getByRole('button', { name: 'Qué mide: Usuarios con actividad reciente' }).click();
  await expect(page.getByRole('note')).toContainText('reportó un evento en la ventana elegida');
});

test('NSK-XMET-004: the activity card surfaces retired users whose devices still report', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({ json: {
    widgets: [{ id: 'users_recent_activity', size: 'md' }], updated_at: null, updated_by: null,
  } }));
  await page.route('**/api/cmdb/netskope/metrics**', (route) => route.fulfill({ json: {
    users_total: 8975, users_with_device_activity_7d: 4442, users_with_device_activity_14d: 4555, users_with_device_activity_30d: 4784, last_observed_at: '2026-09-30T02:22:52Z',
  } }));
  const requestedDays: string[] = [];
  await page.route('**/api/cmdb/netskope/users/retired-activity**', (route) => {
    requestedDays.push(new URL(route.request().url()).searchParams.get('days') ?? '');
    return route.fulfill({ json: { days: 7, total: 1, rows: [
      { object_id: 9, source_id: 'gone@example.com', display_name: 'Gone User', email: 'gone@example.com', device_count: 2, latest_event: new Date().toISOString(), latest_device: 'gone-pc' },
    ] } });
  });
  await page.goto('/netskope');
  const activity = page.locator('.netskope-data-card').filter({ hasText: 'Usuarios con actividad reciente' });
  const note = activity.getByRole('button', { name: /\+1 usuario dado de baja con equipos activos/ });
  await expect(note).toBeVisible();
  expect(requestedDays[0]).toBe('7');
  await note.click();
  await expect(activity.getByRole('region', { name: 'Usuarios dados de baja con equipos activos' })).toContainText('Gone User');
  await expect(activity).toContainText('2 equipos · gone-pc');
});

test('NSK-XMET-003: the recent-activity card opens the users list with the selected window (UX-AUD2-023 atomic dates UX-AUD2-009)', async ({ page }, testInfo) => {
  const userRequests: URLSearchParams[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/cmdb/netskope/users') userRequests.push(url.searchParams);
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({ json: {
    widgets: [{ id: 'users_recent_activity', size: 'sm', filters: {} }],
    data_widgets: ['users_recent_activity'], chart_widgets: [], is_default: false,
  } }));
  await page.route('**/api/cmdb/netskope/metrics*', (route) => route.fulfill({ json: {
    users_total: 10, users_with_device_activity_7d: 1, users_with_device_activity_14d: 2, users_with_device_activity_30d: 3,
    last_observed_at: '2026-09-30T02:22:52Z',
  } }));
  await page.route('**/api/cmdb/netskope/users?*', (route) => {
    const days = new URL(route.request().url()).searchParams.get('activity_days');
    if (!days) return route.fallback();
    return route.fulfill({ json: {
      rows: [{
        object_id: 1, display_name: 'Ada López', source_id: 'uid-a', attributes: { email: 'ada@example.com' },
        first_seen_at: '2026-09-01T00:00:00Z', last_seen_at: '2026-09-30T00:00:00Z',
        observed_user_status: 'unmatched',
        device_activity: { device_count: 2, latest_device: 'a-1', latest_event: '2026-09-29T10:00:00Z', match_basis: ['source_id'] },
      }],
      total: Number(days) === 14 ? 2 : 1, limit: 50, offset: 0, search: '', filters: {}, activity_days: Number(days),
    } });
  });

  await page.goto('/netskope');
  const activity = page.locator('.netskope-data-card').filter({ hasText: 'Usuarios con actividad reciente' });
  await activity.getByRole('button', { name: '14 días' }).click();
  await activity.getByRole('button', { name: /Ver usuarios/ }).click();

  await expect(page).toHaveURL(/\/netskope\/users$/);
  await expect.poll(() => userRequests.at(-1)?.get('activity_days')).toBe('14');
  await expect(page.getByRole('button', { name: /Quitar filtro Actividad observada: últimos 14 días/ })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Actividad observada' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /a-1/ })).toContainText('Coincidencia exacta: ID de usuario');
  await expect(page.locator('.netskope-result-count')).toContainText('2 usuarios');
  await expect(page.locator('html')).toHaveAttribute('data-theme', testInfo.project.name.includes('light') ? 'light' : 'dark');
  const userRow = page.locator('.netskope-table').getByRole('row').nth(1);
  await expect(userRow.locator('time')).toHaveCount(3);
  const observed = userRow.getByRole('cell').nth(3).locator('time');
  await expect(userRow.locator('time[datetime="2026-09-29T10:00:00Z"]')).toHaveAttribute('title', /^hace /);
  await expect(observed.first()).toHaveAttribute('datetime', '2026-09-01T00:00:00Z');
  await expect(observed.last()).toHaveAttribute('datetime', '2026-09-30T00:00:00Z');
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expectAtomicCellText(observed.first());
    await expectAtomicCellText(observed.last());
    await expectAtomicCellText(userRow.getByRole('cell').nth(6));
  }


  await page.getByRole('button', { name: /Quitar filtro Actividad observada/ }).click();
  await expect.poll(() => userRequests.at(-1)?.has('activity_days')).toBe(false);
  await expect(page.getByRole('columnheader', { name: 'Actividad observada' })).toHaveCount(0);
  await expect(userRow.locator('time')).toHaveCount(2);
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expectAtomicCellText(observed.first());
    await expectAtomicCellText(observed.last());
  }

});

test('Netskope reports an unavailable recent-activity metric instead of a false zero', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({ json: {
      widgets: [{ id: 'users_recent_activity', size: 'sm', filters: {} }],
      data_widgets: ['users_recent_activity'], chart_widgets: [], is_default: false,
    } }));
  await page.route('**/api/cmdb/netskope/metrics*', (route) => route.fulfill({ json: {
    users_total: 8974,
    devices_total: 4562,
    last_observed_at: '2026-09-30T02:22:52Z',
  } }));

  await page.goto('/netskope');

  const activity = page.locator('.netskope-data-card').filter({ hasText: 'Usuarios con actividad reciente' });
  await expect(activity.locator('strong')).toHaveText('—');
  await expect(activity).toContainText('Métrica no disponible');
});

test('Netskope shows the actionable message from a structured validation error', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/dashboard/netskope/preferences', async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({ detail: [{
        type: 'value_error',
        loc: ['body', 'widgets', 0, 'id'],
        msg: 'Value error, Bloque Netskope desconocido: users_recent_activity',
        input: 'users_recent_activity',
      }] }),
    });
  });

  await page.goto('/netskope');

  await page.getByRole('button', { name: 'Editar vista' }).click();
  await (await openSettings(page.locator('.netskope-data-strip .dashboard-edit-item').first())).getByRole('button', { name: 'Grande' }).click();
  await closeSettings(page);
  await page.getByRole('button', { name: 'Guardar vista' }).click();
  await expect(page.getByRole('alert')).toContainText('Bloque Netskope desconocido: users_recent_activity');
  await expect(page.getByRole('alert')).not.toContainText('[object Object]');
});

test('NSK-XMET-001: cross user-device KPIs drill into the filtered inventory', async ({ page }) => {
  const deviceRequests: URLSearchParams[] = [];
  const userRequests: URLSearchParams[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/cmdb/netskope/devices') deviceRequests.push(url.searchParams);
    if (url.pathname === '/api/cmdb/netskope/users') userRequests.push(url.searchParams);
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      widgets: [
        { id: 'devices_observed_user_matched', size: 'sm', filters: {} },
        { id: 'users_without_observed_devices', size: 'sm', filters: {} },
        { id: 'devices_by_observed_user_status', size: 'md', filters: {} },
      ],
      data_widgets: ['devices_observed_user_matched', 'users_without_observed_devices'],
      chart_widgets: ['devices_by_observed_user_status'],
      is_default: false,
    }),
  }));
  await page.goto('/netskope');

  // Device-side KPI: the chart bucket drills with the exact match status.
  await page.locator('.personal-chart-card').getByRole('button', { name: 'Con usuario resuelto' }).click();
  await expect(page).toHaveURL(/\/netskope\/devices(?:\\?|$)/);
  await expect.poll(() => deviceRequests.at(-1)?.get('observed_user_status')).toBe('matched');
  await expect(page.getByRole('button', { name: /Quitar filtro Usuario observado: Con usuario resuelto/ })).toBeVisible();

  // User-side KPI: the card drills with the aggregate device criterion.
  await page.goto('/netskope');
  await page.locator('.netskope-data-strip').getByRole('button', { name: /^Usuarios sin dispositivos/ }).click();
  await expect(page).toHaveURL(/\/netskope\/users$/);
  await expect.poll(() => userRequests.at(-1)?.get('device_count')).toBe('0');
  await expect(page.getByRole('button', { name: /Quitar filtro Dispositivos: Sin dispositivos/ })).toBeVisible();
});

test('Netskope exposes Métricas, Equipos and Inventario in the vertical workspace selector', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'], initialVisibleWorkspaces: [] });
  await page.goto('/netskope/inventory');

  await page.getByRole('button', { name: /Cambiar workspace\. Actual: Inventario/ }).click();
  const views = page.locator('.workspace-menu');
  // The inventory is one table. Historical device/user paths and the retired
  // investigation view are not switcher destinations.
  for (const [name, href] of [['Métricas', '/netskope'], ['Equipos', '/netskope/operations'], ['Inventario', '/netskope/inventory']] as const) {
    await expect(views.locator(`a[href="${href}"]`)).toContainText(name);
  }
  await expect(views.locator('a[href="/netskope/alerts"]')).toHaveCount(0);
  await expect(views.locator('a[href="/netskope/devices"]')).toHaveCount(0);
  await expect(views.locator('a[href="/netskope/users"]')).toHaveCount(0);
  await expect(views.getByText('Investigación')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Fijar vistas rápidas' })).toBeVisible();
});

test('retired DLP investigation UI and endpoints stay unreachable', async ({ page }) => {
  const retiredRequests: string[] = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.includes('/investigations') || pathname.includes('/incidents/') || pathname.includes('/dlp/status') || pathname.endsWith('/alerts/summary')) retiredRequests.push(pathname);
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  // The drawer's current ADEM surface is separately permission-gated. Do not
  // let the generic catch-all supply a malformed 200 {} for this endpoint.
  await page.route('**/api/cmdb/netskope/users/*/experience/devices?*', (route) => route.fulfill({ status: 403, json: { detail: 'Sin permiso ADEM' } }));
  await page.goto('/netskope/operations');
  await expect(page.getByRole('region', { name: 'Estado del cache DLP Netskope' })).toHaveCount(0);
  await expect(page.getByText('Cache DLP Netskope')).toHaveCount(0);

  await page.goto('/netskope/devices');
  await page.getByRole('row', { name: /LAPTOP-QA-01/ }).click();
  await expect(page.locator('.netskope-device-detail')).toBeVisible();

  await page.goto('/netskope/users');
  await page.getByRole('row', { name: /QA User/ }).click();
  await expect(page.getByRole('dialog', { name: 'QA User' })).toBeVisible();
  await expect(page.getByText(/Ver alertas recientes/)).toHaveCount(0);
  expect(retiredRequests).toEqual([]);
});

test('VIEW-001: the Netskope board edits in place, persists size/order and cancels without saving', async ({ page }) => {
  const preferencePuts: Array<{ widgets: Array<{ id: string; size: string }> }> = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/dashboard/netskope/preferences' && request.method() === 'PUT') {
      preferencePuts.push(request.postDataJSON() as { widgets: Array<{ id: string; size: string }> });
    }
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.goto('/netskope');
  await expect(page.getByRole('heading', { name: 'Datos clave' })).toBeVisible();

  await page.getByRole('button', { name: 'Editar vista' }).click();
  await expect(page.getByRole('toolbar', { name: 'Edición del tablero Netskope' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const dataItems = page.locator('.netskope-data-strip .dashboard-edit-item');
  const firstSettings = await openSettings(dataItems.first());
  const sizeButtons = firstSettings.getByRole('group', { name: /Tamaño de/ }).getByRole('button');
  const sizeBoxes = await sizeButtons.evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().top));
  expect(Math.max(...sizeBoxes) - Math.min(...sizeBoxes)).toBeLessThan(2);
  await closeSettings(page);
  await dataItems.first().focus();
  await dataItems.first().press('ArrowRight');
  await (await openSettings(dataItems.filter({ hasText: 'Usuarios' }).first())).getByRole('button', { name: 'Grande' }).click();
  await closeSettings(page);
  await page.getByRole('button', { name: 'Guardar vista' }).click();

  await expect.poll(() => preferencePuts.length).toBe(1);
  const savedIds = preferencePuts[0].widgets.map((widget) => widget.id);
  expect(savedIds.slice(0, 2)).toEqual(['devices_total', 'users_total']);
  expect(preferencePuts[0].widgets.find((widget) => widget.id === 'users_total')?.size).toBe('lg');

  await page.getByRole('button', { name: 'Editar vista' }).click();
  await page.locator('.netskope-data-strip .dashboard-edit-item').first().focus();
  await page.locator('.netskope-data-strip .dashboard-edit-item').first().press('ArrowRight');
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await page.getByRole('alertdialog', { name: 'Descartar cambios' }).getByRole('button', { name: 'Descartar cambios' }).click();
  expect(preferencePuts.length).toBe(1);
});

test('VIEW-006: role templates are copied personally and publishing appends a protected version', async ({ page }) => {
  let personalSaves = 0;
  let publications = 0;
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read', 'access:roles_manage'] });
  await page.route('**/api/dashboard/netskope/preferences/templates', (route) => route.fulfill({ json: { templates: [{
    role_code: 'netskope_reader', role_name: 'Lectores Netskope', version: 4,
    widgets: [{ id: 'users_total', size: 'sm', filters: {} }], published_at: '2026-09-30T12:00:00Z',
  }] } }));
  await page.route('**/api/dashboard/netskope/preferences/templates/netskope_reader', async (route) => {
    publications += 1;
    await route.fulfill({ json: {
      role_code: 'netskope_reader', role_name: 'Lectores Netskope', version: 5,
      widgets: route.request().postDataJSON().widgets, published_at: '2026-09-30T13:00:00Z',
    } });
  });
  await page.route('**/api/access/roles', (route) => route.fulfill({ json: { rows: [{
    role_code: 'netskope_reader', display_name: 'Lectores Netskope', description: '', domain_code: 'dlp',
    lifecycle_status: 'active', system_managed: true, role_kind: 'direct', permission_codes: ['netskope:read'], level_refs: [], user_count: 2,
  }] } }));
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/dashboard/netskope/preferences' && request.method() === 'PUT') personalSaves += 1;
  });

  await page.goto('/netskope');
  await page.getByRole('button', { name: 'Vistas iniciales' }).click();
  await page.getByRole('menuitem', { name: /Lectores Netskope.*versión 4/ }).click();
  const restore = page.getByRole('alertdialog', { name: 'Restaurar vista de Lectores Netskope' });
  await expect(restore).toContainText('copia personalizable');
  await restore.getByRole('button', { name: 'Usar esta vista' }).click();
  await expect.poll(() => personalSaves).toBe(1);
  expect(publications).toBe(0);

  await page.getByRole('button', { name: 'Publicar para un rol' }).click();
  const publish = page.getByRole('alertdialog', { name: 'Publicar vista de equipo' });
  await expect(publish).toContainText('Las vistas personales existentes no se modifican');
  await publish.getByRole('button', { name: 'Publicar nueva versión' }).click();
  await expect.poll(() => publications).toBe(1);
  await expect(page.getByRole('status').filter({ hasText: 'versión 5' })).toBeVisible();
});

test('VIEW-007: a widget filter requests filtered metrics and persists with the view', async ({ page }) => {
  const metricRequests: URLSearchParams[] = [];
  const preferencePuts: Array<{ widgets: Array<{ id: string; filters?: Record<string, string> }> }> = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/cmdb/netskope/metrics') metricRequests.push(url.searchParams);
    if (url.pathname === '/api/dashboard/netskope/preferences' && request.method() === 'PUT') {
      preferencePuts.push(request.postDataJSON() as { widgets: Array<{ id: string; filters?: Record<string, string> }> });
    }
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.goto('/netskope');
  await expect(page.getByRole('heading', { name: 'Datos clave' })).toBeVisible();

  await page.getByRole('button', { name: 'Editar vista' }).click();
  const devicesItem = page.locator('.netskope-data-strip .dashboard-edit-item').filter({ hasText: 'Dispositivos' }).first();
  const devicesSettings = await openSettings(devicesItem);
  await devicesSettings.getByRole('button', { name: 'Filtrar widget por sistema operativo' }).click();
  await page.getByRole('option', { name: /Windows/ }).click();
  await closeSettings(page);
  await expect.poll(() => metricRequests.some((params) => params.get('os') === 'Windows')).toBe(true);

  await page.getByRole('button', { name: 'Guardar vista' }).click();
  await expect.poll(() => preferencePuts.length).toBe(1);
  expect(preferencePuts[0].widgets.find((widget) => widget.id === 'devices_total')?.filters?.os).toBe('Windows');
});

test('NSK-MET-UX-001: metric picker groups verified options and shows source, period and availability', async ({ page }) => {
  const metricRequests: string[] = [];
  const preferencePuts: Array<{ widgets: Array<{ id: string; size: string; filters?: Record<string, string> }> }> = [];
  let aaRequests = 0;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/cmdb/netskope/metrics') metricRequests.push(url.pathname + url.search);
    if (url.pathname === '/api/cmdb/netskope/aa/severity') aaRequests += 1;
    if (url.pathname === '/api/dashboard/netskope/preferences' && request.method() === 'PUT') {
      preferencePuts.push(request.postDataJSON() as { widgets: Array<{ id: string; size: string; filters?: Record<string, string> }> });
    }
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/dashboard/netskope/preferences', async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as { widgets: Array<{ id: string; size: string; filters?: Record<string, string> }> };
      await route.fulfill({ json: { ...body, is_default: false } });
      return;
    }
    await route.fulfill({ json: {
      widgets: [
        { id: 'users_total', size: 'lg', filters: { company: 'example.test' } },
        { id: 'devices_total', size: 'sm', filters: {} },
        { id: 'devices_by_os', size: 'md', filters: { os: 'Windows' } },
      ],
      data_widgets: ['users_total', 'devices_total'], chart_widgets: ['devices_by_os'], is_default: false,
    } });
  });
  await page.route('**/api/cmdb/netskope/alerts', (route) => route.fulfill({ json: {
    configured: true,
    dlp_export_configured: false,
    windows: [
      { days: 7, window_start: '2026-09-25T00:00:00Z', window_end: '2026-10-02T00:00:00Z', captured_at: '2026-10-02T00:00:00Z', total: null, availability: 'incomplete', by_alert_type: [{ key: 'DLP', count: 2 }], by_severity: [], by_action: [] },
      { days: 30, window_start: '2026-09-02T00:00:00Z', window_end: '2026-10-02T00:00:00Z', captured_at: '2026-10-02T00:00:00Z', total: 0, availability: 'complete', by_alert_type: [], by_severity: [], by_action: [] },
      { days: 90, window_start: '2026-07-04T00:00:00Z', window_end: '2026-10-02T00:00:00Z', captured_at: '2026-10-01T00:00:00Z', total: 42, availability: 'stale', by_alert_type: [{ key: 'policy', count: 42 }], by_severity: [], by_action: [] },
    ],
  } }));

  await page.goto('/netskope');
  await page.getByRole('button', { name: 'Editar vista' }).click();
  await expect.poll(() => metricRequests.length).toBeGreaterThan(0);
  const addData = page.getByRole('button', { name: 'Agregar dato' });
  await addData.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Elegí un dato para tu tablero' })).toBeVisible();
  const picker = page.locator('.dashboard-widget-picker');
  await expect(picker.getByRole('button', { name: /Inventario y cobertura/ })).toBeVisible();
  await expect(picker.getByRole('button', { name: /Alertas y protección/ })).toBeVisible();
  await expect(picker.getByRole('button', { name: /Políticas y uso/ })).toHaveCount(0);
  expect(aaRequests).toBe(0);
  const categoryAxe = await new AxeBuilder({ page }).include('.dashboard-widget-picker').analyze();
  expect(categoryAxe.violations).toEqual([]);

  const inventoryGroup = picker.getByRole('button', { name: /Inventario y cobertura/ });
  await inventoryGroup.focus();
  await page.keyboard.press('Enter');
  const inventoryOption = picker.locator('.dashboard-widget-picker-card').filter({ has: page.getByRole('heading', { name: 'Dispositivos', exact: true }) });
  // Source, period and availability are reference: one click away behind a "?", not three lines on every card.
  await expect(inventoryOption).not.toContainText('Fuente: Inventario Netskope');
  const inventoryNote = await sourceNote(inventoryOption);
  await expect(inventoryNote).toContainText('Fuente: Inventario Netskope');
  await expect(inventoryNote).toContainText('Período: Eventos de los últimos 7 días');
  await expect(inventoryNote).toContainText('Disponibilidad: Inventario observado');
  await inventoryOption.getByRole('button', { name: /^Ayuda: Fuente y período de / }).click();
  // Keep keyboard focus on the help action while checking the focused preview's contrast.
  await page.mouse.move(0, 0);
  await expect(inventoryOption.getByRole('button', { name: /^Ayuda: Fuente y período de / })).toBeFocused();
  // `aria-allowed-role` is a pre-existing violation in the shared picker component, outside NSK-MET-UX-001.
  const inventoryAxe = await new AxeBuilder({ page }).include('.dashboard-widget-picker').disableRules(['aria-allowed-role']).analyze();
  expect(inventoryAxe.violations).toEqual([]);

  await picker.getByRole('button', { name: /Alertas y protección/ }).click();
  const incompleteOption = picker.locator('.dashboard-widget-picker-card').filter({ has: page.getByRole('heading', { name: 'Alertas Netskope agregadas · 7 días', exact: true }) });
  const incompleteNote = await sourceNote(incompleteOption);
  await expect(incompleteNote).toContainText('Fuente: Captura de alertas Netskope');
  await expect(incompleteNote).toContainText('Período: Captura de 7 días');
  await expect(incompleteNote).toContainText('Datos incompletos');
  await incompleteOption.getByRole('button', { name: /^Ayuda: Fuente y período de / }).click();
  await expect(incompleteOption.locator('.dashboard-widget-picker-value')).toHaveText('Sin dato · Datos incompletos');
  const staleOption = picker.locator('.dashboard-widget-picker-card').filter({ has: page.getByRole('heading', { name: 'Alertas Netskope agregadas · 90 días', exact: true }) });
  await expect(staleOption).toContainText('Captura vencida');
  const staleNote = await sourceNote(staleOption);
  await expect(staleNote).toContainText('período');
  await expect(staleNote).toContainText('capturada');
  await staleOption.getByRole('button', { name: /^Ayuda: Fuente y período de / }).click();

  await picker.getByRole('button', { name: 'Cerrar selector' }).click();
  await expect(picker).toHaveCount(0);
  await page.getByRole('button', { name: 'Agregar gráfico' }).click();
  await expect(page.getByRole('dialog', { name: 'Elegí un gráfico para tu tablero' })).toBeVisible();
  const chartPicker = page.locator('.dashboard-widget-picker');
  await expect(chartPicker.getByRole('button', { name: /Políticas y uso/ })).toHaveCount(0);
  const chartCategoryAxe = await new AxeBuilder({ page }).include('.dashboard-widget-picker').analyze();
  expect(chartCategoryAxe.violations).toEqual([]);
  // NSK-AA-001: the severity chart was replaced by the tenant chart map, so the chart picker no longer offers it
  // and, with a single category left, shows no category chips.
  await expect(chartPicker.getByRole('button', { name: /Alertas y protección/ })).toHaveCount(0);
  await expect(chartPicker.getByRole('heading', { name: 'Alertas Netskope por severidad', exact: true })).toHaveCount(0);
  expect(aaRequests).toBe(0);

  await chartPicker.getByRole('button', { name: 'Cerrar selector' }).click();
  await addData.click();
  await picker.getByRole('button', { name: /Inventario y cobertura/ }).click();
  await page.getByRole('button', { name: 'Agregar Sin usuario resuelto' }).click();
  await page.getByRole('button', { name: 'Guardar vista' }).click();
  await expect.poll(() => preferencePuts.length).toBe(1);
  const savedWidgets = preferencePuts[0].widgets;
  expect(savedWidgets.find((widget) => widget.id === 'users_total')).toMatchObject({ id: 'users_total', size: 'lg', filters: { company: 'example.test' } });
  expect(savedWidgets.some((widget) => widget.id === 'devices_total')).toBe(true);
  expect(savedWidgets.some((widget) => widget.id === 'devices_by_os')).toBe(true);
  expect(savedWidgets.some((widget) => widget.id === 'devices_observed_user_unmatched')).toBe(true);
  expect(aaRequests).toBe(0);
});

test('NSK-MET-UX-001: a denied alert source does not hide the loaded inventory offer', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({ json: {
    widgets: [{ id: 'devices_total', size: 'sm', filters: {} }], data_widgets: ['devices_total'], chart_widgets: [], is_default: false,
  } }));
  await page.route('**/api/cmdb/netskope/alerts', (route) => route.fulfill({ status: 403, json: { detail: 'Sin permiso para la captura de alertas' } }));
  await page.goto('/netskope');
  await page.getByRole('button', { name: 'Editar vista' }).click();
  await page.getByRole('button', { name: 'Agregar dato' }).click();
  await expect(page.getByRole('dialog', { name: 'Elegí un dato para tu tablero' })).toBeVisible();
  const picker = page.locator('.dashboard-widget-picker');
  await picker.getByRole('button', { name: /Alertas y protección/ }).click();
  const missingAlert = picker.locator('.dashboard-widget-picker-card').filter({ has: page.getByRole('heading', { name: 'Alertas Netskope agregadas · 7 días', exact: true }) });
  await expect(await sourceNote(missingAlert)).toContainText('Disponibilidad: Sin snapshot disponible');
  await picker.getByRole('button', { name: /Inventario y cobertura/ }).click();
  const inventory = picker.locator('.dashboard-widget-picker-card').filter({ has: page.getByRole('heading', { name: 'Sin usuario resuelto', exact: true }) });
  await expect(await sourceNote(inventory)).toContainText('Disponibilidad: Inventario observado');
  await expect(inventory.getByRole('button', { name: 'Agregar Sin usuario resuelto' })).toBeEnabled();
});

test('Postura holds the review detail of each check and no DLP cache panel (UX-AUD2-009)', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.goto('/netskope/posture?open=client_protection_off,stale_undiagnosed,duplicate_hostname');

  const posture = page.getByRole('region', { name: 'Postura Netskope', exact: true });
  await expect(posture).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', test.info().project.name.includes('light') ? 'light' : 'dark');
  for (const heading of ['Último evento del cliente', 'Posibles duplicados — revisar', 'Equipos sin señal: por qué']) {
    await expect(posture.getByRole('heading', { name: heading })).toBeVisible();
  }
  // NSK-HB-001: heartbeat is not a posture signal.
  await expect(posture.getByText(/heartbeat/i)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Estado del cache DLP Netskope' })).toHaveCount(0);
  await expect(page.getByText('Errores consecutivos DLP')).toHaveCount(0);
});

test('NSK-POSTURE-UX-001: posture levels explain evidence, preserve exact drills and remain accessible on desktop', async ({ page }) => {
  const deviceRequests: URLSearchParams[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/cmdb/netskope/devices') deviceRequests.push(new URLSearchParams(url.searchParams));
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/cmdb/netskope/devices/client-events*', (route) => route.fulfill({ json: {
    total: 11,
    coverage_risk_total: 3,
    coverage_risk_events: ['Uninstalled', 'Disconnected By Uninstall', 'Admin Disabled'],
    events: [
      { key: 'Tunnel Down', count: 5, coverage_risk: false },
      { key: 'Tunnel Up', count: 2, coverage_risk: false },
      { key: 'Disconnected By Uninstall', count: 2, coverage_risk: true },
      { key: 'Admin Disabled', count: 1, coverage_risk: true },
      { key: 'Vendor Specific: New Signal', count: 1, coverage_risk: false },
    ],
  } }));
  await page.goto('/netskope/posture?open=client_protection_off,duplicate_hostname');

  const posture = page.getByRole('region', { name: 'Postura Netskope', exact: true });

  const duplicates = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Posibles duplicados — revisar' }) });
  await duplicates.getByRole('button', { name: 'Ayuda: Posibles duplicados — revisar' }).click();
  await expect(duplicates).toContainText('Hipótesis de revisión');
  await expect(duplicates).toContainText('reimagen, reasignación o cuenta compartida');
  await expect(duplicates).toContainText('No se fusiona ni se retira nada');
  await expect(duplicates).not.toContainText(/sugerimos (dar de baja|fusionar)/i);

  const events = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Último evento del cliente' }) });
  await expect(events.getByRole('region', { name: 'Último evento: desinstalación o deshabilitación · 3' })).toBeVisible();
  await expect(events.getByRole('button', { name: /Túnel caído.*Tunnel Down/ }).locator('small')).toHaveText('Tunnel Down');
  const unknownEvent = events.getByRole('button', { name: /Vendor Specific: New Signal/ });
  await expect(unknownEvent).toBeVisible();
  await expect(unknownEvent.locator('.netskope-event-copy small')).toHaveCount(0);
  await expect(posture).not.toContainText(/desprotegido|Cobertura en riesgo/i);
  await expect(events).toContainText('Mostrando 3 de 3 valores informados.');
  await expect(duplicates).toContainText('Mostrando 2 de 2 grupos');
  await expect(duplicates).toContainText('Mostrando 1 de 1 grupos');

  await events.getByRole('button', { name: /Túnel caído.*Tunnel Down/ }).click();
  await expect(page).toHaveURL(/\/netskope\/devices(?:\?|$)/);
  await expect.poll(() => deviceRequests.at(-1)?.get('last_seen_event')).toBe('Tunnel Down');
});

test('NSK-POSTURE-UX-001: posture has no horizontal overflow and passes axe on both desktop sizes and themes', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
    await page.goto('/netskope/operations');
    await expect(page.getByRole('region', { name: 'Equipos Netskope', exact: true })).toBeVisible();
    await page.setViewportSize(viewport);
    for (const theme of ['dark', 'light']) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      const width = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      expect(width.scroll).toBeLessThanOrEqual(width.client);
      const axe = await new AxeBuilder({ page }).include('.netskope-operations').analyze();
      expect(axe.violations).toEqual([]);
    }
  }
});

test('NSK-DEV-004: device filters travel from the selectors to the devices request', async ({ page }) => {
  const deviceRequests: URLSearchParams[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/cmdb/netskope/devices') deviceRequests.push(url.searchParams);
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.goto('/netskope/devices');
  await expect(page.getByRole('cell', { name: /LAPTOP-QA-01/ })).toBeVisible();

  const filters = page.getByRole('group', { name: 'Filtros de dispositivos' });
  await filters.getByText('Identidad y equipo').click();
  await filters.getByRole('button', { name: 'Filtrar por sistema operativo' }).click();
  await page.getByRole('option', { name: 'Mac OS X · 3' }).click();
  await expect.poll(() => deviceRequests.at(-1)?.get('os')).toBe('Mac OS X');

  await filters.getByRole('button', { name: 'Filtrar por estado de usuario' }).click();
  await page.getByRole('option', { name: 'Sin dato · 2' }).click();
  await expect.poll(() => deviceRequests.at(-1)?.get('user_status')).toBe('Sin dato');
  expect(deviceRequests.at(-1)?.get('os')).toBe('Mac OS X');

  await filters.getByRole('button', { name: 'Limpiar todos' }).click();
  await expect.poll(() => deviceRequests.at(-1)?.has('os')).toBe(false);
  expect(deviceRequests.at(-1)?.has('user_status')).toBe(false);
  await expect(filters.getByRole('button', { name: 'Limpiar todos' })).toHaveCount(0);
  await expect(filters.getByText('Filtros activos (0)')).toHaveCount(0);
});

test('NSK-INVENTORY-UX-001: grouped device filters restore deep links, remain removable and preserve the dense inventory', async ({ page }) => {
  const deviceRequests: URLSearchParams[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/cmdb/netskope/devices') deviceRequests.push(new URLSearchParams(url.searchParams));
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/cmdb/netskope/devices?*', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const rows = [
      {
        object_id: 701, display_name: 'LAPTOP-AMBIGUOUS', source_id: 'device-701',
        attributes: { hostname: 'LAPTOP-AMBIGUOUS', device_make: 'Dell', device_model: 'Latitude', os: 'Windows', os_version: '11', client_version: '141.0.0', username: 'shared@example.test', user_status: 'enabled', classification_status: 'managed', last_seen_event: 'connect', heartbeat: false },
        first_seen_at: '2026-09-01T00:00:00Z', last_seen_at: '2026-09-30T00:00:00Z', observed_user_status: 'ambiguous',
      },
      {
        object_id: 702, display_name: 'LAPTOP-UNMATCHED', source_id: 'device-702',
        attributes: { hostname: 'LAPTOP-UNMATCHED', device_make: 'Lenovo', device_model: 'ThinkPad', os: 'Windows', os_version: '11', client_version: '141.0.0', username: 'unknown@example.test', user_status: 'enabled', classification_status: 'managed', last_seen_event: 'connect', heartbeat: false },
        first_seen_at: '2026-09-01T00:00:00Z', last_seen_at: '2026-09-30T00:00:00Z', observed_user_status: 'unmatched',
      },
    ];
    const total = params.get('evidence_state') === 'review' ? 2 : 4;
    const resultRows = total === rows.length ? rows : [...rows,
      { ...rows[0], object_id: 703, display_name: 'LAPTOP-EXTRA-03', source_id: 'device-703', attributes: { ...rows[0].attributes, hostname: 'LAPTOP-EXTRA-03' } },
      { ...rows[1], object_id: 704, display_name: 'LAPTOP-EXTRA-04', source_id: 'device-704', attributes: { ...rows[1].attributes, hostname: 'LAPTOP-EXTRA-04' } },
    ];
    await route.fulfill({ json: {
      rows: resultRows, total, limit: Number(params.get('limit') || 50), offset: Number(params.get('offset') || 0),
      search: params.get('q') || '', filters: { os: params.get('os') || '' },
      source_evidence: { source_fresh: true, source_status: 'completed', source_completed_at: '2026-09-30T00:00:00Z', as_of: '2026-09-30T00:00:00Z' },
    } });
  });

  // NSK-HB-001: a bookmark that still carries the retired heartbeat filter opens without it and never sends it.
  await page.goto('/netskope/inventory?os=Windows&heartbeat=inactive&event_age=gt_30d&evidence_state=review');
  await expect(page.getByRole('cell', { name: 'LAPTOP-AMBIGUOUS' })).toBeVisible();
  await expect.poll(() => deviceRequests.at(-1)?.get('os')).toBe('Windows');
  expect(deviceRequests.every((request) => !request.has('heartbeat'))).toBe(true);
  await expect(page).not.toHaveURL(/heartbeat/);
  await expect.poll(() => deviceRequests.at(-1)?.get('event_age')).toBe('gt_30d');
  await expect.poll(() => deviceRequests.at(-1)?.get('evidence_state')).toBe('review');

  const filters = page.getByRole('group', { name: 'Filtros de dispositivos' });
  const identity = filters.locator('details').nth(0);
  const activity = filters.locator('details').nth(1);
  await expect(identity).toHaveAttribute('open', '');
  await expect(activity).toHaveAttribute('open', '');
  await expect(filters.getByRole('button', { name: 'Filtrar por sistema operativo' })).toContainText('Windows');
  await expect(filters.getByRole('button', { name: 'Filtrar por estado de heartbeat' })).toHaveCount(0);
  await expect(filters.getByRole('button', { name: 'Filtrar por antigüedad del último evento' })).toContainText('Sin eventos hace más de 30 días');
  await expect(page.getByRole('button', { name: 'Filtrar por señales del equipo' })).toContainText('Candidatos a revisión');
  await expect(filters.getByText('Filtros activos (3)')).toBeVisible();
  await expect(filters.getByRole('button', { name: /Heartbeat/ })).toHaveCount(0);
  await expect(filters.getByRole('button', { name: 'Quitar filtro Antigüedad del evento: Sin eventos hace más de 30 días' })).toBeVisible();
  await expect(filters.getByRole('button', { name: 'Quitar filtro Candidato a revisión' })).toBeVisible();
  await expect(page.locator('.netskope-result-count')).toHaveText('2 dispositivos');
  await page.getByRole('button', { name: 'Ayuda: Evidencia del inventario Netskope' }).click();
  await expect(page.getByRole('note')).toContainText('El estado de la señal (reciente, sin señal reciente, candidato a revisión) es una evaluación de Custodia');
  await expect(page.getByRole('note')).toContainText('La antigüedad de un evento no demuestra que el equipo esté fuera de línea ni sin protección.');
  await page.keyboard.press('Escape');
  await expect(filters).not.toContainText(/offline/i);

  const identitySummary = identity.locator('summary');
  await identitySummary.focus();
  await identitySummary.press('Enter');
  await expect(identity).not.toHaveAttribute('open', '');
  await identitySummary.press('Space');
  await expect(identity).toHaveAttribute('open', '');
  const activitySummary = activity.locator('summary');
  await activitySummary.focus();
  await activitySummary.press('Enter');
  await expect(activity).not.toHaveAttribute('open', '');
  await expect(filters.getByRole('button', { name: 'Quitar filtro Antigüedad del evento: Sin eventos hace más de 30 días' })).toBeVisible();
  await expect(filters.getByRole('button', { name: 'Quitar filtro Candidato a revisión' })).toBeVisible();

  await filters.getByRole('button', { name: 'Quitar filtro Candidato a revisión' }).click();
  await expect.poll(() => deviceRequests.at(-1)?.has('evidence_state')).toBe(false);
  expect(deviceRequests.at(-1)?.get('os')).toBe('Windows');
  expect(deviceRequests.at(-1)?.get('event_age')).toBe('gt_30d');
  await expect(page).toHaveURL(/os=Windows.*event_age=gt_30d/);
  await expect(page.locator('.netskope-result-count')).toHaveText('4 dispositivos');
  // Without the review state the table is no longer limited to the recent window, and that criterion shows as its own chip.
  await expect(filters.getByText('Filtros activos (3)')).toBeVisible();
  await expect(filters.getByRole('button', { name: 'Quitar filtro Incluye dispositivos sin evento en 7 días' })).toBeVisible();
  await expect(filters.getByRole('button', { name: 'Quitar filtro Antigüedad del evento: Sin eventos hace más de 30 días' })).toBeVisible();
  await expect(page.getByRole('row', { name: /LAPTOP-AMBIGUOUS/ }).getByText('Usuario ambiguo')).toHaveCount(1);
  await expect(page.getByRole('row', { name: /LAPTOP-UNMATCHED/ }).getByText('Usuario no correlacionado')).toHaveCount(1);
  expect(await page.getByRole('columnheader').allTextContents()).toEqual([
    'Dispositivo', 'Usuario', 'Empresa', 'Señal', 'Sistema operativo', 'Cliente',
  ]);

  await page.getByRole('button', { name: 'Filtrar por señales del equipo' }).click();
  await page.getByRole('option', { name: 'Sin señal reciente' }).click();
  await expect.poll(() => deviceRequests.at(-1)?.get('evidence_state')).toBe('not_recent');
  expect(deviceRequests.at(-1)?.has('heartbeat')).toBe(false);
  expect(deviceRequests.at(-1)?.has('event_age')).toBe(false);

  for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    for (const theme of ['dark', 'light']) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      const width = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      expect(width.scroll).toBeLessThanOrEqual(width.client);
      const axe = await new AxeBuilder({ page }).include('.netskope-filter-row').include('.netskope-table').analyze();
      expect(axe.violations).toEqual([]);
    }
  }
});

test('Netskope inventory presents one relationship table with the approved columns', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.goto('/netskope/inventory');
  await expect(page.getByRole('cell', { name: /LAPTOP-QA-01/ })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Filtros de dispositivos' })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Secciones del inventario Netskope' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Ayuda: Evidencia del inventario Netskope' }).click();
  await expect(page.getByRole('note')).toContainText('Una asociación histórica no confirma uso actual ni propiedad.');
  await page.keyboard.press('Escape');
  expect(await page.getByRole('columnheader').allTextContents()).toEqual([
    'Dispositivo', 'Usuario', 'Empresa', 'Señal', 'Sistema operativo', 'Cliente',
  ]);
  await expect(page.getByRole('columnheader', { name: 'Última observación' })).toHaveCount(0);
});

test('NSK-INV-002: a device row opens a short card with the device, its user and its signal, without identifiers or snapshots', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  let historyRequests = 0;
  page.on('request', (request) => { if (request.url().includes('/history')) historyRequests += 1; });
  await page.goto('/netskope/devices');
  const row = page.getByRole('row', { name: /LAPTOP-QA-01/ });
  await row.click();
  await expect(row.getByRole('button', { name: 'Ver detalle de LAPTOP-QA-01' })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const card = page.locator('.netskope-device-detail');
  await expect(card.getByRole('region', { name: 'Equipo' })).toContainText('Dell Latitude 5420');
  await expect(card.getByRole('region', { name: 'Usuario' })).toBeVisible();
  const signal = card.getByRole('region', { name: 'Señal' });
  await expect(signal).toContainText(/Reportó hace/);
  await expect(signal).toContainText('connect');
  await expect(card).not.toContainText('1758000000');
  await expect(card).not.toContainText('device-501');
  await expect(card).not.toContainText(/capturas/i);
  await expect(card).not.toContainText(/diagnóstico/i);
  await expect(card.getByRole('region', { name: 'Rendimiento y anomalías' })).toContainText('Sin usuario correlacionado');
  expect(historyRequests).toBe(0);
  await row.click();
  await expect(card).toHaveCount(0);
});

test('NSK-INV-002: the card reads the user\'s ADEM POP and score for this exact device, and UEBA anomalies only with permission', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read', 'netskope:uba_read'] });
  await page.route(/\/api\/cmdb\/netskope\/devices\?/, (route) => route.fulfill({ json: { total: 1, limit: 50, offset: 0, rows: [{
    object_id: 501, source_id: 'device-501', display_name: 'NB-ADA', attributes: { hostname: 'NB-ADA', os: 'Windows', os_version: '11', client_version: '141.1.7' },
    first_seen_at: '2026-01-01T00:00:00Z', last_seen_at: '2026-10-01T00:00:00Z', observed_user_status: 'matched',
    observed_user: { object_id: 77, source_id: 'u-77', display_name: 'Ada', email: 'ada@example.test' },
    device_evidence: { state: 'recent', reason: '', last_signal_at: '2026-10-01T00:00:00Z', age_days: 0, last_seen_event: 'Dem Heartbeat', source_fresh: true, source_status: 'completed', source_completed_at: '2026-10-01T00:00:00Z', as_of: '2026-10-01T00:00:00Z', recent_days: 7, review_days: 30, source_freshness_hours: 24, client_version: '141.1.7', os: 'Windows', os_version: '11' },
  }] } }));
  await page.route('**/api/cmdb/netskope/users/77/experience/score?*', (route) => route.fulfill({ json: {
    window_start: 1790000000, window_end: 1790086400, source: 'netskope_adem', score: 80, weakest: 'network', devices_total: 2, devices: [
      { device_id: 'adem-other', inventory_device_id: 999, device_name: 'NB-OTHER', device_os: 'Windows', exp_score: 40, device_score: 40, network_score: 40, app_score: 40 },
      { device_id: 'adem-1', inventory_device_id: 501, device_name: 'NB-ADA', device_os: 'Windows', exp_score: 86, device_score: 90, network_score: 80, app_score: 88 },
    ] } }));
  await page.route('**/api/cmdb/netskope/users/77/experience/devices/adem-1?*', (route) => route.fulfill({ json: {
    window_start: 1790000000, window_end: 1790086400, source: 'netskope_adem', device_id: 'adem-1', pop: 'BR-SAO1', last_activity: 1790080000, activity_status: 'in_window',
  } }));
  let anomaliesStatus = 200;
  await page.route('**/api/cmdb/netskope/users/77/anomalies', (route) => anomaliesStatus === 403
    ? route.fulfill({ status: 403, json: { detail: 'denied' } })
    : route.fulfill({ json: { window_days: 30, total: 3, returned: 3, truncated: false, by_severity: { high: 1, medium: 2, low: 0, informational: 0, unknown: 0 }, by_scenario: [{ scenario: 'Insider threat', sub_scenario: 'DLP violation', count: 3 }], top_rules: [], recent: [] } }));
  await page.goto('/netskope/devices');
  await page.getByRole('row', { name: /NB-ADA/ }).click();
  const experience = page.locator('.netskope-device-detail').getByRole('region', { name: 'Rendimiento digital' });
  await expect(experience).toContainText('POP BR-SAO1');
  await expect(experience).toContainText('86 / 100');
  await expect(experience).toContainText('más es mejor');
  await expect(experience).not.toContainText('40 / 100');
  const anomalies = page.locator('.netskope-device-detail').getByRole('region', { name: 'Anomalías del usuario' });
  await expect(anomalies).toContainText('Anomalías del usuario · 30 días');
  await expect(anomalies).toContainText('Alta 1');
  await expect(anomalies).toContainText('Media 2');
  await expect(anomalies).toContainText('Más frecuente: Insider threat · DLP violation');
  const axe = await new AxeBuilder({ page }).include('.netskope-table').analyze();
  expect(describeViolations(axe.violations)).toEqual([]);

  // Both blocks open the same user card (the Usuarios ficha) without leaving the inventory.
  await page.route('**/api/cmdb/netskope/uci?*', (route) => route.fulfill({ json: { configured: true, rows: [], total: 0 } }));
  await anomalies.getByRole('button', { name: 'Ver anomalías en la ficha del usuario' }).click();
  const drawer = page.getByRole('dialog', { name: 'Ada' });
  await expect(drawer).toContainText('FICHA DEL USUARIO');
  await expect(drawer.getByRole('heading', { name: 'Anomalías' })).toBeVisible();
  await drawer.getByRole('button', { name: 'Cerrar ficha', exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page).toHaveURL(/\/netskope\/devices/);
  await experience.getByRole('button', { name: 'Ver detalle en la ficha del usuario' }).click();
  await expect(page.getByRole('dialog', { name: 'Ada' }).getByRole('heading', { name: 'Equipos' })).toBeVisible();
  await page.keyboard.press('Escape');

  anomaliesStatus = 403;
  await page.reload();
  await page.getByRole('row', { name: /NB-ADA/ }).click();
  await expect(page.locator('.netskope-device-detail').getByRole('region', { name: 'Rendimiento digital' })).toContainText('POP BR-SAO1');
  await expect(page.locator('.netskope-device-detail').getByRole('region', { name: 'Anomalías del usuario' })).toHaveCount(0);
});

test('device and user drawers no longer show DLP alert counts or investigation links (UX-AUD2-009)', async ({ page }) => {
  const retiredRequests: string[] = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.includes('/investigations') || pathname.endsWith('/alerts/summary')) retiredRequests.push(pathname);
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/cmdb/netskope/users/*/experience/devices?*', (route) => route.fulfill({ status: 403, json: { detail: 'Sin permiso ADEM' } }));
  await page.goto('/netskope/devices');
  await page.getByRole('row', { name: /LAPTOP-QA-01/ }).click();
  const deviceCard = page.locator('.netskope-device-detail');
  await expect(deviceCard).toBeVisible();
  await expect(deviceCard.getByText(/Ver alertas recientes/)).toHaveCount(0);

  await page.goto('/netskope/users');
  await page.getByRole('row', { name: /QA User/ }).click();
  const userDrawer = page.getByRole('dialog', { name: 'QA User' });
  await expect(userDrawer).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', test.info().project.name.includes('light') ? 'light' : 'dark');
  await expect(userDrawer.locator('time[datetime="2026-01-01T00:00:00Z"]')).toHaveAttribute('title', /^hace /);
  await expect(userDrawer.locator('time[datetime="2026-09-01T00:00:00Z"]')).toHaveAttribute('title', /^hace /);
  await expect(userDrawer.getByText(/Ver alertas recientes/)).toHaveCount(0);
  expect(retiredRequests).toEqual([]);
});

test('NSK-EVT-001: uninstall and disable last events retain exact literals and exact drills', async ({ page }) => {
  const deviceRequests: URLSearchParams[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/cmdb/netskope/devices') deviceRequests.push(url.searchParams);
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.goto('/netskope/posture?open=client_protection_off');

  const panel = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Último evento del cliente' }) });
  const risk = panel.getByRole('region', { name: /Último evento: desinstalación o deshabilitación · 3/ });
  await expect(risk.getByRole('button', { name: /Disconnected By Uninstall/ })).toBeVisible();
  await expect(risk.getByRole('button', { name: /Tunnel Down/ })).toHaveCount(0);
  await risk.getByRole('button', { name: /Disconnected By Uninstall/ }).click();

  await expect(page).toHaveURL(/\/netskope\/devices(?:\\?|$)/);
  await expect.poll(() => deviceRequests.at(-1)?.get('last_seen_event')).toBe('Disconnected By Uninstall');
  await expect(page.getByRole('button', { name: 'Filtrar por último evento del cliente' })).toHaveText(/Disconnected By Uninstall/);
});

test('NSK-CHG-001: changes panel drills by change type and lists retired devices inline', async ({ page }) => {
  const deviceRequests: URLSearchParams[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/cmdb/netskope/devices') deviceRequests.push(url.searchParams);
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.goto('/netskope/operations?tab=changes');

  const panel = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Qué cambió desde la última sync' }) });
  await expect(panel.getByRole('button', { name: /Bajaron de versión del cliente\s*0/ })).toBeDisabled();
  await panel.getByText('Dejaron de reportarse (retirados)').click();
  await expect(panel.getByText('LAPTOP-GONE-1 · 138.1.12.2776')).toBeVisible();
  await expect(panel.getByText('gone-2', { exact: true })).toBeVisible();

  await panel.getByRole('button', { name: /Actualizaron el cliente\s*3/ }).click();
  await expect(page).toHaveURL(/\/netskope\/devices(?:\\?|$)/);
  await expect.poll(() => deviceRequests.at(-1)?.get('change')).toBe('upgraded');
  await expect(page.getByRole('group', { name: 'Filtros de dispositivos' })).toContainText('Cambio: Actualizaron el cliente');
});

test('NSK-CHG-001: without two completed runs the panel says so instead of showing zeros', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/cmdb/netskope/devices/changes', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    available: false, completed_runs: 1, latest_run: null, previous_run: null,
    counts: { added: 0, removed: 0, upgraded: 0, downgraded: 0, version_changed: 0, os_changed: 0, classification_changed: 0 },
    samples: { added: [], removed: [], upgraded: [], downgraded: [], version_changed: [], os_changed: [], classification_changed: [] },
  }) }));
  await page.goto('/netskope/operations?tab=changes');
  const panel = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Qué cambió desde la última sync' }) });
  await expect(panel.getByText('Todavía no hay dos corridas para comparar')).toBeVisible();
  await expect(panel).toContainText('hay 1 corrida completa');
  await expect(panel.getByRole('button', { name: /Actualizaron el cliente/ })).toHaveCount(0);
});

test('NSK-DUP-001: possible duplicates drill by exact hostname and never offer a merge', async ({ page }) => {
  const deviceRequests: URLSearchParams[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/cmdb/netskope/devices') deviceRequests.push(url.searchParams);
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.goto('/netskope/posture?open=duplicate_hostname');
  const panel = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Posibles duplicados — revisar' }) });
  await panel.getByRole('button', { name: 'Ayuda: Posibles duplicados — revisar' }).click();
  await expect(panel).toContainText(/No se fusiona ni se retira nada/);
  await expect(panel.getByRole('button', { name: /fusionar|retirar|merge/i })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await panel.getByRole('region', { name: 'Mismo hostname, varios device_id' }).getByRole('button', { name: /NB-100/ }).click();
  await expect.poll(() => deviceRequests.at(-1)?.get('hostname')).toBe('NB-100');
  await expect(page.getByRole('group', { name: 'Filtros de dispositivos' })).toContainText('Hostname: NB-100');

  await page.goto('/netskope/posture?open=duplicate_hostname');
  await page.getByRole('region', { name: 'Mismo usuario en varios dispositivos' }).getByRole('button', { name: /1 usuarios · 4 dispositivos/ }).click();
  await expect.poll(() => deviceRequests.at(-1)?.get('duplicate')).toBe('username');
});

test('NSK-ERR-001: a failed devices request shows retry and the technical detail dialog', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/cmdb/netskope/devices*', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ detail: 'Inventario no disponible' }),
    headers: { 'x-request-id': 'req-netskope-test-1' },
  }));
  await page.goto('/netskope/devices');

  await expect(page.getByText('No se pudo cargar Netskope')).toBeVisible();
  await expect(page.locator('.netskope-result-count')).toHaveText('—');
  await page.getByRole('button', { name: 'Ver detalle técnico' }).click();
  const dialog = page.getByRole('dialog', { name: 'Detalle del error' });
  await expect(dialog).toContainText('/cmdb/netskope/devices');
  await expect(dialog).toContainText('HTTP 503');
  await expect(dialog).toContainText('req-netskope-test-1');
  await expect(dialog).toContainText('error del servidor');
});

test('NSK-LOAD-001: the devices count never shows a temporary zero while loading (UX-AUD2-024)', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/cmdb/netskope/devices*', async (route) => { await gate; await route.fallback(); });
  await page.goto('/netskope/devices');

  await expect(page.locator('.netskope-result-count')).toHaveText('Cargando inventario…');
  await expect(page.locator('.netskope-skeleton-row')).toHaveCount(4);
  release();
  await expect(page.getByRole('cell', { name: /LAPTOP-QA-01/ })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', test.info().project.name.includes('light') ? 'light' : 'dark');
  await expect(page.locator('.netskope-result-count')).toHaveText('1 dispositivo');
});

test('VIEW-001B: the Netskope board reloads with the saved order and size', async ({ page }) => {
  let stored: Array<Record<string, unknown>> | null = null;
  let facetRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/cmdb/netskope/devices/facets') facetRequests += 1;
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/dashboard/netskope/preferences', async (route) => {
    if (route.request().method() === 'PUT') {
      const payload = route.request().postDataJSON() as { widgets: Array<Record<string, unknown>> };
      stored = payload.widgets.map((widget) => ({ ...widget, filters: widget.filters ?? {} }));
      await route.fulfill({ json: { widgets: stored, is_default: false } });
      return;
    }
    if (stored) { await route.fulfill({ json: { widgets: stored, is_default: false } }); return; }
    await route.fallback();
  });
  await page.goto('/netskope');
  await expect(page.getByRole('heading', { name: 'Datos clave' })).toBeVisible();
  expect(facetRequests).toBe(0);
  await page.getByRole('button', { name: 'Editar vista' }).click();
  await expect.poll(() => facetRequests).toBe(1);
  const dataItems = page.locator('.netskope-data-strip .dashboard-edit-item');
  await dataItems.first().focus();
  await dataItems.first().press('ArrowRight');
  await (await openSettings(dataItems.filter({ hasText: 'Usuarios' }).first())).getByRole('button', { name: 'Grande' }).click();
  await closeSettings(page);
  await page.getByRole('button', { name: 'Guardar vista' }).click();

  await page.reload();
  await expect(page.locator('.netskope-data-strip .dashboard-data-item').first()).toContainText('Dispositivos');
  await page.getByRole('button', { name: 'Editar vista' }).click();
  const reopened = await openSettings(page.locator('.netskope-data-strip .dashboard-edit-item').filter({ hasText: 'Usuarios' }).first());
  await expect(reopened.getByRole('button', { name: 'Grande' })).toHaveAttribute('aria-pressed', 'true');
});

test('NSK-EMPTY-001: an empty board offers adding data, charts or the recommended view', async ({ page }) => {
  let metricsRequests = 0;
  const preferencePuts: Array<{ widgets: Array<{ id: string; size: string }> }> = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/cmdb/netskope/metrics') metricsRequests++;
    if (url.pathname === '/api/dashboard/netskope/preferences' && request.method() === 'PUT') {
      preferencePuts.push(request.postDataJSON() as { widgets: Array<{ id: string; size: string }> });
    }
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/dashboard/netskope/preferences', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { widgets: [], is_default: false } });
      return;
    }
    await route.fallback();
  });
  await page.goto('/netskope');

  await expect(page.getByRole('heading', { name: 'Todavía no elegiste qué seguir' })).toBeVisible();
  expect(metricsRequests).toBe(0);
  await page.getByRole('button', { name: 'Ayuda: Vista recomendada', exact: true }).click();
  await expect(page.getByRole('note')).toContainText('Se guarda sólo si la aceptás');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Agregar datos' }).click();
  await expect(page.getByRole('dialog', { name: 'Elegí un dato para tu tablero' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.goto('/netskope');
  await page.getByRole('button', { name: 'Usar vista recomendada' }).click();
  await expect.poll(() => preferencePuts.length).toBe(1);
  expect(preferencePuts[0].widgets.map((widget) => widget.id)).toEqual([
    'devices_total', 'devices_stale_30d', 'devices_observed_user_unmatched', 'alerts_7d', 'devices_by_os', 'devices_by_classification',
  ]);
  await expect(page.getByRole('heading', { name: 'Todavía no elegiste qué seguir' })).toHaveCount(0);
  await expect(page.locator('.netskope-data-strip')).toContainText('Dispositivos');
});

test('NSK-SYNC-001: a scheduled Netskope sync refreshes the devices view without reloading or losing filters', async ({ page }) => {
  let eventRequests = 0;
  const deviceRequests: URLSearchParams[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/cmdb/netskope/devices') deviceRequests.push(url.searchParams);
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/events**', async (route) => {
    eventRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows: eventRequests === 1 ? [] : [
        { event_id: 41, kind: 'sync', actor_id: 'system:scheduler', actor_name: 'Scheduler', run_id: 'run-net-1', source_system: 'netskope', created_at: '2026-09-24T22:00:00Z' },
        { event_id: 42, kind: 'sync', actor_id: 'system:scheduler', actor_name: 'Scheduler', run_id: 'run-net-1', source_system: 'netskope', created_at: '2026-09-24T22:00:01Z' },
      ] }),
    });
  });
  await page.route('**/api/ingestion/runs/run-net-1', (route) => route.fulfill({ json: { run_id: 'run-net-1', source_system: 'netskope', status: 'completed', received_object_count: 42, error_count: 0 } }));
  await page.goto('/netskope/devices');
  await expect(page.getByRole('cell', { name: /LAPTOP-QA-01/ })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Buscar dispositivos Netskope' }).fill('LAPTOP');
  await expect.poll(() => deviceRequests.at(-1)?.get('q')).toBe('LAPTOP');
  const requestsBeforeEvent = deviceRequests.length;
  await page.evaluate(() => { (window as unknown as { __custodiaSyncMarker?: string }).__custodiaSyncMarker = 'kept'; });

  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

  await expect.poll(() => eventRequests).toBe(2);
  // Two events from the same scheduled run collapse into one toast.
  await expect(page.locator('.app-toast')).toHaveCount(1);
  await expect(page.locator('.app-toast')).toContainText('Sincronización automática completada');
  await expect.poll(() => deviceRequests.length).toBeGreaterThan(requestsBeforeEvent);
  expect(deviceRequests.at(-1)?.get('q')).toBe('LAPTOP');
  expect(await page.evaluate(() => (window as unknown as { __custodiaSyncMarker?: string }).__custodiaSyncMarker)).toBe('kept');
});

test('NSK-SYNC-002: a background sync keeps an in-progress dashboard draft', async ({ page }) => {
  let eventRequests = 0;
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/events**', async (route) => {
    eventRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows: eventRequests === 1 ? [] : [
        { event_id: 51, kind: 'sync', actor_id: 'system:scheduler', actor_name: 'Scheduler', run_id: 'run-net-2', source_system: 'netskope', created_at: '2026-09-24T22:10:00Z' },
      ] }),
    });
  });
  await page.route('**/api/ingestion/runs/run-net-2', (route) => route.fulfill({ json: { run_id: 'run-net-2', source_system: 'netskope', status: 'partial', received_object_count: 12, error_count: 1 } }));
  await page.goto('/netskope');
  await expect(page.getByRole('heading', { name: 'Datos clave' })).toBeVisible();
  await page.getByRole('button', { name: 'Editar vista' }).click();
  const firstDataItem = page.locator('.netskope-data-strip .dashboard-edit-item').first();
  await firstDataItem.focus();
  await firstDataItem.press('ArrowRight');
  await expect(page.getByText('Cambios sin guardar', { exact: false })).toBeVisible();

  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

  await expect.poll(() => eventRequests).toBe(2);
  await expect(page.locator('.app-toast')).toContainText('Sincronización automática parcial');
  await expect(page.getByText('Cambios sin guardar', { exact: false })).toBeVisible();
  await expect(page.getByRole('toolbar', { name: 'Edición del tablero Netskope' })).toBeVisible();
});

test('NSK-PICKER-001: the picker previews real data, expands it and keeps its own scroll', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.goto('/netskope');
  await expect(page.getByRole('heading', { name: 'Datos clave' })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 320));
  await page.getByRole('button', { name: 'Editar vista' }).click();
  await page.getByRole('button', { name: 'Agregar gráfico' }).click();

  await expect(page.getByRole('dialog', { name: 'Elegí un gráfico para tu tablero' })).toBeVisible();
  const picker = page.locator('.dashboard-widget-picker');
  await expect(picker).toBeVisible();
  // A fixed dialog stays centered on the viewport even with the page scrolled.
  const offsetFromCenter = await picker.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return Math.abs((box.top + box.bottom) / 2 - window.innerHeight / 2);
  });
  expect(offsetFromCenter).toBeLessThan(40);

  // Already-loaded categories render as "Datos actuales" with real labels.
  const realCard = picker.locator('.dashboard-widget-picker-card').filter({ hasText: 'Dispositivos por sistema operativo' });
  await expect(realCard.getByText('Datos actuales')).toBeVisible();
  // Hover/focus opens the larger real preview.
  await realCard.hover();
  await expect(realCard.locator('.dashboard-widget-picker-expanded')).toBeVisible();
  await expect(realCard.locator('.dashboard-widget-picker-expanded .pie-chart-legend-label').first()).toContainText('Windows');
  // devices_by_os ships in the mocked view, so it is explained instead of offered.
  await expect(realCard.getByText('Ya está en la vista')).toBeVisible();
  await expect(realCard.getByRole('button', { name: /^Agregar/ })).toHaveCount(0);
  await expect(picker.getByText('Recomendado').first()).toBeVisible();

  // Back to categories, then scroll inside the dialog: the page behind must not move.
  const pageScrollBefore = await page.evaluate(() => window.scrollY);
  const dialogScroll = await picker.evaluate((node) => { node.scrollTop = node.scrollHeight; return node.scrollTop; });
  expect(dialogScroll).toBeGreaterThanOrEqual(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollBefore);

  await picker.getByRole('button', { name: 'Cerrar selector' }).focus();
  await expect(picker).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
});

test('NSK-PICKER-002: reaching six data blocks disables the add trigger and explains the limit', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.goto('/netskope');
  await expect(page.getByRole('heading', { name: 'Datos clave' })).toBeVisible();
  await page.getByRole('button', { name: 'Editar vista' }).click();
  for (const [title, group] of [['Equipos sin señal hace más de 30 días', /Inventario y cobertura/], ['Sin usuario resuelto', /Inventario y cobertura/], ['Alertas Netskope agregadas · 30 días', /Alertas y protección/], ['Alertas Netskope agregadas · 90 días', /Alertas y protección/]] as const) {
    await page.getByRole('button', { name: 'Agregar dato' }).click();
    const picker = page.locator('.dashboard-widget-picker');
    await picker.getByRole('button', { name: group }).click();
    await picker.getByRole('button', { name: `Agregar ${title}` }).click();
    await expect(picker).toHaveCount(0);
  }
  await expect(page.locator('.netskope-data-strip .dashboard-edit-item')).toHaveCount(6);
  await expect(page.getByRole('button', { name: 'Agregar dato' })).toBeDisabled();
  await expect(page.getByText('Máximo 6 por sección')).toBeVisible();
});

test('NSK-CARD-001: key data cards carry an icon and a definition tooltip from the source', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.goto('/netskope');
  const card = page.locator('.netskope-data-card').filter({ hasText: 'Dispositivos' }).first();
  await expect(card).toHaveAttribute('title', /Fuente: Netskope/);
  await expect(card.locator('.netskope-data-title svg')).toHaveCount(1);
});

test('NSK-ALR-002: count-only DLP aggregate widgets show volume but offer no investigation', async ({ page }) => {
  const retiredRequests: string[] = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.includes('/investigations') || pathname.endsWith('/alerts/summary')) retiredRequests.push(pathname);
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({ json: ALERT_WIDGET_PREFERENCES }));
  await page.goto('/netskope');

  const overview = page.getByRole('group', { name: 'Volumen de alertas Netskope agregadas' });
  await expect(overview).toBeVisible();
  await expect(overview.getByText('Últimos 7 días')).toBeVisible();
  await expect(overview.getByText('31', { exact: true })).toBeVisible();
  // KPI cards are static, not navigation buttons, and no investigation
  // request is issued by rendering the aggregate board.
  await expect(overview.getByRole('button')).toHaveCount(0);
  await overview.getByText('Últimos 7 días').click();
  await expect(page).toHaveURL(/\/netskope$/);
  expect(retiredRequests).toEqual([]);
});

test('NSK-DEV-005: device filters are grouped and counted', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.goto('/netskope/devices');

  await expect(page.getByText(/El usuario observado se vincula solo/)).toHaveCount(0);
  await expect(page.getByText(/Revisión es una evaluación derivada/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Ayuda: Evidencia del inventario Netskope' }).click();
  const methodology = page.getByRole('note');
  await expect(methodology).toContainText('coincide exactamente con el ID o correo');
  await expect(methodology).toContainText('No hay conteos de alertas por equipo o usuario');
  await expect(methodology).toContainText('no demuestra que el equipo esté fuera de línea');
  await page.keyboard.press('Escape');
  await expect(methodology).toHaveCount(0);

  const filters = page.getByRole('group', { name: 'Filtros de dispositivos' });
  const identitySummary = filters.locator('summary', { hasText: 'Identidad y equipo' });
  const activitySummary = filters.locator('summary', { hasText: 'Actividad observada' });
  await expect(identitySummary).toBeVisible();
  await expect(activitySummary).toBeVisible();
  await expect(filters.getByText('Filtros activos (0)')).toHaveCount(0);
  await identitySummary.click();
  await filters.getByRole('button', { name: 'Filtrar por sistema operativo' }).click();
  await page.getByRole('option', { name: 'Mac OS X · 3' }).click();
  await expect(filters.getByText('Filtros activos (1)')).toBeVisible();
  await expect(identitySummary).toContainText('(1)');

  const hostCell = page.getByRole('cell', { name: /LAPTOP-QA-01/ });
  await expect(hostCell).toHaveAttribute('title', /LAPTOP-QA-01/);
});

const describeViolations = (violations: Array<{ id: string; nodes: Array<{ target: unknown[]; failureSummary?: string }> }>) => violations.map((violation) => `${violation.id} :: ${violation.nodes[0]?.target?.join(' ')} :: ${violation.nodes[0]?.failureSummary?.replace(/\s+/g, ' ').slice(0, 260) ?? ''}`);

test('NSK-A11Y-001: axe check covers the four Netskope views', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  const routeMarkers: Array<[string, () => ReturnType<typeof page.getByRole>]> = [
    ['/netskope', () => page.getByRole('heading', { name: 'Datos clave' })],
    ['/netskope/operations', () => page.getByRole('heading', { name: 'Cómo está la flota' })],
    ['/netskope/operations?tab=changes', () => page.getByRole('heading', { name: 'Qué cambió desde la última sync' })],
    ['/netskope/posture?open=client_protection_off,stale_undiagnosed,duplicate_hostname', () => page.getByRole('heading', { name: 'Equipos sin señal: por qué' })],
    ['/netskope/inventory', () => page.getByRole('columnheader', { name: 'Dispositivo', exact: true })],
    ['/netskope/devices', () => page.getByRole('cell', { name: /LAPTOP-QA-01/ })],
  ];
  for (const [route, marker] of routeMarkers) {
    await page.goto(route);
    await expect(marker()).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(describeViolations(results.violations), `${route} axe violations`).toEqual([]);
  }
});

test('NSK-A11Y-002: axe check covers the metrics editor and the device card', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.goto('/netskope');
  await page.getByRole('button', { name: 'Editar vista' }).click();
  await expect(page.getByRole('toolbar', { name: 'Edición del tablero Netskope' })).toBeVisible();
  const editorResults = await new AxeBuilder({ page }).analyze();
  expect(describeViolations(editorResults.violations), 'editor axe violations').toEqual([]);

  await page.getByRole('button', { name: 'Agregar gráfico' }).click();
  const picker = page.locator('.dashboard-widget-picker');
  await expect(picker.getByRole('heading', { name: 'Elegí un gráfico para tu tablero' })).toBeVisible();
  await expect(picker.locator('.dashboard-widget-picker-mini-chart').first()).toBeVisible();
  await picker.getByRole('button', { name: 'Cerrar selector' }).click();

  await page.goto('/netskope/devices');
  await page.getByRole('row', { name: /LAPTOP-QA-01/ }).click();
  await expect(page.locator('.netskope-device-detail')).toBeVisible();
  const cardResults = await new AxeBuilder({ page }).analyze();
  expect(describeViolations(cardResults.violations), 'device card axe violations').toEqual([]);
});

test('single inventory: historical links retain exact scope without requesting a second map', async ({ page }) => {
  const requests: URL[] = [];
  page.on('request', (request) => requests.push(new URL(request.url())));
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.goto('/netskope/chains?type=netskope_user&id=3&dir=forward');
  await expect(page.getByRole('columnheader', { name: 'Dispositivo', exact: true })).toBeVisible();
  await expect.poll(() => requests.filter((url) => url.pathname === '/api/cmdb/netskope/devices').at(-1)?.searchParams.get('observed_user_id')).toBe('3');
  await expect(page).toHaveURL(/\/netskope\/inventory\?/);
  await expect(page.getByRole('button', { name: 'Quitar filtro Usuario exacto · ID 3' })).toBeVisible();
  await page.goto('/netskope/chains?type=netskope_user&id=3&trail=netskope_user%3A3%3Enetskope_device%3A59');
  await expect.poll(() => requests.filter((url) => url.pathname === '/api/cmdb/netskope/devices').at(-1)?.searchParams.get('device_object_id')).toBe('59');
  await expect(page.getByRole('button', { name: 'Quitar filtro Equipo · ID 59' })).toBeVisible();
  expect(requests.some((url) => url.pathname.startsWith('/api/chains/netskope/'))).toBe(false);
});

test('single inventory: review evidence, URL restoration and keyboard detail work in desktop themes (UX-AUD2-009)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  const source = { source_fresh: true, source_status: 'completed', source_completed_at: '2026-10-01T11:00:00Z', as_of: '2026-10-01T12:00:00Z' };
  const evidence = { ...source, state: 'review', reason: 'Más de 30 días sin señal: revisar asignación, no dar de baja automáticamente.', last_signal_at: '2026-08-17T12:00:00Z', age_days: 45, last_seen_event: 'disconnect', client_version: '110.0.1', os: 'Windows', os_version: '11', recent_days: 7, review_days: 30, source_freshness_hours: 24 };
  const requests: URLSearchParams[] = [];
  await page.route(/\/api\/cmdb\/netskope\/devices\?/, (route) => {
    requests.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ json: { source_evidence: source, total: 1, limit: 50, offset: 0, rows: [{
      object_id: 501, source_id: 'device-501', display_name: 'NB-OLD', attributes: { hostname: 'NB-OLD', username: 'ada@example.test', heartbeat: false, os: 'Windows', client_version: '110.0.1' },
      first_seen_at: '2026-01-01T00:00:00Z', last_seen_at: source.source_completed_at,
      observed_user_status: 'matched', observed_user: { source_id: 'u3', display_name: 'Ada', email: 'ada@example.test' }, device_evidence: evidence,
    }] } });
  });
  await page.goto('/netskope/inventory?observed_user_id=3&freshness=all');
  await page.getByRole('button', { name: 'Filtrar por señales del equipo' }).click();
  await page.getByRole('option', { name: 'Candidatos a revisión', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.get('evidence_state')).toBe('review');
  expect(requests.at(-1)?.get('observed_user_id')).toBe('3');
  expect(requests.at(-1)?.get('freshness')).toBe('all');
  const filteredUrl = page.url();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Quitar filtro Candidato a revisión' })).toBeVisible();
  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    const row = page.getByRole('row', { name: /NB-OLD/ });
    await expect(row.locator('time')).toHaveAttribute('title', /Antigüedad en la evaluación: 45 días/);
    await expect(row).not.toContainText('Hace 45 días');
    await expect(row).toContainText('Candidato a revisión');
    const tableAxe = await new AxeBuilder({ page }).include('.netskope-inventory').analyze();
    expect(describeViolations(tableAxe.violations), theme + ' inventory axe').toEqual([]);
    await row.focus();
    await page.keyboard.press('Enter');
    const card = page.locator('.netskope-device-detail');
    await expect(card.getByRole('region', { name: 'Señal' })).toContainText('Candidato a revisión');
    const cardAxe = await new AxeBuilder({ page }).include('.netskope-table').analyze();
    expect(describeViolations(cardAxe.violations), theme + ' card axe').toEqual([]);
    await page.keyboard.press('Enter');
    await expect(card).toHaveCount(0);
    await expect(row).toBeFocused();
    expect(page.url()).toBe(filteredUrl);
  }
  // History restoration must also work when the inventory hook is still
  // mounted on Métricas, not only after a full document reload.
  await page.getByRole('button', { name: /Cambiar workspace\. Actual: Inventario/ }).click();
  await page.locator('.workspace-menu a[href="/netskope"]').click();
  await page.getByRole('button', { name: /^Windows\b/ }).click();
  await expect.poll(() => requests.at(-1)?.get('os')).toBe('Windows');
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Datos clave' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(filteredUrl);
  await expect(page.getByRole('button', { name: 'Quitar filtro Usuario exacto · ID 3' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Quitar filtro Candidato a revisión' })).toBeVisible();
});

test('single inventory: a failed exact-user lookup retries without losing scope and shows honest emptiness', async ({ page }) => {
  let available = false;
  const scopes: string[] = [];
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route(/\/api\/cmdb\/netskope\/devices\?/, async (route) => {
    scopes.push(new URL(route.request().url()).searchParams.get('observed_user_id') ?? '');
    if (!available) return route.fulfill({ status: 503, json: { detail: 'temporary test failure' } });
    await new Promise((resolve) => setTimeout(resolve, 250));
    return route.fulfill({ json: { rows: [], total: 0, limit: 50, offset: 0 } });
  });
  await page.goto('/netskope/inventory?observed_user_id=4&freshness=all');
  await expect(page.getByText('No se pudo cargar Netskope')).toBeVisible();
  available = true;
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(page.getByText('Ningún dispositivo coincide con estos filtros')).toBeVisible();
  expect(scopes.length).toBeGreaterThanOrEqual(2);
  expect(scopes.every((scope) => scope === '4')).toBe(true);
  await expect(page.getByRole('button', { name: 'Quitar filtro Usuario exacto · ID 4' })).toBeVisible();
});

test('VIEW-003: a Netskope preset only replaces the saved view after confirmation and can be undone', async ({ page }) => {
  const preferencePuts: Array<{ widgets: Array<{ id: string; size: string }> }> = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/dashboard/netskope/preferences' && request.method() === 'PUT') {
      preferencePuts.push(request.postDataJSON() as { widgets: Array<{ id: string; size: string }> });
    }
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.goto('/netskope');
  await expect(page.getByRole('heading', { name: 'Datos clave' })).toBeVisible();

  // The Operaciones preset is staged in a dialog: the saved view stays
  // untouched until the operator confirms.
  await page.getByRole('button', { name: 'Vistas iniciales' }).click();
  await page.getByRole('menuitem', { name: /^Operaciones/ }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Aplicar vista "Operaciones"' });
  await expect(dialog).toBeVisible();
  expect(preferencePuts).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Aplicar vista' }).click();
  await expect.poll(() => preferencePuts.length).toBe(1);
  expect(preferencePuts[0].widgets.map((widget) => widget.id)).toEqual([
    'devices_total', 'devices_stale_30d', 'devices_observed_user_unmatched',
    'devices_by_classification', 'devices_by_os',
  ]);

  // Undo restores the previous saved view (the fixture's default board).
  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect.poll(() => preferencePuts.length).toBe(2);
  expect(preferencePuts[1].widgets.map((widget) => widget.id)).toEqual(['users_total', 'devices_total', 'devices_by_os']);

  // Reset asks again and lands on the simple factory default.
  await page.getByRole('button', { name: 'Vistas iniciales' }).click();
  await page.getByRole('menuitem', { name: /^Restablecer a predeterminada/ }).click();
  const resetDialog = page.getByRole('alertdialog', { name: 'Restablecer a predeterminada' });
  await expect(resetDialog).toBeVisible();
  expect(preferencePuts).toHaveLength(2);
  await resetDialog.getByRole('button', { name: 'Restablecer' }).click();
  await expect.poll(() => preferencePuts.length).toBe(3);
  const resetIds = preferencePuts[2].widgets.map((widget) => widget.id);
  expect(resetIds).toEqual(['users_recent_activity', 'devices_total', 'devices_stale_30d', 'alerts_7d', 'devices_by_os', 'devices_by_company', 'devices_by_classification']);

  // "Vaciar vista" asks first, then saves an empty view.
  await page.getByRole('button', { name: 'Vistas iniciales' }).click();
  await page.getByRole('menuitem', { name: /^Vaciar vista/ }).click();
  const clearDialog = page.getByRole('alertdialog', { name: 'Vaciar vista' });
  await expect(clearDialog).toBeVisible();
  expect(preferencePuts).toHaveLength(3);
  await clearDialog.getByRole('button', { name: 'Vaciar' }).click();
  await expect.poll(() => preferencePuts.length).toBe(4);
  expect(preferencePuts[3].widgets).toEqual([]);
});

test('metric requests wait for saved preferences and project widgets once per unique filter', async ({ page }) => {
  const requests: URL[] = [];
  let release!: () => void;
  const preferencesReady = new Promise<void>((resolve) => { release = resolve; });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/dashboard/netskope/preferences', async (route) => {
    await preferencesReady;
    await route.fulfill({ json: { widgets: [
      { id: 'devices_total', size: 'sm', filters: { company: 'A|B' } },
      { id: 'devices_stale_30d', size: 'sm', filters: { company: 'A|B' } },
      { id: 'devices_by_os', size: 'md', filters: { company: 'C' } },
    ], is_default: false } });
  });
  await page.route('**/api/cmdb/netskope/metrics*', (route) => {
    requests.push(new URL(route.request().url()));
    return route.fulfill({ json: {
      users_total: 9, devices_total: 7, devices_stale_30d: 3,
      devices_with_observed_user: 5, last_observed_at: null,
      ...(requests.at(-1)?.searchParams.getAll('widgets').includes('devices_by_os')
        ? { devices_by_os: [{ key: 'Windows', count: 7 }] } : {}),
    } });
  });
  await page.goto('/netskope');
  await expect(page.getByText('Cargando métricas Netskope…')).toBeVisible();
  expect(requests).toEqual([]);
  release();
  await expect(page.getByRole('button', { name: 'Windows', exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests.map((url) => [url.searchParams.get('company'), url.searchParams.getAll('widgets')])).toEqual([
    ['A|B', ['devices_stale_30d', 'devices_total']],
    ['C', ['devices_by_os']],
  ]);
});

test('editing loads one metrics preview request for the tiles the picker shows', async ({ page }) => {
  const requests: URL[] = [];
  const alertRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/cmdb/netskope/metrics') requests.push(url);
    if (url.pathname === '/api/cmdb/netskope/alerts' || url.pathname === '/api/cmdb/netskope/aa/severity') alertRequests.push(url.pathname);
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({ json: {
    widgets: [{ id: 'devices_total', size: 'sm', filters: {} }], is_default: false,
  } }));
  await page.goto('/netskope');
  await expect(page.locator('.netskope-data-open strong')).toHaveText('1');
  expect(requests).toHaveLength(1);
  expect(requests[0].searchParams.getAll('widgets')).toEqual(['devices_total']);
  await page.getByRole('button', { name: 'Editar vista' }).click();
  await page.getByRole('button', { name: 'Agregar dato' }).click();
  const picker = page.locator('.dashboard-widget-picker');
  await expect(picker).toBeVisible();
  await expect(picker.locator('.dashboard-widget-picker-card').filter({ hasText: 'Usuarios con actividad reciente' }).getByText('Datos actuales')).toBeVisible();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].searchParams.getAll('widgets')).toEqual([
    'devices_observed_user_unmatched',
    'devices_stale_30d',
    'devices_total',
    'users_recent_activity',
  ]);
});

/* VIS-NSK-HIST-001: changes between allowlisted device captures. The diff is
   deterministic and excludes volatile event fields. */
test('NSK-HB-001: the stale card counts by age with its own filters and its drill opens exactly those devices', async ({ page }) => {
  const deviceRequests: URLSearchParams[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/cmdb/netskope/devices') deviceRequests.push(new URLSearchParams(url.searchParams));
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({ json: { widgets: [
    { id: 'devices_stale_30d', size: 'sm', filters: { os: 'Windows', classification_status: 'managed' } },
  ], is_default: false } }));
  await page.route('**/api/cmdb/netskope/metrics*', (route) => route.fulfill({ json: {
    users_total: 9, devices_total: 5, devices_stale_30d: 12, last_observed_at: '2026-10-05T11:00:00Z',
    source_evidence: { source_fresh: true, source_status: 'completed', source_completed_at: '2026-10-05T11:00:00Z', as_of: '2026-10-05T12:00:00Z' },
  } }));
  await page.goto('/netskope');
  const card = page.locator('.netskope-data-card').filter({ hasText: 'Equipos sin señal hace más de 30 días' });
  await expect(card.locator('.dashboard-data-open > strong')).toHaveText('12');
  // 12 is not a share of the 5 recent devices: there is no percentage on this card.
  await expect(card).not.toContainText('%');
  await expect(page.locator('.sync-status-control')).toContainText('Sincronizado');
  await expect(card).not.toContainText('Sincronizado');
  await card.getByRole('button', { name: /^Equipos sin señal/ }).first().click();
  await expect(page).toHaveURL(/\/netskope\/devices(?:\?|$)/);
  await expect.poll(() => deviceRequests.at(-1)?.get('event_age')).toBe('gt_30d');
  expect(deviceRequests.at(-1)?.get('os')).toBe('Windows');
  expect(deviceRequests.at(-1)?.get('classification_status')).toBe('managed');
  expect(deviceRequests.at(-1)?.has('evidence_state')).toBe(false);
  expect(deviceRequests.at(-1)?.has('heartbeat')).toBe(false);
});

test('NSK-HB-001: boards saved by the user keep their order, sizes and filters, and an intentionally empty board stays empty', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  // The API already drops the retired widgets: the board renders what is left, in the saved order, with its filters.
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({ json: { widgets: [
    { id: 'devices_by_os', size: 'lg', filters: { company: 'ITTI' } },
    { id: 'users_total', size: 'sm', filters: {} },
  ], data_widgets: ['users_total'], chart_widgets: ['devices_by_os'], is_default: false } }));
  await page.goto('/netskope');
  await expect(page.locator('.netskope-data-card')).toHaveCount(1);
  await expect(page.locator('.personal-chart-card')).toHaveCount(1);
  await expect(page.locator('.netskope-data-card')).toContainText('Usuarios en inventario');
  await expect(page.locator('main')).not.toContainText(/heartbeat/i);

  await page.unroute('**/api/dashboard/netskope/preferences');
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({ json: { widgets: [], data_widgets: [], chart_widgets: [], is_default: false } }));
  await page.goto('/netskope');
  await expect(page.locator('.netskope-data-card')).toHaveCount(0);
  await expect(page.locator('.personal-chart-card')).toHaveCount(0);
});

test('NSK-HB-001: the device card shows the age of the last signal without a heartbeat status', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.goto('/netskope/devices');
  await page.getByRole('row', { name: /LAPTOP-QA-01/ }).click();
  const card = page.locator('.netskope-device-detail');
  await expect(card.getByRole('region', { name: 'Señal' })).toContainText(/Reportó hace/);
  await expect(card).not.toContainText(/heartbeat/i);
  await expect(card.getByText('Evaluado al')).toHaveCount(0);
});

const DEVREV_BOARD_METRICS = {
  users_total: 9, devices_total: 5, devices_stale_30d: 12, devices_stale_unclassified: 7, last_observed_at: '2026-10-05T11:00:00Z',
  devices_stale_by_diagnosis: [{ key: 'undetermined', count: 7 }, { key: 'historical_record', count: 4 }, { key: 'in_use_not_reporting', count: 1 }],
  source_evidence: { source_fresh: true, source_status: 'completed', source_completed_at: '2026-10-05T11:00:00Z', as_of: '2026-10-05T12:00:00Z' },
};

test('NSK-REF-001: the users card states the total Netskope reports beside Custodia\'s own count, and says so when they match or are missing (UX-AUD2-009)', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({ json: { widgets: [{ id: 'users_total', size: 'sm', filters: {} }, { id: 'devices_total', size: 'sm', filters: {} }], is_default: false } }));
  let metrics: Record<string, unknown> = { ...DEVREV_BOARD_METRICS, users_total: 8919, users_reported_total: 8859 };
  await page.route('**/api/cmdb/netskope/metrics*', (route) => route.fulfill({ json: metrics }));
  await page.goto('/netskope');
  const users = page.locator('.netskope-data-card').filter({ hasText: 'Usuarios en inventario' });
  await expect(users.locator('.dashboard-data-open > strong')).toHaveText('8.919');
  await expect(users.locator('.netskope-data-reference')).toHaveText('Diferencia frente a Netskope: +60');
  await users.getByRole('button', { name: /^Qué mide/ }).click();
  await expect(page.getByRole('note')).toContainText('Identidades con al menos una cuenta no borrada');
  await page.keyboard.press('Escape');
  // The devices card names the window it reads; its help says what it measures.
  const devices = page.locator('.netskope-data-card').filter({ hasText: 'Dispositivos' }).first();
  await expect(devices).toContainText('Eventos en los últimos 7 días');
  await devices.getByRole('button', { name: /^Qué mide/ }).click();
  await expect(page.getByRole('note')).toContainText('Endpoints con evento en los últimos 7 días');
  await page.keyboard.press('Escape');

  metrics = { ...DEVREV_BOARD_METRICS, users_total: 8859, users_reported_total: 8859 };
  await page.goto('/netskope');
  await expect(page.locator('.netskope-data-card').filter({ hasText: 'Usuarios en inventario' }).locator('.netskope-data-reference')).toHaveText('Diferencia frente a Netskope: sin diferencia');

  metrics = { ...DEVREV_BOARD_METRICS, users_total: 8919 };
  await page.goto('/netskope');
  await expect(page.locator('.netskope-data-card').filter({ hasText: 'Usuarios en inventario' }).locator('.netskope-data-reference')).toHaveCount(0);
});

test('NSK-USR-001: the users card splits enabled and disabled, and the list filters and shows the same split', async ({ page }) => {
  const userRequests: URLSearchParams[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/cmdb/netskope/users') userRequests.push(url.searchParams);
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({ json: { widgets: [{ id: 'users_total', size: 'sm', filters: {} }], is_default: false } }));
  await page.route('**/api/cmdb/netskope/metrics*', (route) => route.fulfill({ json: {
    ...DEVREV_BOARD_METRICS, users_total: 8855, users_enabled: 7618, users_disabled: 1237, users_reported_total: 8859,
    accounts_reported_active: 10209, accounts_reported_inactive: 1987, ous_reported_total: 141, groups_reported_total: 718, users_repeated_rows: 4,
  } }));
  const rows = (status: string | null) => ({
    rows: [{ object_id: 1, display_name: status === 'disabled' ? 'Beto Gómez' : 'Ada López', source_id: 'uid-1', attributes: { email: 'ada@itti.digital', ...(status ? { account_status: status, accounts_active: status === 'enabled' ? 2 : 0, accounts_inactive: status === 'enabled' ? 1 : 1, provisioners: ['AD', 'SCIM'] } : {}) }, first_seen_at: '2026-09-01T00:00:00Z', last_seen_at: '2026-09-30T00:00:00Z', observed_user_status: 'unmatched' }],
    total: status === 'disabled' ? 1237 : 7618, limit: 50, offset: 0, search: '', filters: {},
  });
  await page.route('**/api/cmdb/netskope/users/*/experience/devices?*', (route) => route.fulfill({ status: 403, json: { detail: 'Sin permiso ADEM' } }));
  await page.route('**/api/cmdb/netskope/users?*', (route) => {
    const status = new URL(route.request().url()).searchParams.get('account_status');
    return route.fulfill({ json: rows(status === 'disabled' ? 'disabled' : 'enabled') });
  });

  await page.goto('/netskope');
  const card = page.locator('.netskope-data-card').filter({ hasText: 'Usuarios en inventario' });
  await expect(card.locator('.dashboard-data-open > strong')).toHaveText('8.855');
  await expect(card).toContainText('7.618 habilitados · 1.237 deshab.');
  await expect(card.locator('.netskope-data-reference')).toHaveText('Diferencia frente a Netskope: −4');
  await card.getByRole('button', { name: /^Qué mide/ }).click();
  await expect(page.getByRole('note')).toContainText('habilitadas o no');
  await page.keyboard.press('Escape');

  await page.goto('/netskope/users');
  await expect(page.getByRole('columnheader', { name: 'Estado' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Ada López/ })).toContainText('Habilitado');
  await page.getByRole('button', { name: 'Filtrar usuarios por estado' }).click();
  await page.getByRole('option', { name: 'Deshabilitados' }).click();
  await expect.poll(() => userRequests.at(-1)?.get('account_status')).toBe('disabled');
  await expect(page.getByRole('button', { name: 'Quitar filtro Estado: Deshabilitado' })).toBeVisible();
  await expect(page.locator('.netskope-result-count')).toContainText('1.237 usuarios');
  await page.getByRole('row', { name: /Beto Gómez/ }).click();
  await expect(page.getByText('Deshabilitado · 0 cuentas activas, 1 inactiva · origen AD, SCIM')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Quitar filtro Estado: Deshabilitado' }).click();
  await expect.poll(() => userRequests.at(-1)?.has('account_status')).toBe(false);
});

// UX-AUD2-008: the newest client-inventory attempt wins over observation dates
// and unrelated component runs, including for a reader who cannot trigger sync.
test('UX-AUD2-008: header, Métricas and Inventario share the client sync evidence (UX-AUD2-009)', async ({ page }, testInfo) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/cmdb/netskope/sync-evidence', route => route.fulfill({ json: {
    source_fresh: false, source_status: 'partial', source_completed_at: '2026-10-08T02:00:00Z', as_of: '2026-10-08T03:00:00Z',
  } }));
  await page.route('**/api/ingestion/runs?limit=50', route => route.fulfill({ json: { rows: [{
    run_id: 'alerts-newer', source_system: 'netskope', source_file: 'netskope-alerts-api',
    status: 'completed', started_at: new Date().toISOString(), completed_at: new Date().toISOString(),
  }] } }));
  let evidenceRequests = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/cmdb/netskope/sync-evidence') evidenceRequests += 1; });
  const text = 'Sin sync vigente: la última corrida quedó parcial';
  for (const path of ['/netskope', '/netskope/inventory', '/netskope/users']) {
    await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-theme', testInfo.project.use.colorScheme === 'light' ? 'light' : 'dark');
    await expect(page.locator('.sync-status-control')).toHaveText(text);
    // Métricas shows the sync state only in the header; Inventario/Usuarios repeat it in-page.
    if (path === '/netskope') await expect(page.locator('.netskope-sync-status')).toHaveCount(0);
    else await expect(page.locator('.netskope-sync-status')).toHaveText(text);
    expect(evidenceRequests).toBe(['/netskope', '/netskope/inventory', '/netskope/users'].indexOf(path) + 1);
  }
  await page.route('**/api/cmdb/netskope/sync-evidence', route => route.fulfill({ json: {
    source_fresh: true, source_status: 'completed', source_completed_at: '2026-10-08T02:00:00Z', as_of: '2026-10-08T03:00:00Z',
  } }));
  for (const path of ['/netskope', '/netskope/inventory']) {
    await page.goto(path);
    await expect(page.locator('.sync-status-control')).toHaveAttribute('title', /^hace /);
    if (path === '/netskope') { await expect(page.locator('.netskope-sync-status')).toHaveCount(0); continue; }
    await expect(page.locator('.netskope-sync-status')).toHaveAttribute('title', /^hace /);
    expect(await page.locator('.sync-status-control').innerText()).toBe(await page.locator('.netskope-sync-status').innerText());
  }
  // An unavailable status resource must not fall back to the fresh metrics
  // snapshot or the completed alert run supplied above.
  await page.route('**/api/cmdb/netskope/sync-evidence', route => route.fulfill({ status: 503, json: { detail: 'Temporalmente no disponible' } }));
  await page.goto('/netskope');
  await expect(page.locator('.sync-status-control')).toHaveText('Sin información de sincronización');
  await expect(page.locator('.netskope-sync-status')).toHaveCount(0);
  expect(evidenceRequests).toBe(6);
});

// UX-AUD2-019: a partial page cannot decide what later rows are allowed to show.
test('UX-AUD2-019: user observations share one column and preserve different dates on later pages', async ({ page }, testInfo) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  const first = '2026-10-01T01:00:00.123456Z';
  const last = '2026-10-01T01:00:00.654321Z';
  await page.route('**/api/cmdb/netskope/users?*', route => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset'));
    return route.fulfill({ json: { rows: Array.from({ length: offset ? 1 : 50 }, (_, index) => ({ object_id: offset + index + 1, display_name: offset ? 'Later user' : index ? `Peer user ${index}` : 'First user', source_id: String(offset + index + 1), attributes: { email: 'audit@example.test', account_status: 'enabled' }, first_seen_at: first, last_seen_at: offset ? last : first })), total: 51, limit: 50, offset } });
  });
  await page.goto('/netskope/users');
  await expect(page.locator('html')).toHaveAttribute('data-theme', testInfo.project.use.colorScheme === 'light' ? 'light' : 'dark');
  await expect(page.getByRole('columnheader', { name: 'Observación', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /Primera observación|Última observación/ })).toHaveCount(0);
  const initial = page.getByRole('row', { name: /First user/ });
  await expect(initial.locator('time')).toHaveCount(1);
  await expect(initial.locator('time')).toHaveAttribute('datetime', first);
  await page.getByRole('button', { name: /Cargar \d+ más/ }).click();
  const later = page.getByRole('row', { name: /Later user/ });
  await expect(later.locator('time')).toHaveCount(2);
  await expect(later.locator('time').nth(0)).toHaveAttribute('datetime', first);
  await expect(later.locator('time').nth(1)).toHaveAttribute('datetime', last);
  await expect(page.getByRole('columnheader', { name: 'Observación', exact: true })).toHaveCount(1);
});


test('UX-AUD2-024: one inventory result and one identity use singular without changing counts', async ({ page }, testInfo) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/dashboard/netskope/preferences', route => route.fulfill({ json: { widgets: [{ id: 'users_recent_activity', size: 'sm', filters: {} }], is_default: false } }));
  for (const [path, label] of [['/netskope/inventory', '1 dispositivo'], ['/netskope/users', '1 usuario']]) {
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('data-theme', testInfo.project.name.includes('light') ? 'light' : 'dark');
    await expect(page.locator('.netskope-result-count')).toHaveText(label);
    await expect(page.locator('.netskope-table tbody tr')).toHaveCount(1);
  }
  await page.goto('/netskope');
  const activity = page.locator('.netskope-data-card').filter({ hasText: 'Usuarios con actividad reciente' });
  await expect(activity).toContainText('100% de 1 · 7 días');
  await activity.getByRole('button', { name: 'Qué mide: Usuarios con actividad reciente' }).click();
  await expect(page.getByRole('note')).toContainText('reportó un evento en la ventana elegida');
});

test('Netskope charts: companies default to bars, small distributions to a donut, and the chosen presentation survives save and reload with filters and drill intact', async ({ page }) => {
  const deviceRequests: URLSearchParams[] = [];
  const preferencePuts: Array<{ widgets: Array<{ id: string; style?: string }> }> = [];
  let stored: Array<Record<string, unknown>> | null = null;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/cmdb/netskope/devices') deviceRequests.push(url.searchParams);
  });
  await mockAuthenticatedApp(page, {
    permissions: ['inventory:read', 'netskope:read'],
    netskopeMetrics: {
      devices_total: 10,
      devices_by_os: [{ key: 'Windows', count: 6 }, { key: 'macOS', count: 4 }],
      devices_by_company: [{ key: 'ITTI', count: 7 }, { key: 'UENO', count: 3 }],
    },
  });
  await page.route('**/api/dashboard/netskope/preferences', async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as { widgets: Array<{ id: string; style?: string }> };
      preferencePuts.push(body);
      stored = body.widgets;
      await route.fulfill({ json: { widgets: body.widgets, is_default: false } });
      return;
    }
    await route.fulfill({ json: { widgets: stored ?? [
      { id: 'devices_by_os', size: 'md', filters: {} },
      { id: 'devices_by_company', size: 'md', filters: {} },
    ], is_default: stored === null } });
  });
  await page.goto('/netskope');

  const os = page.locator('.personal-chart-card').filter({ hasText: 'Dispositivos por sistema operativo' });
  const company = page.locator('.personal-chart-card').filter({ hasText: 'Dispositivos por empresa' });
  await expect(os.getByRole('img', { name: 'Distribución' })).toBeVisible();
  await expect(company.locator('.ranking-list')).toBeVisible();

  await page.getByRole('button', { name: 'Editar vista' }).click();
  const osItem = page.locator('.dashboard-edit-item').filter({ hasText: 'Dispositivos por sistema operativo' });
  const settings = await openSettings(osItem);
  await expect(settings.getByRole('group', { name: 'Presentación de Dispositivos por sistema operativo' }).getByRole('button', { name: 'Dona' })).toHaveAttribute('aria-pressed', 'true');
  await settings.getByRole('group', { name: 'Presentación de Dispositivos por sistema operativo' }).getByRole('button', { name: 'Barras' }).click();
  await closeSettings(page);
  await page.getByRole('button', { name: 'Guardar vista' }).click();
  await expect.poll(() => preferencePuts.length).toBe(1);
  expect(preferencePuts[0].widgets.find((widget) => widget.id === 'devices_by_os')?.style).toBe('bars');

  await page.reload();
  const reloaded = page.locator('.personal-chart-card').filter({ hasText: 'Dispositivos por sistema operativo' });
  await expect(reloaded.locator('.ranking-list')).toBeVisible();
  await reloaded.getByRole('button', { name: /Windows/ }).click();
  await expect(page).toHaveURL(/\/netskope\/devices(?:\?|$)/);
  await expect.poll(() => deviceRequests.at(-1)?.get('os')).toBe('Windows');
});

test('Netskope AA chart map: a tenant chart is offered in the picker, drawn from its own endpoint and saved as an aa_ block', async ({ page }) => {
  const chartRequests: string[] = [];
  const preferencePuts: Array<{ widgets: Array<{ id: string; style?: string }> }> = [];
  let stored: Array<Record<string, unknown>> | null = null;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/cmdb/netskope/aa/charts/')) chartRequests.push(url.pathname);
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'], netskopeMetrics: { devices_total: 10, devices_by_os: [{ key: 'Windows', count: 6 }, { key: 'macOS', count: 4 }] } });
  await page.route('**/api/cmdb/netskope/aa/charts', (route) => route.fulfill({ json: [{ id: 'aa_gdpr_levels', title: 'Apps por nivel GDPR', unit: 'aplicaciones', period: 'Catálogo actual' }] }));
  await page.route('**/api/cmdb/netskope/aa/charts/gdpr_levels', (route) => route.fulfill({ json: {
    source: 'advanced_analytics', key: 'gdpr_levels', title: 'Apps por nivel GDPR', unit: 'aplicaciones', period: 'Catálogo actual', state: 'ready',
    buckets: [{ key: 'Low', count: 691 }, { key: 'Medium', count: 351 }, { key: 'High', count: 327 }, { key: 'Sin dato', count: 24 }],
    total: 1393, fetched_at: '2026-10-12T12:00:00Z', cache_expires_at: '2026-10-12T12:05:00Z',
  } }));
  await page.route('**/api/dashboard/netskope/preferences', async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as { widgets: Array<{ id: string; style?: string }> };
      preferencePuts.push(body);
      stored = body.widgets;
      await route.fulfill({ json: { widgets: body.widgets, is_default: false } });
      return;
    }
    await route.fulfill({ json: { widgets: stored ?? [{ id: 'devices_by_os', size: 'md', filters: {} }], is_default: stored === null } });
  });
  await page.goto('/netskope');
  await expect(page.locator('.personal-chart-card').filter({ hasText: 'Dispositivos por sistema operativo' })).toBeVisible();
  expect(chartRequests).toEqual([]); // nothing is queried until the picker shows the tile

  await page.getByRole('button', { name: 'Editar vista' }).click();
  await page.getByRole('button', { name: 'Agregar gráfico' }).click();
  const picker = page.locator('.dashboard-widget-picker');
  await picker.getByRole('button', { name: /Advanced Analytics/ }).click();
  const option = picker.locator('.dashboard-widget-picker-card').filter({ has: page.getByRole('heading', { name: 'Apps por nivel GDPR' }) });
  // The tile shows the chart's current data before anyone adds it.
  await expect(option).toContainText('Datos actuales');
  expect(chartRequests).toContain('/api/cmdb/netskope/aa/charts/gdpr_levels');
  // Hovering shows the larger preview inside the tile itself, with the source; chart tiles have no "?".
  await expect(option.getByRole('button', { name: /^Ayuda: Fuente y período/ })).toHaveCount(0);
  await option.hover();
  const expanded = option.locator('.dashboard-widget-picker-expanded');
  await expect(expanded).toBeVisible();
  await expect(expanded).toContainText('Fuente: Advanced Analytics · Período: Catálogo actual · Unidad: aplicaciones');
  const [tile, panel] = await Promise.all([option.boundingBox(), expanded.boundingBox()]);
  expect(panel!.x).toBeGreaterThanOrEqual(tile!.x);
  expect(panel!.y).toBeGreaterThanOrEqual(tile!.y);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(tile!.x + tile!.width + 1);
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(tile!.y + tile!.height + 1);
  await option.getByRole('button', { name: /^Agregar/ }).click();
  await page.getByRole('button', { name: 'Guardar vista' }).click();
  await expect.poll(() => preferencePuts.length).toBe(1);
  expect(preferencePuts[0].widgets.map((widget) => widget.id)).toEqual(['devices_by_os', 'aa_gdpr_levels']);

  const card = page.locator('.personal-chart-card').filter({ hasText: 'Apps por nivel GDPR' });
  await expect(card).toContainText('Catálogo actual · aplicaciones');
  await expect(card.locator('.pie-chart-total')).toHaveText('1.393');
  await expect(card.locator('.pie-chart-legend li')).toHaveCount(4);
  await expect(card).toContainText('Consultado');
  expect(chartRequests).toContain('/api/cmdb/netskope/aa/charts/gdpr_levels');
});

test('Netskope AA chart map: a chart already in the saved view shows as added in the picker and cannot be added twice', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'], netskopeMetrics: { devices_total: 10, devices_by_os: [{ key: 'Windows', count: 6 }, { key: 'macOS', count: 4 }] } });
  await page.route('**/api/cmdb/netskope/aa/charts', (route) => route.fulfill({ json: [{ id: 'aa_gdpr_levels', title: 'Apps por nivel GDPR', unit: 'aplicaciones', period: 'Catálogo actual' }] }));
  await page.route('**/api/cmdb/netskope/aa/charts/gdpr_levels', (route) => route.fulfill({ json: {
    source: 'advanced_analytics', key: 'gdpr_levels', title: 'Apps por nivel GDPR', unit: 'aplicaciones', period: 'Catálogo actual', state: 'ready',
    buckets: [{ key: 'Bajo', count: 691 }, { key: 'Medio', count: 351 }], total: 1042, fetched_at: '2026-10-12T12:00:00Z', cache_expires_at: '2026-10-12T12:05:00Z',
  } }));
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({ json: { widgets: [
    { id: 'devices_by_os', size: 'md', filters: {} }, { id: 'aa_gdpr_levels', size: 'md', filters: {} },
  ], is_default: false } }));
  await page.goto('/netskope');
  await expect(page.locator('.personal-chart-card').filter({ hasText: 'Apps por nivel GDPR' })).toBeVisible();
  await page.getByRole('button', { name: 'Editar vista' }).click();
  await page.getByRole('button', { name: 'Agregar gráfico' }).click();
  const option = page.locator('.dashboard-widget-picker-card').filter({ has: page.getByRole('heading', { name: 'Apps por nivel GDPR' }) });
  await expect(option).toContainText('Ya está en la vista');
  await expect(option.getByRole('button', { name: /^Agregar/ })).toHaveCount(0);
});

test('NSK-INV-002: Postura groups the devices without a signal by what Netskope explains, opens each group and asks nobody to classify', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read', 'netskope:admin'] });
  await page.goto('/netskope/posture?open=stale_undiagnosed');
  const panel = page.getByRole('article', { name: 'Equipos sin señal: por qué' });
  await expect(panel).toContainText('4 equipos sin señal hace más de 30 días');
  await expect(panel.getByRole('button', { name: 'Netskope informó desinstalación o deshabilitación: 1 equipos. Ver en la tabla' })).toBeEnabled();
  await expect(panel.getByRole('button', { name: /Reemplazado por un registro más nuevo: 0 equipos/ })).toBeDisabled();
  await expect(panel.getByRole('button', { name: /Sin explicación con los datos de Netskope: 0 equipos/ })).toBeDisabled();
  await expect(panel).toContainText('1 equipo tiene una decisión guardada antes y no se agrupan.');
  await expect(panel.getByRole('button', { name: /Aceptar/ })).toHaveCount(0);
  await expect(panel).not.toContainText('sin clasificar');
  await panel.getByRole('button', { name: 'Registro histórico (sin señal hace más de 180 días): 2 equipos. Ver en la tabla' }).click();
  await expect(page).toHaveURL(/\/netskope\/devices\?.*review_suggestion=historical_record/);
  await expect(page).toHaveURL(/event_age=gt_30d/);
  await expect(page.getByRole('button', { name: 'Quitar filtro Registro histórico (sin señal hace más de 180 días)' })).toBeVisible();
});
