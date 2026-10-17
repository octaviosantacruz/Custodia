import AxeBuilder from '@axe-core/playwright';
import { expect, mockAuthenticatedApp, test } from '../support/fixtures';

test('activity uses shared search semantics and keyboard-expandable rows (UX-AUD2-009)', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/admin/activity');

  await expect(page.getByRole('heading', { name: 'Actividad', exact: true })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Buscar actividad por actor, Safe o entidad' })).toBeVisible();
  await expect(page.getByText('Finalizó sync', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'CyberArk PAM · 4 objetos · 9 relaciones' })).toBeVisible();
  const row = page.getByRole('row', { name: /Safe Metadata.*Operador/ });
  await expect(row.locator('time')).toBeVisible();
  await expect(row.locator('time')).toHaveAttribute('datetime', '2026-08-29T00:00:00Z');
  await expect(page.locator('html')).toHaveAttribute('data-theme', test.info().project.name.includes('light') ? 'light' : 'dark');
  await expect(row.locator('time')).toHaveAttribute('title', /^hace /);
  await expect(row.locator('td').first()).not.toContainText('hace');
  const dateIsUnclipped = await row.locator('time').evaluate((element) => {
    const text = document.createRange();
    text.selectNodeContents(element);
    const bounds = text.getBoundingClientRect();
    let ancestor: HTMLElement | null = element;
    while (ancestor) {
      if (['hidden', 'clip'].includes(getComputedStyle(ancestor).overflowX)) {
        const clip = ancestor.getBoundingClientRect();
        if (bounds.left < clip.left - 1 || bounds.right > clip.right + 1) return false;
      }
      ancestor = ancestor.parentElement;
    }
    return true;
  });
  expect(dateIsUnclipped, 'the complete activity date must remain inside every clipping ancestor').toBe(true);
  const volume = page.getByRole('region', { name: 'Volumen de esta página' });
  await expect(volume).toContainText('2 registros en esta página');
  await volume.getByRole('button', { name: 'Ayuda: Volumen de esta página' }).click();
  await expect(volume).toContainText('no representa el total diario del historial');
  const expand = row.locator('.row-expand-button');
  await expand.focus();
  await expand.press('Enter');
  await expect(page.getByText('Antes', { exact: true })).toBeVisible();
  await expect(expand).toHaveAttribute('aria-expanded', 'true');
});

test('changing the activity page hides the previous histogram until the new page loads', async ({ page }) => {
  await mockAuthenticatedApp(page);
  let nextPageStarted!: () => void;
  let releaseNextPage!: () => void;
  const nextPage = new Promise<void>((resolve) => { nextPageStarted = resolve; });
  const nextPageResponse = new Promise<void>((resolve) => { releaseNextPage = resolve; });
  await page.route('**/api/activity**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('offset') === '50') {
      nextPageStarted();
      await nextPageResponse;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        rows: [{ audit_id: 61, actor_id: 'operator-1', actor_name: 'Operador', action: 'update', entity_type: 'safe_metadata', entity_id: '61', entity_name: 'Safe 61', before_data: null, after_data: null, created_at: '2026-10-02T12:00:00Z' }],
        total: 60,
      }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      rows: Array.from({ length: 50 }, (_, index) => ({ audit_id: index + 1, actor_id: 'operator-1', actor_name: 'Operador', action: 'update', entity_type: 'safe_metadata', entity_id: String(index + 1), entity_name: `Safe ${index + 1}`, before_data: null, after_data: null, created_at: '2026-10-01T12:00:00Z' })),
      total: 60,
    }) });
  });
  await page.goto('/admin/activity');
  const volume = page.getByRole('region', { name: 'Volumen de esta página' });
  await expect(volume).toContainText('50 registros en esta página');
  await expect(volume.locator('time[datetime="2026-10-01"]')).toBeVisible();
  await page.getByRole('button', { name: 'Página siguiente' }).click();
  await nextPage;
  await expect(volume).toContainText('Actualizando volumen de esta página');
  await expect(volume.locator('.page-volume-day')).toHaveCount(0);
  releaseNextPage();
  await expect(volume).toContainText('1 registros en esta página');
  await expect(volume.locator('time[datetime="2026-10-02"]')).toBeVisible();
  await expect(volume.locator('time[datetime="2026-10-01"]')).toHaveCount(0);
});

test('submitting the currently selected page preserves rows and page histogram in all audit tables (UX-AUD2-009)', async ({ page }) => {
  const requests = { activity: 0, logs: 0, errors: 0 };
  await mockAuthenticatedApp(page, { onRequest: (pathname) => {
    if (pathname.startsWith('/api/activity')) requests.activity += 1;
    if (pathname.startsWith('/api/operational-logs')) requests.logs += 1;
    if (pathname.startsWith('/api/operational-errors')) requests.errors += 1;
  } });
  await page.route('**/api/operational-logs**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ rows: [{ log_id: 901, occurred_at: '2026-10-03T12:00:00Z', level: 'info', source_system: 'cyberark', event: 'queue_poll', message: 'Cola consultada', run_id: null, metadata: {} }], total: 1 }),
  }));
  await page.route('**/api/operational-errors**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ rows: [{ event_id: 902, occurred_at: '2026-10-02T12:00:00Z', request_id: 'same-page-reference', method: 'GET', path: '/api/health', error_kind: 'DatabaseError', status_code: 500, metadata: {} }], total: 1 }),
  }));

  const views = [
    { tab: 'Actividad', panel: '.activity-panel:not(.operational-logs-panel):not(.operational-errors-panel)', key: 'activity' as const, expectedText: 'Finalizó sync' },
    { tab: 'Logs operativos', panel: '.operational-logs-panel', key: 'logs' as const, expectedText: 'Cola consultada' },
    { tab: 'Errores del sistema', panel: '.operational-errors-panel', key: 'errors' as const, expectedText: 'same-page-reference' },
  ];
  await page.goto('/admin/activity');
  for (const view of views) {
    if (view.tab !== 'Actividad') await page.getByRole('tab', { name: view.tab }).click();
    const panel = page.locator(view.panel).first();
    await expect(panel).toContainText(view.expectedText);
    const volume = panel.getByRole('region', { name: 'Volumen de esta página' });
    await expect(volume).toContainText('registros en esta página');
    const requestCountBefore = requests[view.key];
    const rowsBefore = await panel.locator('tbody tr').count();
    const volumeBarsBefore = await volume.locator('.page-volume-day').count();
    const pageNumber = panel.getByRole('textbox', { name: 'Número de página' });
    await expect(pageNumber).toHaveValue('1');
    await pageNumber.fill('1');
    await panel.getByRole('button', { name: 'Ir' }).click();
    await page.waitForTimeout(0);
    await expect(panel).toContainText(view.expectedText);
    await expect(page.locator('html')).toHaveAttribute('data-theme', test.info().project.name.includes('light') ? 'light' : 'dark');
    const timestamp = panel.locator('tbody time').first();
    await expect(timestamp).toHaveAttribute('title', /^hace /);
    await expect(panel.locator('tbody td').first()).not.toContainText('hace');
    await expect(panel.locator('tbody tr')).toHaveCount(rowsBefore);
    await expect(volume).toContainText('registros en esta página');
    await expect(volume.locator('.page-volume-day')).toHaveCount(volumeBarsBefore);
    expect(requests[view.key]).toBe(requestCountBefore);
  }
});

test('Activity, operational logs and errors label page-local histograms and keep explanations behind help', async ({ page }) => {
  await mockAuthenticatedApp(page);
  let failLogs = false;
  await page.route('**/api/operational-logs**', (route) => {
    if (failLogs) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Error de prueba' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [
      { log_id: 11, occurred_at: '2026-10-03T12:00:00Z', level: 'info', source_system: 'cyberark', event: 'sync_started', message: 'Corrida iniciada', run_id: 'run-1', metadata: {} },
      { log_id: 12, occurred_at: '2026-10-03T13:00:00Z', level: 'warning', source_system: 'netskope', event: 'sync_partial', message: 'Corrida parcial', run_id: 'run-2', metadata: {} },
      { log_id: 13, occurred_at: '2026-10-02T13:00:00Z', level: 'error', source_system: 'sia', event: 'sync_failed', message: 'Falla de prueba', run_id: 'run-3', metadata: {} },
    ], total: 99 }) });
  });
  let failErrors = false;
  await page.route('**/api/operational-errors**', (route) => failErrors
    ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Error de prueba' }) })
    : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [
      { event_id: 21, occurred_at: '2026-10-03T09:00:00Z', request_id: 'safe-reference-1', method: 'GET', path: '/api/safes', error_kind: 'DatabaseError', status_code: 500, metadata: {} },
      { event_id: 22, occurred_at: '2026-10-01T09:00:00Z', request_id: 'safe-reference-2', method: 'GET', path: '/api/summary', error_kind: 'DatabaseError', status_code: 500, metadata: {} },
    ], total: 2 }) }));

  await page.goto('/admin/activity');
  const activityVolume = page.getByRole('region', { name: 'Volumen de esta página' });
  await expect(activityVolume).toContainText('2 registros en esta página');
  let releaseLogs!: () => void;
  let releaseLogsRequest!: () => void;
  let holdLogs = false;
  await page.unroute('**/api/operational-logs**');
  await page.route('**/api/operational-logs**', async (route) => {
    if (holdLogs) {
      releaseLogsRequest();
      await new Promise<void>((resolve) => { releaseLogs = resolve; });
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Error de prueba' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [
      { log_id: 11, occurred_at: '2026-10-03T12:00:00Z', level: 'info', source_system: 'cyberark', event: 'sync_started', message: 'Corrida iniciada', run_id: 'run-1', metadata: {} },
      { log_id: 12, occurred_at: '2026-10-03T13:00:00Z', level: 'warning', source_system: 'netskope', event: 'sync_partial', message: 'Corrida parcial', run_id: 'run-2', metadata: {} },
      { log_id: 13, occurred_at: '2026-10-02T13:00:00Z', level: 'error', source_system: 'sia', event: 'sync_failed', message: 'Falla de prueba', run_id: 'run-3', metadata: {} },
    ], total: 99 }) });
  });
  await page.getByRole('tab', { name: 'Logs operativos' }).click();
  const logs = page.locator('.operational-logs-panel');
  const logsVolume = logs.getByRole('region', { name: 'Volumen de esta página' });
  await expect(logs.getByRole('cell', { name: 'CyberArk', exact: true })).toBeVisible();
  await expect(logs.getByText('sync_partial', { exact: true })).toBeVisible();
  await logs.getByRole('button', { name: 'Ayuda: Alcance y privacidad de los logs' }).click();
  await expect(logs.getByText(/No presenta el archivo crudo, tokens, headers ni payloads/)).toBeVisible();
  await expect(logsVolume).toContainText('3 registros en esta página');
  holdLogs = true;
  const logsRequest = new Promise<void>((resolve) => { releaseLogsRequest = resolve; });
  await logs.getByRole('button', { name: 'Filtrar por nivel' }).click();
  await page.getByRole('option', { name: 'Advertencias' }).click();
  await expect(logsVolume).toContainText('Actualizando volumen de esta página');
  await expect(logsVolume).not.toContainText('3 registros en esta página');
  await logsRequest;
  releaseLogs();
  await expect(logsVolume).toContainText('Volumen no disponible');
  await expect(logsVolume).not.toContainText('Sin registros en la página cargada');
  holdLogs = false;
  await logs.getByRole('button', { name: 'Reintentar' }).click();
  await expect(logsVolume).toContainText('3 registros en esta página');

  await page.getByRole('tab', { name: 'Errores del sistema' }).click();
  const errors = page.locator('.operational-errors-panel');
  const errorsVolume = errors.getByRole('region', { name: 'Volumen de esta página' });
  await expect(errors).toContainText('safe-reference-1');
  await errors.getByRole('button', { name: 'Ayuda: Alcance y privacidad de los errores' }).click();
  await expect(errors.getByText(/No se muestran ni persisten mensajes, trazas, headers, cuerpos o secretos/)).toBeVisible();
  await expect(errorsVolume).toContainText('2 registros en esta página');
  failErrors = true;
  await errors.getByRole('searchbox', { name: 'Buscar errores por referencia, ruta o tipo' }).fill('safe-reference');
  await expect(errorsVolume).not.toContainText('2 registros en esta página');
  await expect(errorsVolume).toContainText('Volumen no disponible');
  await expect(errorsVolume).not.toContainText('Sin registros en la página cargada');
  failErrors = false;
  await errors.getByRole('button', { name: 'Reintentar' }).click();
  const recoveredErrorsVolume = errors.getByRole('region', { name: 'Volumen de esta página' });
  await expect(recoveredErrorsVolume).toContainText('2 registros en esta página');
  const axe = await new AxeBuilder({ page }).include('.page-volume').analyze();
  expect(axe.violations.map(({ id }) => id)).toEqual([]);
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
  await expect(page.getByText('Nueva actividad registrada por Otra operadora', { exact: true })).toBeVisible();
  await expect.poll(() => summaryRequests).toBeGreaterThan(summariesBeforeEvent);
  await page.getByRole('button', { name: 'Abrir notificaciones' }).click();
  await expect(page.getByText('Clasificación actualizada', { exact: true })).toBeVisible();
});

test('starting a sync runs straight away: progress toast, no confirmation dialog', async ({ page }) => {
  const requests: string[] = [];
  await mockAuthenticatedApp(page, { onRequest: (pathname) => { if (pathname === '/api/ingestion/preview') requests.push(pathname); } });
  await page.route('**/api/ingestion/all/runs*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Falla simulada' }) });
  });
  await page.goto('/admin/activity');
  await page.getByRole('button', { name: 'Abrir menú de usuario' }).click();
  await page.getByRole('button', { name: /Actualizar datos/ }).click();
  const toast = page.locator('.sync-toast');
  await expect(toast).toContainText('Sincronización en progreso');
  await expect(toast.locator('.sync-toast-source')).toHaveText(['CyberArk', 'Netskope']);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(requests).toEqual([]);
});

test('refresh from a Netskope workspace enqueues only Netskope without a PAM preview', async ({ page }) => {
  const requests: string[] = [];
  await mockAuthenticatedApp(page, { onRequest: (pathname) => {
    if (pathname === '/api/ingestion/preview' || pathname === '/api/ingestion/all/runs' || pathname === '/api/ingestion/netskope/runs') requests.push(pathname);
  } });
  await page.route('**/api/ingestion/netskope/runs', (route) => {
    requests.push('/api/ingestion/netskope/runs');
    return route.fulfill({
      status: 202, contentType: 'application/json', body: JSON.stringify({ run_id: 'run-netskope', status: 'queued' }),
    });
  });
  await page.route('**/api/ingestion/runs/run-netskope', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      run_id: 'run-netskope', source_system: 'netskope', status: 'completed',
      started_at: '2026-09-29T00:00:00Z', completed_at: '2026-09-29T00:00:01Z',
      expected_safe_count: null, received_safe_count: 0, received_member_count: 0, error_count: 0,
    }),
  }));
  await page.goto('/netskope/dem/sites');
  await page.getByRole('button', { name: 'Abrir menú de usuario' }).click();
  await page.getByRole('button', { name: /Actualizar (datos|Netskope)/ }).click();
  await expect.poll(() => requests).toContain('/api/ingestion/netskope/runs');
  await expect(page.locator('.sync-toast-source-mark .sync-toast-logo-dark')).toHaveAttribute('src', '/netskope-full-mint.png');
  expect(requests).not.toContain('/api/ingestion/preview');
  expect(requests).not.toContain('/api/ingestion/all/runs');
  await expect(page.locator('.sync-toast')).toContainText('Netskope actualizado');
});

test('sync progress stays clear of the profile menu', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAuthenticatedApp(page);
  await page.route('**/api/ingestion/all/runs*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Falla simulada' }) });
  });
  await page.goto('/pam');
  await page.getByRole('button', { name: 'Abrir menú de usuario' }).click();
  await page.getByRole('button', { name: /Actualizar datos/ }).click();
  await expect(page.locator('.sync-toast')).toContainText('Sincronización en progreso');
  await page.getByRole('button', { name: 'Abrir menú de usuario' }).click();
  const menu = await page.getByRole('region', { name: 'Menú de usuario' }).boundingBox();
  const toast = await page.locator('.sync-toast').boundingBox();
  expect(menu).not.toBeNull();
  expect(toast).not.toBeNull();
  expect(toast!.y >= menu!.y + menu!.height || toast!.x + toast!.width <= menu!.x).toBe(true);
});

test('a sync enqueues PAM, isolated PSM, and configured sources', async ({ page }) => {
  await mockAuthenticatedApp(page);
  let enqueuedSourceSystems: string[] = [];
  await page.route('**/api/ingestion/all/runs?scope=cyberark', async (route) => {
    expect(new URL(route.request().url()).searchParams.get('scope')).toBe('cyberark');
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
  await page.getByRole('button', { name: 'Abrir menú de usuario' }).click();
  await page.getByRole('button', { name: /Actualizar datos/ }).click();

  await expect.poll(() => enqueuedSourceSystems).toEqual(['cyberark', 'cyberark', 'identity_administration', 'sia', 'access']);
  const toast = page.locator('.sync-toast');
  await expect(toast.locator('.sync-toast-source')).toHaveCount(1);
  await expect(toast.locator('.sync-toast-source')).toHaveText('CyberArk');
  await expect(toast).toContainText('CyberArk actualizado.');
  await expect(toast).not.toContainText('Fuentes completadas');
  await expect(toast).not.toContainText('safes actualizados');
  await expect(toast).not.toContainText('plataformas, PSM/conectores');
  await expect(toast.locator('.sync-toast-source-list')).not.toContainText(/Identity Administration|SIA|Access space/);
  await expect(page.locator('.app-toast')).toHaveCount(0);
});

for (const theme of ['dark', 'light'] as const) {
  test(`UX-SYNC-001: all CyberArk feature runs show one accessible tool chip in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript((value) => window.localStorage.setItem('custodia-theme:v1', value), theme);
    await mockAuthenticatedApp(page);
    const sources = ['cyberark', 'identity_administration', 'sia', 'access'];
    const runIds = sources.map((_, index) => `ux-sync-${index}`);
    let completeRuns = false;
    await page.route('**/api/ingestion/all/runs?scope=cyberark', (route) => route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ runs: sources.map((source_system, index) => ({ run_id: runIds[index], status: 'queued', source_system })) }),
    }));
    await page.route('**/api/ingestion/runs/ux-sync-*', (route) => {
      const runId = new URL(route.request().url()).pathname.split('/').pop() || '';
      const index = runIds.indexOf(runId);
      const status = completeRuns ? 'completed' : 'running';
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ run_id: runId, source_system: sources[index], status, started_at: '2026-10-02T12:00:00Z', completed_at: status === 'completed' ? '2026-10-02T12:00:01Z' : null, received_object_count: 1, received_safe_count: 1, error_count: 0 }),
      });
    });

    await page.goto('/pam');
    await page.getByRole('button', { name: 'Abrir menú de usuario' }).click();
    await page.getByRole('button', { name: /Actualizar datos/ }).click();

    const toast = page.locator('.sync-toast');
    await expect(toast).toContainText('Actualizando CyberArk en corridas independientes.');
    await expect(toast.locator('.sync-toast-source')).toHaveCount(1);
    await expect(toast.locator('.sync-toast-source')).toHaveText('CyberArk');
    await expect(toast.locator('.sync-toast-source-list')).not.toContainText(/Identity Administration|SIA|Access space/);
    const runningAxe = await new AxeBuilder({ page }).include('.sync-toast').analyze();
    expect(runningAxe.violations.map(({ id }) => id), `${theme} running sync toast axe`).toEqual([]);

    completeRuns = true;
    await expect(toast).toContainText('Sincronización completada');
    await expect(toast).toContainText('CyberArk actualizado.');
    await expect(toast.locator('.sync-toast-icon img')).toHaveAttribute('src', '/cyberark-logo-mint.png');
    const successAxe = await new AxeBuilder({ page }).include('.sync-toast').analyze();
    expect(successAxe.violations.map(({ id }) => id), `${theme} successful sync toast axe`).toEqual([]);
  });
}

test('ACCESS-AUDIT-EXPORT-001: the export button follows the permission and carries the active filters', async ({ page }) => {
  const basePermissions = ['access:manage', 'coverage:read'];
  await mockAuthenticatedApp(page, { permissions: basePermissions });
  await page.goto('/admin/activity');
  await expect(page.getByText('Finalizó sync', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exportar CSV' })).toHaveCount(0);

  await mockAuthenticatedApp(page, { permissions: [...basePermissions, 'inventory:export'] });
  const exported: URLSearchParams[] = [];
  await page.route('**/api/activity/export.csv?*', (route) => {
    exported.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: '\ufeffID\n1\n' });
  });
  await page.goto('/admin/activity');
  await expect(page.getByText('Finalizó sync', { exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Buscar actividad por actor, Safe o entidad' }).fill('Operador');
  await expect(page.getByRole('button', { name: 'Exportar CSV' })).toBeEnabled();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar CSV' }).click();
  expect((await download).suggestedFilename()).toBe('custodia-actividad.csv');
  await expect(page.getByRole('status')).toContainText('CSV descargado con los filtros activos');
  expect(exported.at(-1)?.get('q')).toBe('Operador');
  expect((await new AxeBuilder({ page }).include('.activity-panel').analyze()).violations.map(({ id }) => id)).toEqual([]);
});
