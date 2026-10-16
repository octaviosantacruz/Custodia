import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { createDashboardShortcut } from '../../../src/cyberark/pam/lib/dashboard-metrics';
import { expect, mockAuthenticatedApp, test } from '../support/fixtures';

async function keyboardExplain(page: Page, name: string) {
  const trigger = page.getByRole('button', { name: `Explicar ${name}`, exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  return trigger.locator('..');
}

/** Netskope data cards keep a short "Qué mide" note; the long reading lives in the guide. */
async function keyboardWhatItMeasures(page: Page, title: string) {
  const trigger = page.getByRole('button', { name: `Qué mide: ${title}`, exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  return page.getByRole('note');
}

for (const scenario of [
  { name: 'zero numerator', total: 4, covered: 0, status: 'available', expected: '0%' },
  { name: 'no population', total: 0, covered: 0, status: 'unavailable', expected: 'No calculable' },
  { name: 'incomplete numerator', total: 4, covered: undefined, status: 'pending', expected: 'No calculable' },
] as const) {
  test(`KR1 reading preserves a custom title and explains ${scenario.name} (UX-AUD2-009)`, async ({ page }) => {
    const widget = { ...createDashboardShortcut('kr1-safe-coverage', 0), title: 'Mi lectura de Safes', value: 0, total_count: scenario.total, covered_count: scenario.covered, data_status: scenario.status, measured_at: scenario.name === 'zero numerator' ? '2026-10-01T08:00:00Z' : undefined };
    const kr6 = { ...createDashboardShortcut('kr6-cyberark-compliance', 1), value: 50, total_accounts: 2, compliant_accounts: 1, data_status: 'available' };
    await mockAuthenticatedApp(page, { dashboardWidgets: [widget, kr6] });
    await page.goto('/pam');
    const card = page.locator('.dashboard-data-item').filter({ hasText: 'Mi lectura de Safes' });
    await expect(card.locator('.dashboard-data-open > strong')).toHaveText(scenario.expected);
    const help = card.getByRole('button', { name: 'Explicar Mi lectura de Safes', exact: true });
    await expect(help).toHaveAttribute('aria-expanded', 'false');
    await expect(card.getByText('KR1 · completitud de inventario')).toHaveCount(0);
    await expect(card.getByRole('tooltip')).toHaveCount(0);
    await keyboardExplain(page, 'Mi lectura de Safes');
    const detail = card.getByRole('tooltip');
    await expect(detail).toBeVisible();
    await expect(help).toHaveAttribute('aria-expanded', 'true');
    await expect(detail).toContainText(`de ${scenario.total} Safes activos`);
    await expect(detail).toContainText('KR1 · completitud de inventario');
    await expect(page.locator('html')).toHaveAttribute('data-theme', test.info().project.name.includes('light') ? 'light' : 'dark');
    if (scenario.name === 'zero numerator') {
      await expect(detail.locator('time[datetime="2026-10-01T08:00:00Z"]')).toHaveAttribute('title', /^hace /);
    } else {
      await expect(detail).toContainText('Fecha de captura no informada');
      await expect(detail.locator('time')).toHaveCount(0);
    }
    await expect(detail).toContainText('Desconocidos: conteo no informado');
    await expect(detail.getByText('Fórmula', { exact: true })).toBeVisible();
    await expect(detail).toContainText('× 100');
    await expect(detail).toContainText('no representa el KR1 formal completo');
    await page.keyboard.press('Escape');
    await expect(card.getByRole('tooltip')).toHaveCount(0);
    await expect(help).toBeFocused();
    const compliance = page.locator('.dashboard-data-item').filter({ hasText: kr6.title });
    await expect(compliance.locator('button.dashboard-data-open')).toHaveCount(0);
    await expect(compliance.locator('.dashboard-data-open.is-static')).toBeVisible();
  });
}

test('Netskope explanations preserve unknowns, selected windows and filtered populations (UX-AUD2-009)', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({ json: { widgets: [
    { id: 'devices_stale_30d', size: 'sm', filters: { os: 'Windows' } },
    { id: 'users_recent_activity', size: 'sm', filters: {} },
    { id: 'devices_by_observed_user_status', size: 'md', filters: { os: 'Windows' } },
  ], is_default: false } }));
  await page.route('**/api/cmdb/netskope/metrics*', (route) => route.fulfill({ json: {
    users_total: 4, users_with_device_activity_7d: 0, users_with_device_activity_14d: 2, users_with_device_activity_30d: 3,
    devices_total: 5, devices_stale_30d: 7,
    source_evidence: { source_fresh: false, source_status: 'partial', source_completed_at: '2026-10-05T08:00:00Z', as_of: '2026-10-05T12:00:00Z' },
    devices_by_observed_user_status: [{ key: 'matched', count: 3 }, { key: 'unmatched', count: 2 }],
    last_observed_at: '2026-09-30T12:00:00Z',
  } }));
  await page.route('**/api/cmdb/netskope/sync-evidence', route => route.fulfill({ json: {
    source_fresh: false, source_status: 'partial', source_completed_at: '2026-10-05T08:00:00Z', as_of: '2026-10-05T12:00:00Z',
  } }));
  await page.goto('/netskope');
  const stale = page.locator('.netskope-data-card').filter({ hasText: 'Equipos sin señal hace más de 30 días' });
  await expect(stale).not.toContainText('Cargando métricas'); // the card re-renders when metrics arrive
  await expect(stale.getByRole('note')).toHaveCount(0); // the help lives behind the "?"
  await expect(stale.locator('.dashboard-data-open > strong')).toHaveText('7');
  // The card describes its inventory observation; current sync is shared by the headings, and snapshot methodology stays in the hint.
  await expect(page.locator('.sync-status-control')).toContainText('Sin sync vigente: la última corrida quedó parcial');
  await expect(stale).not.toContainText('Sin sync vigente');
  await expect(stale).not.toContainText('al último sync completo');
  await expect(stale).not.toContainText('%');
  await stale.getByRole('button', { name: 'Qué mide: Equipos sin señal hace más de 30 días', exact: true }).click();
  const explanation = stale.getByRole('note');
  await expect(explanation).toContainText('Equipos activos cuyo último evento tiene más de 30 días');
  await expect(explanation.getByRole('link', { name: /Más detalles en Ayuda/ })).toHaveAttribute('href', '/help?section=netskope');
  await expect(page.locator('html')).toHaveAttribute('data-theme', test.info().project.name.includes('light') ? 'light' : 'dark');
  await page.keyboard.press('Escape');
  const activity = page.locator('.netskope-data-card').filter({ hasText: 'Usuarios con actividad reciente' });
  await activity.getByRole('button', { name: '14 días' }).click();
  await expect(activity).toContainText('50% de 4 · 14 días');
  await expect(activity.locator('.dashboard-data-open > strong')).toHaveText('2');
  const chart = page.locator('.personal-chart-card').filter({ hasText: 'Dispositivos por usuario observado' });
  await expect(chart.locator('.pie-chart-total')).toHaveText('5');
  await expect(chart.locator('.pie-chart-total-label')).toHaveText('población');
  await expect(chart.locator('.pie-chart-legend-pct')).toHaveText(['60%', '40%']);
});

test('NSK-HB-001: zero stale devices is a valid count, not a missing population', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({ json: { widgets: [
    { id: 'devices_stale_30d', size: 'sm', filters: { os: 'Windows' } },
  ], is_default: false } }));
  await page.route('**/api/cmdb/netskope/metrics*', (route) => route.fulfill({ json: {
    devices_total: 8, devices_stale_30d: 0,
    source_evidence: { source_fresh: true, source_status: 'completed', source_completed_at: '2026-10-05T08:00:00Z', as_of: '2026-10-05T09:00:00Z' },
  } }));
  await page.goto('/netskope');
  const card = page.locator('.netskope-data-card').filter({ hasText: 'Equipos sin señal hace más de 30 días' });
  await expect(card.locator('.dashboard-data-open > strong')).toHaveText('0');
  const note = await keyboardWhatItMeasures(page, 'Equipos sin señal hace más de 30 días');
  await expect(note).toContainText('Equipos activos cuyo último evento tiene más de 30 días');
  await expect(note).not.toContainText('Sin población');
  await expect(card).not.toContainText('No calculable');
});

test('Netskope observed-user PieChart reports inconsistent population without invalid percentages or arcs', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({ json: { widgets: [
    { id: 'devices_by_observed_user_status', size: 'md', filters: {} },
  ], is_default: false } }));
  await page.route('**/api/cmdb/netskope/metrics*', (route) => route.fulfill({ json: {
    users_total: 0,
    devices_total: 3,
    devices_by_observed_user_status: [{ key: 'matched', count: 2 }, { key: 'ambiguous', count: 2 }, { key: 'unmatched', count: 1 }],
    last_observed_at: '2026-09-30T12:00:00Z',
  } }));
  await page.goto('/netskope');

  const chart = page.locator('.personal-chart-card').filter({ hasText: 'Dispositivos por usuario observado' });
  await expect(chart.getByRole('status')).toContainText('Población inconsistente: total 3 menor que la suma visible 5');
  await expect(chart.locator('.pie-chart-total')).toHaveText('—');
  await expect(chart.locator('.pie-chart-total-label')).toHaveText('población inconsistente');
  await expect(chart.locator('.pie-chart-legend li')).toHaveCount(3);
  await expect(chart.locator('.pie-chart-legend li').nth(0)).toContainText('Con usuario resuelto');
  await expect(chart.locator('.pie-chart-legend li').nth(0)).toContainText('2');
  await expect(chart.locator('.pie-chart-legend li').nth(1)).toContainText('Ambiguo');
  await expect(chart.locator('.pie-chart-legend li').nth(1)).toContainText('2');
  await expect(chart.locator('.pie-chart-legend li').nth(2)).toContainText('Sin resolver');
  await expect(chart.locator('.pie-chart-legend li').nth(2)).toContainText('1');
  await expect(chart.locator('.pie-chart-legend-pct')).toHaveText(['—', '—', '—']);
  await expect(chart.locator('.pie-chart-slice')).toHaveCount(3);
  const arcsAreValid = await chart.locator('.pie-chart-slice').evaluateAll((paths) => paths.every((path) => !/NaN|Infinity/.test(path.getAttribute('d') ?? '')));
  expect(arcsAreValid).toBe(true);
});

test('small nonzero chart slices are labeled below one percent instead of zero', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({ json: { widgets: [
    { id: 'devices_by_observed_user_status', size: 'md', filters: {} },
  ], is_default: false } }));
  await page.route('**/api/cmdb/netskope/metrics*', (route) => route.fulfill({ json: {
    devices_total: 1000,
    devices_by_observed_user_status: [
      { key: 'matched', count: 998 }, { key: 'ambiguous', count: 1 }, { key: 'unmatched', count: 1 },
    ],
    last_observed_at: '2026-10-05T12:00:00Z',
  } }));
  await page.goto('/netskope');

  const chart = page.locator('.personal-chart-card').filter({ hasText: 'Dispositivos por usuario observado' });
  await expect(chart.locator('.pie-chart-legend-pct')).toHaveText(['100%', '<1%', '<1%']);
});

test('Netskope zero populations and incomplete activity stay explicit', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({ json: { widgets: [
    { id: 'devices_total', size: 'sm' }, { id: 'users_recent_activity', size: 'sm' },
  ], is_default: false } }));
  await page.route('**/api/cmdb/netskope/metrics*', (route) => route.fulfill({ json: {
    users_total: 0, devices_total: 0, last_observed_at: null,
  } }));
  await page.goto('/netskope');
  const devices = page.locator('.netskope-data-card').filter({ hasText: 'Dispositivos' }).first();
  await expect(devices).not.toContainText('Cargando métricas');
  await devices.getByRole('button', { name: 'Qué mide: Dispositivos', exact: true }).click();
  await expect(page.getByRole('note')).toContainText('Endpoints con evento en los últimos 7 días');
  await page.keyboard.press('Escape');
  await expect(devices).not.toContainText('0%');
  const activity = page.locator('.netskope-data-card').filter({ hasText: 'Usuarios con actividad reciente' });
  await expect(activity).not.toContainText('Cargando métricas');
  await expect(activity.getByRole('button', { name: 'Ver usuarios' })).toBeDisabled();
});

test('NSK-FLEET-001 Equipos with an empty population reads Sin dato instead of a fabricated 0 %', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  const zero = { devices: 0, signal_24h: 0, client_current: 0, client_evaluated: 0, os_supported: 0, os_evaluated: 0, on_prem: 0, location_reported: 0 };
  await page.route('**/api/cmdb/netskope/devices/fleet-groups*', (route) => route.fulfill({ json: {
    group_by: 'company', client_baseline: true, os_baseline: false, summary: zero, groups: [], omitted_groups: 0, omitted_devices: 0,
  } }));
  await page.goto('/netskope/operations');
  const kpis = page.getByRole('group', { name: 'Resumen de la flota' });
  await expect(kpis.getByRole('button', { name: /Señal en 24 h/ })).toContainText('Sin dato');
  await expect(kpis.getByRole('button', { name: /Cliente al día/ })).toContainText('Sin dato');
  await expect(kpis).not.toContainText('0 %');
  await expect(page.getByText('Sin equipos activos con evento en 7 días')).toBeVisible();
});

test('metric disclosures stay readable and keyboard accessible on desktop dark and light', async ({ page }) => {
  test.setTimeout(90_000); // Twelve scoped Axe scans across three workspaces.
  await mockAuthenticatedApp(page, { dashboardWidgets: [{ ...createDashboardShortcut('kr1-safe-coverage', 0), value: 50, total_count: 4, covered_count: 2, data_status: 'available' }], permissions: ['inventory:read', 'netskope:read'] });
  for (const path of ['/pam', '/netskope', '/netskope/posture?open=stale_undiagnosed']) {
    await page.goto(path);
    const name = path === '/pam' ? 'KR1 · Safes con cuentas' : path === '/netskope' ? 'Dispositivos' : 'Equipos sin señal: por qué';
    if (path === '/netskope') await keyboardWhatItMeasures(page, name); else await keyboardExplain(page, name);
    for (const theme of ['dark', 'light']) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      for (const size of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
        await page.setViewportSize(size);
        const scan = await new AxeBuilder({ page }).include(path === '/pam' ? '[role="tooltip"]' : path === '/netskope' ? '.netskope-data-tooltip' : '.metric-reading').withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(scan.violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      }
      await page.screenshot({ path: `/tmp/dshub-metric-reading-${path === '/pam' ? 'pam' : path === '/netskope' ? 'netskope' : 'posture'}-${theme}.png`, fullPage: true });
    }
  }
});
