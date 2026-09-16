import AxeBuilder from '@axe-core/playwright';
import { expect, mockAuthenticatedApp, test } from './fixtures';

test('activity uses shared search semantics and keyboard-expandable rows', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/admin/activity');

  await expect(page.getByRole('heading', { name: 'Actividad', exact: true })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Buscar actividad por actor, Safe o entidad' })).toBeVisible();
  await expect(page.getByText('Finalizó sync', { exact: true })).toBeVisible();
  await expect(page.getByText('4 objetos · 9 relaciones', { exact: true })).toBeVisible();
  const row = page.getByRole('row', { name: 'Safe Metadata: ver detalle' });
  await row.focus();
  await row.press('Enter');
  await expect(page.getByText('Antes', { exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: 'Safe Metadata: ocultar detalle' })).toHaveAttribute('aria-expanded', 'true');
});

test('external activity event refreshes the visible workspace and notifies the user', async ({ page }) => {
  let eventRequests = 0;
  let summaryRequests = 0;
  await mockAuthenticatedApp(page, { onRequest: (pathname) => {
    if (pathname === '/api/summary') summaryRequests += 1;
  } });
  await page.route('**/api/events**', async (route) => {
    eventRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        rows: eventRequests === 1 ? [] : [{
          event_id: 4,
          kind: 'classification',
          actor_id: 'other-operator',
          actor_name: 'Otra operadora',
          created_at: '2026-09-10T01:00:00Z',
        }],
      }),
    });
  });
  await page.goto('/pam');
  await expect.poll(() => eventRequests).toBe(1);
  await expect.poll(() => summaryRequests).toBeGreaterThan(0);
  const summariesBeforeEvent = summaryRequests;

  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

  await expect.poll(() => eventRequests).toBe(2);
  await expect(page.getByText('Datos actualizados por Otra operadora', { exact: true })).toBeVisible();
  await expect.poll(() => summaryRequests).toBeGreaterThan(summariesBeforeEvent);
  await page.getByRole('button', { name: 'Abrir notificaciones' }).click();
  await expect(page.getByText('Datos actualizados', { exact: true })).toBeVisible();
});

test('starting a sync shows a progress toast', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.route('**/api/ingestion/preview', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        safe_counts: { incoming: 1, current: 1, new: 0, changed: 0, unchanged: 1, retired: 0 },
        member_counts: { incoming: 1, current: 1, new: 0, changed: 0, unchanged: 1, retired: 0 },
        samples: { new_safes: [], changed_safes: [], retired_safes: [], new_members: [], changed_members: [], retired_members: [] },
        reported_safe_count: 1,
        complete_snapshot: true,
        can_reconcile: true,
        warning: null,
      }),
    });
  });
  await page.goto('/pam');
  await page.getByRole('button', { name: 'Sincronizar datos' }).click();
  await expect(page.locator('.sync-toast')).toContainText('Preparando comparación');
  const preview = page.getByRole('dialog', { name: 'Sincronización lista para confirmar' });
  await expect(preview).toBeVisible();
  await expect(preview.getByText('PAM · Safes y catálogos técnicos', { exact: true })).toBeVisible();
  await expect(preview.getByText('plataformas, PSM/conectores, salud de componentes y AIM', { exact: false })).toBeVisible();
  await expect(preview.getByText('Identity Administration', { exact: true })).toBeVisible();
  await expect(preview.getByText('SIA', { exact: true })).toBeVisible();
  await expect(preview.getByText('Access space', { exact: true })).toBeVisible();
  await expect(preview.getByText('Se encolará', { exact: true })).toHaveCount(3);
  await expect(preview.getByText('Relaciones de acceso', { exact: true })).toHaveCount(0);
});

test('confirming a sync enqueues PAM, isolated PSM, and configured sources', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.route('**/api/ingestion/preview', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        safe_counts: { incoming: 1, current: 1, new: 0, changed: 0, unchanged: 1, retired: 0 },
        member_counts: { incoming: 1, current: 1, new: 0, changed: 0, unchanged: 1, retired: 0 },
        samples: { new_safes: [], changed_safes: [], retired_safes: [], new_members: [], changed_members: [], retired_members: [] },
        reported_safe_count: 1,
        complete_snapshot: true,
        can_reconcile: true,
        warning: null,
      }),
    });
  });

  let enqueuedSourceSystems: string[] = [];
  await page.route('**/api/ingestion/all/runs', async (route) => {
    const payload = route.request().postDataJSON() as { max_safes: number };
    expect(payload.max_safes).toBe(0);
    const runs = ['cyberark', 'cyberark', 'identity_administration', 'sia', 'access'].map((source_system, index) => ({
      run_id: `run-${index}`, status: 'queued', source_system,
    }));
    enqueuedSourceSystems = runs.map((run) => run.source_system);
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ runs }) });
  });
  await page.route('**/api/ingestion/runs/run-*', async (route) => {
    const runId = new URL(route.request().url()).pathname.split('/').pop();
    const index = Number(runId?.replace('run-', ''));
    const source_system = ['cyberark', 'cyberark', 'identity_administration', 'sia', 'access'][index];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        run_id: runId, source_system, status: 'completed',
        started_at: '2026-09-11T00:00:00Z', completed_at: '2026-09-11T00:00:01Z',
        expected_safe_count: 1, received_safe_count: 1, received_member_count: 1,
        error_count: 0, pam_synced: source_system === 'cyberark' && index === 0,
      }),
    });
  });

  await page.goto('/pam');
  await page.getByRole('button', { name: 'Sincronizar datos' }).click();
  const preview = page.getByRole('dialog', { name: 'Sincronización lista para confirmar' });
  await expect(preview).toBeVisible();
  await preview.getByRole('button', { name: 'Aplicar todas las fuentes' }).click();

  await expect.poll(() => enqueuedSourceSystems).toEqual(['cyberark', 'cyberark', 'identity_administration', 'sia', 'access']);
  await expect(page.locator('.sync-toast')).toContainText('plataformas, PSM/conectores, salud de componentes y AIM');
  await expect(page.locator('.sync-toast')).toContainText('Identity Administration');
  await expect(page.locator('.sync-toast')).toContainText('SIA');
  await expect(page.locator('.sync-toast')).toContainText('Access space');
});
