import { expect, mockAuthenticatedApp, test } from '../support/fixtures';

const NETSKOPE_RUN = {
  run_id: 'nsk-1', source_system: 'netskope', source_file: 'netskope-api', status: 'completed',
  enqueued_at: '2026-10-06T13:00:00Z', started_at: '2026-10-06T13:00:30Z', completed_at: new Date().toISOString(),
  received_object_count: 10, triggered_by: 'system:scheduler',
};

// Only CyberArk's router used to feed the header, so Netskope stayed on
// «Sincronización pendiente» forever even with completed runs.
test('the header reports the newest sync of the product being viewed', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read', 'ingestion:run'] });
  await page.route('**/api/ingestion/runs?limit=50', (route) => route.fulfill({ json: { rows: [NETSKOPE_RUN] } }));
  await page.goto('/netskope/inventory');
  await expect(page.locator('.sync-status-control')).toContainText('Sincronizado');
  await expect(page.locator('.sync-status-control')).not.toContainText('pendiente');
});

test('a product without runs stays pending even when another product has synced', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read', 'ingestion:run'] });
  await page.route('**/api/ingestion/runs?limit=50', (route) => route.fulfill({ json: { rows: [{ ...NETSKOPE_RUN, source_system: 'cyberark', run_id: 'pam-1' }] } }));
  await page.route('**/api/cmdb/netskope/sync-evidence', route => route.fulfill({ json: {
    source_fresh: false, source_status: null, source_completed_at: null, as_of: new Date().toISOString(),
  } }));
  await page.goto('/netskope/inventory');
  await expect(page.locator('.sync-status-control')).toContainText('no hay corridas de Netskope registradas');
});

test('header and notifications share run history and refresh it immediately after manual sync', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read', 'ingestion:run'] });
  let historyRequests = 0;
  let finished = false;
  let started = false;
  let evidenceRequests = 0;
  let finishSync!: () => void;
  const completion = new Promise<void>((resolve) => { finishSync = resolve; });
  await page.route('**/api/ingestion/runs?limit=50', (route) => {
    historyRequests += 1;
    return route.fulfill({ json: { rows: [{ ...NETSKOPE_RUN, status: finished ? 'completed' : 'failed' }] } });
  });
  await page.route('**/api/cmdb/netskope/sync-evidence', route => {
    evidenceRequests += 1;
    return route.fulfill({ json: {
      source_fresh: finished, source_status: finished ? 'completed' : started ? 'running' : 'failed',
      source_completed_at: finished ? NETSKOPE_RUN.completed_at : null, as_of: new Date().toISOString(),
    } });
  });
  await page.route('**/api/ingestion/netskope/runs', route => {
    started = true;
    return route.fulfill({ status: 202, json: { run_id: 'manual-netskope', status: 'queued' } });
  });
  await page.route('**/api/ingestion/runs/manual-netskope', async (route) => {
    await completion;
    finished = true;
    await route.fulfill({ json: { ...NETSKOPE_RUN, run_id: 'manual-netskope' } });
  });
  await page.goto('/netskope/inventory');
  const header = page.locator('.sync-status-control');
  await expect(header).toContainText('la última corrida falló');
  expect(evidenceRequests).toBe(1);
  await page.getByRole('button', { name: 'Abrir notificaciones' }).click();
  await expect(page.getByRole('region', { name: 'Notificaciones' })).toContainText('Netskope · Fallida');
  expect(historyRequests).toBe(1);
  await page.getByRole('button', { name: 'Abrir notificaciones' }).click();
  await page.getByRole('button', { name: 'Abrir menú de usuario' }).click();
  await page.getByRole('button', { name: /Actualizar (datos|Netskope)/ }).click();
  await expect(header).toContainText('hay una corrida en curso');
  finishSync();
  await expect(header).toContainText('Sincronizado');
  await expect(page.locator('.netskope-sync-status')).toHaveText(await header.innerText());
  expect(evidenceRequests).toBe(3);
  expect(historyRequests).toBe(2);
});

test('UX-QA-001: a failed run and a tool without runs are not reported as pending', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'pam:catalogs_read', 'ingestion:run'] });
  const failed = { ...NETSKOPE_RUN, source_system: 'cyberark', run_id: 'pam-failed', status: 'failed' };
  await page.route('**/api/ingestion/runs?limit=50', (route) => route.fulfill({ json: { rows: [failed] } }));
  await page.goto('/pam/safes');
  const status = page.locator('.sync-status-control');
  await expect(status).toContainText('Última sincronización fallida');
  await expect(status).toHaveAttribute('title', /^Última corrida fallida · CyberArk · /);
  await expect(status).not.toContainText('pendiente');

  await page.unroute('**/api/ingestion/runs?limit=50');
  await page.route('**/api/ingestion/runs?limit=50', (route) => route.fulfill({ json: { rows: [] } }));
  await page.goto('/pam/safes');
  await expect(status).toContainText('Sin sincronizaciones todavía');
});
