import { expectSystemSearch } from '../../support/search-control';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, mockAuthenticatedApp, test } from '../../support/fixtures';

const NO_SCORE = { source: 'netskope_adem', window_start: 1790700000, window_end: 1790786400, score: null, weakest: null, devices: [], devices_total: 0 };
const mockEmptyScore = async (page: Page) => {
  await page.route('**/api/cmdb/netskope/users/601/experience/score?*', (route) => route.fulfill({ json: NO_SCORE }));
  // Without netskope:uba_read the anomalies block and the queue stay hidden.
  await page.route('**/api/cmdb/netskope/experience/attention', (route) => route.fulfill({ status: 403, json: { detail: 'x' } }));
  await page.route('**/api/cmdb/netskope/users/601/anomalies', (route) => route.fulfill({ status: 403, json: { detail: 'Requiere el permiso netskope:uba_read.' } }));
};


test('Usuarios (antes Experiencia digital) presents windowed observations and preserves the old URL', async ({ page }) => {
  const reads: string[] = [];
  page.on('request', (request) => reads.push(new URL(request.url()).pathname));
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await mockEmptyScore(page);
  let popListRequests = 0;
  await page.route('**/api/cmdb/netskope/experience/pops?*', async (route) => {
    popListRequests += 1;
    await route.fulfill({ json: { pops: ['AR-BUE1', 'BR-SAO1'], total: 2, window_start: 1790700000, window_end: 1790786400 } });
  });

  await page.goto('/netskope/dem/sites');
  await expect(page).toHaveURL(/\/netskope\/experience$/);
  await expect(page.getByRole('heading', { name: 'Consultar una persona' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Para revisar' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(/seguí su recorrido|ver recorrido/i)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'POPs observados' })).toHaveCount(0);
  expect(popListRequests).toBe(0);
  await openUser(page);
  await expect(page.getByRole('dialog', { name: 'QA User' })).toBeVisible();
  expect(reads.filter((path) => /\/uci|\/anomalies|\/attention/.test(path))).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('searchbox', { name: 'Buscar usuario por nombre o correo' })).toBeFocused();
});

test('NSK-EXP-UEBA-001: the selected user lists anomalies by severity and hides them without the UBA permission', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read', 'netskope:uba_read'] });
  await mockEmptyScore(page);
  await page.route('**/api/cmdb/netskope/devices?*', (route) => route.fulfill({ json: { rows: [], total: 0, limit: 50, offset: 0, search: '', filters: {} } }));
  await page.route('**/api/cmdb/netskope/users/601/experience/devices?*', (route) => route.fulfill({ json: { source: 'netskope_adem', window_start: 1790700000, window_end: 1790707200, devices: [] } }));
  const item = (severity: string, rule: string, time: string) => ({ severity, scenario: 'Insider threat', sub_scenario: 'DLP violation', rule, activity: 'Upload', app: 'Drive', score: 100, time });
  await page.route('**/api/cmdb/netskope/users/601/anomalies', (route) => route.fulfill({ json: {
    total: 4361, returned: 1000, truncated: true, window_days: 30,
    by_severity: { high: 2, medium: 5, low: 990, informational: 0, unknown: 3 },
    by_scenario: [{ scenario: 'Insider threat', sub_scenario: 'DLP violation', count: 990 }], top_rules: [{ rule: 'Low Severity DLP policy violation', count: 900 }],
    recent: [item('high', 'UEBA rule-based violation', '2026-10-09T10:00:00Z'), item('low', 'Low Severity DLP policy violation', '2026-10-10T10:00:00Z')],
  } }));
  await page.goto('/netskope/experience');
  await page.getByRole('searchbox', { name: 'Buscar usuario por nombre o correo' }).fill('qa');
  await page.getByRole('option', { name: 'QA User qa.user@example.com' }).click();
  const region = page.getByRole('region', { name: 'Anomalías del usuario' });
  await expect(region.getByRole('list', { name: 'Anomalías por severidad' })).toContainText('Alta');
  await expect(region.getByRole('list', { name: 'Anomalías por severidad' })).not.toContainText('Informativa');
  await expect(region.getByText('Se analizan 1.000 de 4.361.')).toBeVisible();
  await expect(region.getByRole('row').nth(1)).toContainText('UEBA rule-based violation');
  await expect(region.getByText(/10\.|@/)).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).include('.nsk-user-anomalies').analyze();
  expect(axe.violations).toEqual([]);

  // Forbidden: the block disappears, nothing else breaks.
  await page.route('**/api/cmdb/netskope/users/601/anomalies', (route) => route.fulfill({ status: 403, json: { detail: 'x' } }));
  await page.reload();
  await page.getByRole('searchbox', { name: 'Buscar usuario por nombre o correo' }).fill('qa');
  await page.getByRole('option', { name: 'QA User qa.user@example.com' }).click();
  await expect(page.getByRole('region', { name: 'Equipos del usuario' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Anomalías del usuario' })).toHaveCount(0);
});

test('NSK-EXP-UEBA-001: the attention queue joins UCI and ADEM, says "Sin dato" for the missing side and opens the user', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read', 'netskope:uba_read'] });
  await mockEmptyScore(page);
  await page.route('**/api/cmdb/netskope/experience/attention', (route) => route.fulfill({ json: { adem_available: true, rows: [
    { email: 'qa.user@example.com', name: 'QA User', user_id: '601', uci_rating: 'Poor', uci_score: 120, uci_previous: 300, adem_score: 52, reasons: ['uci', 'adem'] },
    { email: 'solo.uci@example.com', name: null, user_id: null, uci_rating: 'Moderate', uci_score: 500, uci_previous: null, adem_score: null, reasons: ['uci'] },
    { email: 'solo.adem@example.com', name: null, user_id: null, uci_rating: null, uci_score: null, uci_previous: null, adem_score: 60, reasons: ['adem'] },
  ] } }));
  await page.route('**/api/cmdb/netskope/uci?*', (route) => route.fulfill({ json: {
    configured: true, captured_at: '2026-10-11T00:00:00Z', total: 1, by_rating: { Poor: 1, Moderate: 0 },
    rows: [{ email: 'qa.user@example.com', user_id: '601', name: 'QA User', rating: 'Poor', score: 120, previous_score: 300, scored_at: '2026-10-11T00:00:00Z' }],
  } }));
  await page.goto('/netskope/experience');
  const queue = page.getByRole('region', { name: 'Usuarios para revisar' });
  await expect(queue.getByRole('row', { name: /QA User/ })).toContainText('Entre los menores puntajes de rendimiento');
  await expect(queue.getByRole('row', { name: /QA User/ })).toContainText('Empeora −180');
  await expect(queue.getByText('De 0 a 1000: menor puntaje, mayor riesgo.', { exact: false })).toBeVisible();
  const soloUci = queue.getByRole('row', { name: /solo.uci@example.com/ });
  await expect(soloUci).toContainText('Sin dato');
  await expect(soloUci).not.toContainText(/\b0\b/);
  await expect(queue.getByRole('row', { name: /solo.adem@example.com/ })).toContainText('Sin dato');
  const axe = await new AxeBuilder({ page }).include('.nsk-attention').analyze();
  expect(axe.violations).toEqual([]);
  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await page.screenshot({ path: test.info().outputPath(`users-review-${theme}.png`) });
  }
  await queue.getByRole('button', { name: /QA User/ }).click();
  const drawer = page.getByRole('dialog', { name: 'QA User' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Cerrar ficha', exact: true })).toBeFocused();
  await expect(drawer.getByRole('region', { name: 'Equipos del usuario' })).toBeVisible();
  await expect(drawer.getByRole('region', { name: 'Índice de confianza del usuario' })).toContainText('120 / 1000');
  await expect(drawer.getByRole('region', { name: 'Índice de confianza del usuario' })).toContainText('Empeora −180');
  const dialogAxe = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(dialogAxe.violations.map(({ id }) => id)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(queue.getByRole('button', { name: /QA User/ })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Para revisar' })).toHaveAttribute('aria-selected', 'true');
});

const DEVICE = (id: number, name: string, status: string | null, state = 'recent') => ({
  object_id: id, display_name: name, source_id: `dev-${id}`, first_seen_at: '', last_seen_at: '',
  device_evidence: { state, last_signal_at: '2026-10-10T10:00:00Z', source_fresh: true },
  attributes: { os: 'Windows', os_version: '11', hostname: name, ...(status ? { onprem_status: status, client_config: 'Default tenant config' } : {}) },
});

async function openUser(page: Page) {
  const search = page.getByRole('searchbox', { name: 'Buscar usuario por nombre o correo' });
  await search.fill('qa');
  await page.getByRole('option', { name: 'QA User qa.user@example.com' }).click();
  return page.getByRole('region', { name: 'Equipos del usuario' });
}

test('NSK-IA-001: the selected user has one device table that joins location and ADEM scores only by exact name (ADR 006)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/cmdb/netskope/users/601/anomalies', (route) => route.fulfill({ status: 403, json: { detail: 'x' } }));
  await page.route('**/api/cmdb/netskope/experience/attention', (route) => route.fulfill({ status: 403, json: { detail: 'x' } }));
  const rows = [DEVICE(1, 'LAPTOP-OFICINA', 'on-prem'), DEVICE(2, 'LAPTOP-CASA', 'off-prem'), DEVICE(3, 'VIEJO', 'off-prem', 'not_recent')];
  const requests: URLSearchParams[] = [];
  await page.route('**/api/cmdb/netskope/devices?*', (route) => {
    requests.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ json: { rows, total: rows.length, limit: 50, offset: 0, search: '', filters: {} } });
  });
  await page.route('**/api/cmdb/netskope/users/601/experience/score?*', (route) => route.fulfill({ json: {
    source: 'netskope_adem', window_start: 1790700000, window_end: 1790786400, score: 52, weakest: 'network', devices_total: 7,
    devices: [
      { device_id: 'adem-1', inventory_device_id: 1, device_name: 'laptop-oficina', device_os: 'Windows', exp_score: 52, device_score: 96, network_score: 15, app_score: 100 },
      { device_id: 'adem-9', inventory_device_id: null, device_name: 'SOLO-ADEM', device_os: 'Mac', exp_score: null, device_score: null, network_score: null, app_score: 90 },
    ],
  } }));
  const details: string[] = [];
  await page.route('**/api/cmdb/netskope/users/601/experience/devices/*?*', (route) => {
    const url = new URL(route.request().url());
    details.push(`${decodeURIComponent(url.pathname.split('/').at(-1)!)}:${url.searchParams.get('window_start')}`);
    return route.fulfill({ json: { source: 'netskope_adem', device_id: 'adem-1', window_start: 1790700000, window_end: 1790786400, pop: 'AR-BUE1', last_activity: 1790700600, activity_status: 'in_window' } });
  });
  await page.goto('/netskope/experience');
  const region = await openUser(page);
  await expect(region.getByLabel('Rendimiento digital 52 de 100')).toBeVisible();
  await expect(region.getByText('Componente con menor puntaje: Red')).toBeVisible();
  await expect(region.getByText('En oficina').first()).toBeVisible();
  // One row per device: the linked one carries location and scores together.
  const linked = region.getByRole('row', { name: /LAPTOP-OFICINA/ });
  await expect(linked).toContainText('En oficina');
  await expect(linked).toContainText('15');
  await expect(linked).toContainText('nombre exacto');
  await expect(region.getByRole('row', { name: /LAPTOP-OFICINA/ })).toHaveCount(1);
  // Same-name devices are not duplicated and an unlinked side keeps "Sin dato" for the other.
  await expect(region.getByRole('row', { name: /LAPTOP-CASA/ })).toContainText('Fuera de oficina');
  await expect(region.getByRole('row', { name: /LAPTOP-CASA/ })).toContainText('Sin dato');
  await expect(region.getByRole('row', { name: /SOLO-ADEM/ })).toContainText('Sin dato');
  await expect(region.getByRole('row', { name: /SOLO-ADEM/ })).not.toContainText('En oficina');
  await expect(region.getByRole('row', { name: /VIEJO/ })).toHaveClass(/is-stale/);
  await expect(region.getByText('ADEM: 2 de 7 equipos.')).toBeVisible();
  expect(requests.at(-1)?.get('observed_user_id')).toBe('601');
  expect(requests.at(-1)?.get('freshness')).toBe('all');
  // The POP is read only when the row is opened.
  expect(details).toHaveLength(0);
  await region.getByRole('button', { name: 'Detalle de LAPTOP-OFICINA' }).click();
  await expect(region.getByText('AR-BUE1', { exact: true })).toBeVisible();
  expect(details).toEqual(['adem-1:1790700000']);
  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    const axe = await new AxeBuilder({ page }).include('.nsk-user-devices').analyze();
    expect(axe.violations.map(({ id }) => id), `${theme} axe`).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`users-drawer-${theme}.png`) });
  }
});

test('NSK-IA-001: without ADEM the device table still answers the location and says ADEM is unavailable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/cmdb/netskope/users/601/anomalies', (route) => route.fulfill({ status: 403, json: { detail: 'x' } }));
  await page.route('**/api/cmdb/netskope/experience/attention', (route) => route.fulfill({ status: 403, json: { detail: 'x' } }));
  let rows = [DEVICE(1, 'LAPTOP-OFICINA', null)];
  await page.route('**/api/cmdb/netskope/devices?*', (route) => route.fulfill({ json: { rows, total: rows.length, limit: 50, offset: 0, search: '', filters: {} } }));
  await page.route('**/api/cmdb/netskope/users/601/experience/score?*', (route) => route.fulfill({ status: 503, json: { detail: 'Unavailable' } }));
  await page.goto('/netskope/experience');
  const region = await openUser(page);
  await expect(region.getByText('Rendimiento no disponible')).toBeVisible();
  // Before the on-prem field is synced the verdict is "Sin dato de ubicación", never remote.
  await expect(region.getByText('Sin dato de ubicación')).toBeVisible();
  await expect(region.getByText('Fuera de oficina')).toHaveCount(0);
  await expect(region.getByRole('row', { name: /LAPTOP-OFICINA/ })).toContainText('Sin dato');
  rows = [];
  await page.reload();
  const empty = await openUser(page);
  await expect(empty.getByText('Sin equipos vinculados')).toBeVisible();
});

const PRESENCE = {
  total: 4495, reported: 4461,
  statuses: [{ key: 'off-prem', count: 4064 }, { key: 'on-prem', count: 397 }, { key: 'Unknown', count: 34 }],
  methods: [{ key: 'Egress_IP', count: 4461 }, { key: 'Sin dato', count: 34 }],
  by_client_config: [
    { key: 'Default tenant config', total: 4388, statuses: { 'off-prem': 3990, 'on-prem': 364, Unknown: 34 } },
    { key: 'TestCiber', total: 79, statuses: { 'off-prem': 60, 'on-prem': 19 } },
  ],
  by_company: [{ key: 'ITTI', total: 4000, statuses: { 'off-prem': 3700, 'on-prem': 300 } }],
  company_omitted_devices: 495, missing_label: 'Sin dato',
  source_evidence: { source_fresh: true, source_status: 'completed', source_completed_at: new Date(Date.now() - 3_600_000).toISOString(), as_of: new Date().toISOString() },
};

test('NSK-IA-001: a linked device beyond the first inventory page is still merged into one row', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/cmdb/netskope/users/601/anomalies', (route) => route.fulfill({ status: 403, json: { detail: 'x' } }));
  await page.route('**/api/cmdb/netskope/experience/attention', (route) => route.fulfill({ status: 403, json: { detail: 'x' } }));
  const all = Array.from({ length: 51 }, (_, index) => DEVICE(index + 1, `PC-${String(index + 1).padStart(2, '0')}`, 'off-prem'));
  const pages: string[] = [];
  await page.route('**/api/cmdb/netskope/devices?*', (route) => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset') ?? 0);
    pages.push(String(offset));
    return route.fulfill({ json: { rows: all.slice(offset, offset + 50), total: 51, limit: 50, offset, search: '', filters: {} } });
  });
  await page.route('**/api/cmdb/netskope/users/601/experience/score?*', (route) => route.fulfill({ json: {
    source: 'netskope_adem', window_start: 1790700000, window_end: 1790786400, score: 52, weakest: 'network', devices_total: 1,
    devices: [{ device_id: 'adem-51', inventory_device_id: 51, device_name: 'pc-51', device_os: 'Windows', exp_score: 52, device_score: 96, network_score: 15, app_score: 100 }],
  } }));
  await page.goto('/netskope/experience');
  const region = await openUser(page);
  const row = region.getByRole('row', { name: /PC-51/ });
  await expect(row).toContainText('15');
  await expect(row).toContainText('nombre exacto');
  await expect(region.getByRole('row', { name: /pc-51/i })).toHaveCount(1);
  expect(pages).toEqual(['0', '50']);
});


test('Usuarios resolves a missing inventory ID only through a complete unique exact email and never opens another account', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read', 'netskope:uba_read'] });
  await mockEmptyScore(page);
  await page.route('**/api/cmdb/netskope/experience/attention', (route) => route.fulfill({ json: { adem_available: true, rows: [
    { email: 'qa.user@example.com', name: 'QA User', user_id: null, uci_rating: null, uci_score: null, uci_previous: null, adem_score: 75, reasons: ['adem'] },
  ] } }));
  const similar = { object_id: 999, display_name: 'Other user', attributes: { email: 'qa.user@example.com.other' } };
  const exact = { object_id: 601, display_name: 'QA User', attributes: { email: 'QA.User@Example.com' } };
  let response = { rows: [similar, exact], total: 2 };
  await page.route('**/api/cmdb/netskope/users?*', (route) => route.fulfill({ json: response }));
  const deviceReads: string[] = [];
  await page.route('**/api/cmdb/netskope/devices?*', (route) => {
    deviceReads.push(new URL(route.request().url()).searchParams.get('observed_user_id') || '');
    return route.fulfill({ json: { rows: [], total: 0 } });
  });
  for (const kind of ['unique', 'ambiguous', 'incomplete', 'missing'] as const) {
    response = kind === 'unique' ? { rows: [similar, exact], total: 2 }
      : kind === 'ambiguous' ? { rows: [exact, { ...exact, object_id: 602 }], total: 2 }
      : kind === 'incomplete' ? { rows: [exact], total: 51 } : { rows: [similar], total: 1 };
    deviceReads.length = 0;
    await page.goto('/netskope/experience');
    await page.getByRole('region', { name: 'Usuarios para revisar' }).getByRole('button', { name: /QA User/ }).click();
    const drawer = page.getByRole('dialog', { name: 'QA User' });
    await expect(drawer).toBeVisible();
    if (kind === 'unique') {
      await expect(drawer.getByRole('region', { name: 'Equipos del usuario' })).toBeVisible();
      expect(deviceReads).toEqual(['601']);
    } else {
      await expect(drawer.getByText('Sin una identidad única en el inventario')).toBeVisible();
      expect(deviceReads).toEqual([]);
    }
    await page.keyboard.press('Escape');
  }
});

test('Usuarios keeps empty and failed sources explicit and retries the review list', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read', 'netskope:uba_read'] });
  let failed = true;
  await page.route('**/api/cmdb/netskope/experience/attention', (route) => failed
    ? route.fulfill({ status: 503, json: { detail: 'Unavailable' } })
    : route.fulfill({ json: { adem_available: false, rows: [] } }));
  await page.goto('/netskope/experience');
  await expect(page.getByText('No se pudieron leer los usuarios para revisar')).toBeVisible();
  failed = false;
  await page.getByRole('button', { name: 'Reintentar revisión' }).click();
  await expect(page.getByText('Sin usuarios en la lista de revisión')).toBeVisible();
  await expect(page.getByText('Rendimiento no disponible')).toBeVisible();
  await page.route('**/api/cmdb/netskope/uci/companies', (route) => route.fulfill({ json: { companies: [], previous_week: null, omitted_users: 0 } }));
  await page.getByRole('tab', { name: 'Por empresa' }).click();
  await expect(page.getByText('Sin empresas para comparar')).toBeVisible();
});
