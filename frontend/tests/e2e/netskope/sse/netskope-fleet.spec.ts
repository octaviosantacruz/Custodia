import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, mockAuthenticatedApp, test } from '../../support/fixtures';

/* NSK-FLEET-001: Equipos answers "¿cómo está la flota?" with four numbers and one grouped table.
   Every number opens the inventory with exactly its filters; an unevaluated column never reads 0 %. */

function deviceRequests(page: Page): URLSearchParams[] {
  const requests: URLSearchParams[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/cmdb/netskope/devices') requests.push(new URLSearchParams(url.searchParams));
  });
  return requests;
}

test('NSK-FLEET-002 Equipos warns locally when sync evidence is stale, incomplete or unavailable', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  const cases = [
    { status: 'completed', reason: 'el último sync completo tiene más de 24 h' },
    { status: 'partial', reason: 'la última corrida quedó parcial' },
    { status: 'failed', reason: 'la última corrida falló' },
    { status: 'running', reason: 'hay una corrida en curso' },
    { status: 'queued', reason: 'hay una corrida en espera' },
    { status: null, reason: 'no hay corridas de Netskope registradas' },
    { status: 'unavailable', reason: 'Sin información del sync de Netskope' },
    { status: 'fresh', reason: null },
  ];
  for (const { status, reason } of cases) {
    await page.route('**/api/cmdb/netskope/device-reviews/summary', (route) => route.fulfill({
      status: status === 'unavailable' ? 503 : 200,
      json: status === 'unavailable' ? { detail: 'Unavailable' } : {
        candidates: 4, unclassified: null, suggestions: null, historical_days: 180,
        buckets: [], open_incidents: 0, expired_exceptions: 0, reported_again: 0,
        source_evidence: {
          source_fresh: status === 'fresh', source_status: status === 'fresh' ? 'completed' : status,
          source_completed_at: status ? '2026-10-05T11:00:00Z' : null, as_of: '2026-10-13T12:00:00Z',
        },
      },
    }));
    await page.goto('/netskope/operations');
    const equipos = page.getByRole('region', { name: 'Equipos Netskope' });
    const notice = equipos.getByRole('status');
    await expect(equipos.getByRole('button', { name: /Equipos activos/ })).toContainText('10');
    await expect(equipos.getByRole('row', { name: /EXAMPLE/ })).toBeVisible();
    if (reason) {
      await expect(notice).toContainText(reason);
      await expect(notice).toContainText('Cifras del último inventario disponible');
      await page.getByRole('tab', { name: 'Cambios' }).click();
      await expect(notice).toContainText(reason);
    } else {
      await expect(equipos.getByRole('button', { name: /Sin señal hace \+30 días/ })).toContainText('4');
      await expect(notice).toHaveCount(0);
    }
    await page.unroute('**/api/cmdb/netskope/device-reviews/summary');
  }
});

test('NSK-FLEET-001 the fleet table drills every cell into the inventory with exactly its filters', async ({ page }) => {
  const requests = deviceRequests(page);
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.goto('/netskope/operations');
  const fleet = page.getByRole('region', { name: 'Cómo está la flota' });
  const kpis = page.getByRole('group', { name: 'Resumen de la flota' });
  await expect(kpis.getByRole('button', { name: /Equipos activos/ })).toContainText('10');
  await expect(kpis.getByRole('button', { name: /Señal en 24 h/ })).toContainText('50 %');
  await expect(kpis.getByRole('button', { name: /Cliente al día/ })).toContainText('67 %');
  await expect(kpis.getByRole('button', { name: /Desde la última sync/ })).toContainText('+1');
  const row = fleet.getByRole('row', { name: /EXAMPLE/ });
  await expect(row).toContainText('57 %');
  await expect(row).toContainText('Sin mínimo');

  const cases: Array<[string, Record<string, string>]> = [
    ['EXAMPLE: 7 equipos. Ver en Inventario', { company: 'EXAMPLE' }],
    ['EXAMPLE, Señal en 24 h: 4 de 7. Ver en Inventario', { company: 'EXAMPLE', event_age: 'lt_24h' }],
    ['EXAMPLE, Cliente al día: 5 de 7. Ver en Inventario', { company: 'EXAMPLE', client_compliance: 'current' }],
    ['EXAMPLE, En oficina: 3 de 6. Ver en Inventario', { company: 'EXAMPLE', onprem_status: 'on-prem' }],
  ];
  for (const [name, expected] of cases) {
    await page.goto('/netskope/operations');
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page).toHaveURL(/\/netskope\/devices(?:\?|$)/);
    for (const [key, value] of Object.entries(expected)) await expect.poll(() => requests.at(-1)?.get(key)).toBe(value);
  }
  await page.goto('/netskope/operations');
  await page.getByRole('group', { name: 'Resumen de la flota' }).getByRole('button', { name: /Desde la última sync/ }).click();
  await expect(page.getByRole('tab', { name: 'Cambios', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByText('Dejaron de reportarse (retirados)', { exact: true }).click();
  await expect(page.getByText('LAPTOP-GONE-1', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: /Dispositivos nuevos/ }).click();
  await expect.poll(() => requests.at(-1)?.get('change')).toBe('added');
});

test('The fleet change summary remains accessible when there are only retirements', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['netskope:read'] });
  await page.route('**/api/cmdb/netskope/devices/changes', (route) => route.fulfill({ json: {
    available: true, completed_runs: 2, latest_run: null, previous_run: null,
    counts: { added: 0, removed: 2, upgraded: 0, downgraded: 0, version_changed: 0, os_changed: 0, classification_changed: 0 },
    samples: { added: [], removed: [], upgraded: [], downgraded: [], version_changed: [], os_changed: [], classification_changed: [] },
  } }));
  await page.goto('/netskope/operations');
  await page.getByRole('group', { name: 'Resumen de la flota' }).getByRole('button', { name: /Desde la última sync/ }).click();
  await expect(page.getByRole('tab', { name: 'Cambios', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Qué cambió desde la última sync' })).toBeVisible();
});

test('NSK-FLEET-001 grouping by make asks the server for that group and drills by the exact spelling', async ({ page }) => {
  const requests = deviceRequests(page);
  const groupRequests: string[] = [];
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/cmdb/netskope/devices/fleet-groups*', (route) => {
    const groupBy = new URL(route.request().url()).searchParams.get('group_by') ?? '';
    groupRequests.push(groupBy);
    const counts = { devices: 1, signal_24h: 1, client_current: 0, client_evaluated: 0, client_one_behind: 0, client_two_plus_behind: 0, os_supported: 0, os_evaluated: 0, on_prem: 0, location_reported: 0, uci_low: 0, uci_moderate: 0, uci_evaluated: 0, on_prem_uci_low: 0 };
    return route.fulfill({ json: { group_by: groupBy, client_baseline: false, os_baseline: false, summary: counts, groups: [{ key: groupBy === 'device_make' ? 'Hewlett-Packard' : 'EXAMPLE', ...counts }], omitted_groups: 0, omitted_devices: 0 } });
  });
  await page.goto('/netskope/operations');
  await page.getByRole('button', { name: 'Agrupar la flota por' }).click();
  await page.getByRole('option', { name: 'Fabricante' }).click();
  await expect.poll(() => groupRequests.at(-1)).toBe('device_make');
  await page.getByRole('button', { name: 'Hewlett-Packard: 1 equipos. Ver en Inventario' }).click();
  await expect.poll(() => requests.at(-1)?.get('device_make')).toBe('Hewlett-Packard');
  await expect(page.getByRole('group', { name: 'Filtros de dispositivos' })).toContainText('Fabricante: Hewlett-Packard');
});

test('NSK-EXP-UCI-001 the office-with-low-UCI shortcut opens the exact crossing and the UCI column drills to Poor', async ({ page }) => {
  const requests = deviceRequests(page);
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  const counts = { devices: 4, signal_24h: 4, client_current: 0, client_evaluated: 0, client_one_behind: 0, client_two_plus_behind: 0, os_supported: 0, os_evaluated: 0, on_prem: 3, location_reported: 4, uci_low: 2, uci_moderate: 1, uci_evaluated: 4, on_prem_uci_low: 1 };
  await page.route('**/api/cmdb/netskope/devices/fleet-groups*', (route) => route.fulfill({ json: {
    group_by: 'company', client_baseline: false, os_baseline: false, summary: counts, groups: [{ key: 'EXAMPLE', ...counts }], omitted_groups: 0, omitted_devices: 0,
  } }));
  await page.goto('/netskope/operations');
  const fleet = page.getByRole('region', { name: 'Cómo está la flota' });
  await fleet.getByRole('button', { name: 'Con UCI bajo' }).or(fleet.getByRole('button', { name: /EXAMPLE, Con UCI bajo/ })).first().click();
  await expect.poll(() => requests.at(-1)?.get('uci_rating')).toBe('Poor');
  await expect(page.getByRole('group', { name: 'Filtros de dispositivos' })).toContainText('Confianza (UCI): Bajo');
  await page.goBack();
  await page.getByRole('button', { name: /En oficina con UCI bajo \(1\)/ }).click();
  await expect.poll(() => requests.at(-1)?.get('onprem_status')).toBe('on-prem');
  expect(requests.at(-1)?.get('uci_rating')).toBe('Poor');
});

test('NSK-FLEET-001 without baselines or location data the columns say so instead of 0 %', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  const counts = { devices: 4, signal_24h: 4, client_current: 0, client_evaluated: 0, client_one_behind: 0, client_two_plus_behind: 0, os_supported: 0, os_evaluated: 0, on_prem: 0, location_reported: 0, uci_low: 0, uci_moderate: 0, uci_evaluated: 0, on_prem_uci_low: 0 };
  await page.route('**/api/cmdb/netskope/devices/fleet-groups*', (route) => route.fulfill({ json: {
    group_by: 'company', client_baseline: false, os_baseline: false, summary: counts, groups: [{ key: 'EXAMPLE', ...counts }], omitted_groups: 0, omitted_devices: 0,
  } }));
  await page.goto('/netskope/operations');
  const fleet = page.getByRole('region', { name: 'Cómo está la flota' });
  await expect(page.getByRole('group', { name: 'Resumen de la flota' }).getByRole('button', { name: /Cliente al día/ })).toContainText('Sin línea base');
  const row = fleet.getByRole('row', { name: /EXAMPLE/ });
  await expect(row).toContainText('Sin línea base');
  await expect(row).toContainText('Sin mínimo');
  await expect(row).toContainText('Sin dato');
  await expect(row).not.toContainText(/(^|[^0-9])0 %/);
  // A reader has no baseline buttons.
  await expect(fleet.getByRole('button', { name: 'Línea base del cliente' })).toHaveCount(0);
});

test('NSK-FLEET-001 a Netskope admin edits the golden releases from the fleet header through the audited endpoint', async ({ page }) => {
  let savedBody: unknown = null;
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read', 'netskope:admin'] });
  await page.route('**/api/netskope/baselines/client-golden-releases', async (route) => {
    savedBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ value: savedBody, note: null, updated_by: 'ada', updated_at: '2026-09-23T00:00:00Z' }) });
  });
  await page.goto('/netskope/operations');
  await page.getByRole('region', { name: 'Cómo está la flota' }).getByRole('button', { name: 'Línea base del cliente' }).click();
  const editor = page.getByRole('dialog', { name: 'Releases golden del cliente' });
  const releases = editor.getByLabel('Releases golden');
  await expect(releases).toHaveValue('141.0.0, 138.1.0, 135.0.0');
  await releases.fill('142.0.0, 141.0.0');
  await editor.getByLabel('Nota (opcional)').fill('Golden 142 publicada');
  await editor.getByRole('button', { name: 'Guardar línea base' }).click();
  await expect.poll(() => savedBody).toEqual({ releases: ['142.0.0', '141.0.0'], note: 'Golden 142 publicada' });
  await expect(page.getByText('Línea base Netskope guardada y auditada.')).toBeVisible();
});

test('NSK-GOLDEN-001 the documented golden pair is only offered; nothing is saved until the admin saves it', async ({ page }) => {
  let savedBody: unknown = null;
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read', 'netskope:admin'] });
  await page.route('**/api/netskope/baselines/client-golden-releases', async (route) => {
    savedBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/netskope/operations');
  await page.getByRole('region', { name: 'Cómo está la flota' }).getByRole('button', { name: 'Línea base del cliente' }).click();
  const editor = page.getByRole('dialog', { name: 'Releases golden del cliente' });
  await expect(editor.getByText('142.0.0, 139.0.0')).toBeVisible();
  await expect(editor.getByLabel('Releases golden')).toHaveValue('141.0.0, 138.1.0, 135.0.0');
  expect(savedBody).toBeNull();
  await editor.getByRole('button', { name: 'Usar sugerida' }).click();
  await expect(editor.getByLabel('Releases golden')).toHaveValue('142.0.0, 139.0.0');
  expect(savedBody).toBeNull();
  await editor.getByRole('button', { name: 'Guardar línea base' }).click();
  await expect.poll(() => savedBody).toMatchObject({ releases: ['142.0.0', '139.0.0'] });
});

test('NSK-FLEET-001 Equipos passes axe and has no horizontal overflow on desktop sizes', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read', 'netskope:admin'] });
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/netskope/operations');
    await expect(page.getByRole('region', { name: 'Cómo está la flota' }).getByRole('row', { name: /EXAMPLE/ })).toBeVisible();
    const scan = await new AxeBuilder({ page }).include('.netskope-operations').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(scan.violations.map(({ id }) => id)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('NSK-FLEET-001 the band risk numbers open their row in Postura, and Cambios is the second tab', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.goto('/netskope/operations');
  const band = page.getByRole('group', { name: 'Resumen de la flota' });
  await expect(band.getByRole('button', { name: /Desinstalación o deshabilitación/ })).toContainText('3');
  await band.getByRole('button', { name: /Sin señal hace \+30 días/ }).click();
  await expect(page).toHaveURL(/\/netskope\/posture\?open=stale_undiagnosed$/);
  const row = page.getByRole('button', { name: /Sin señal hace más de 30 días/ });
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('heading', { name: 'Equipos sin señal: por qué' })).toBeVisible();

  await page.goto('/netskope/operations');
  await page.getByRole('tab', { name: 'Cambios' }).click();
  await expect(page).toHaveURL(/\?tab=changes$/);
  await expect(page.getByRole('heading', { name: 'Qué cambió desde la última sync' })).toBeVisible();
  await expect(band).toBeVisible();
  await expect(page.getByRole('tab', { name: /Para revisar/ })).toHaveCount(0);
});
