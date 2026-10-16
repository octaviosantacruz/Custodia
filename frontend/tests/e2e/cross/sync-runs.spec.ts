import AxeBuilder from '@axe-core/playwright';
import { expect, mockAuthenticatedApp, test } from '../support/fixtures';

for (const theme of ['dark', 'light'] as const) {
  test(`UX-SYNC-001 tool-cycle queue and notice remain clear and accessible in ${theme} theme`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript((value) => window.localStorage.setItem('dshub-theme:v1', value), theme);
    await mockAuthenticatedApp(page, {
      latestRun: {
        run_id: 'sia-failed', source_system: 'sia', status: 'failed',
        completed_at: '2026-10-02T12:06:00Z', received_object_count: 5,
      },
    });
    await page.route('**/api/ingestion/runs?limit=50', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows: [
        {
          run_id: 'pam', source_system: 'cyberark', source_file: 'cyberark-api', status: 'completed',
          enqueued_at: '2026-10-02T12:00:00Z', started_at: '2026-10-02T12:00:30Z', completed_at: '2026-10-02T12:01:00Z',
          status_message: 'Conectando con cyberark', received_safe_count: 4, received_object_count: 4, triggered_by: 'system:scheduler',
        },
        {
          run_id: 'psm', source_system: 'cyberark', source_file: 'cyberark-psm-api', status: 'completed',
          enqueued_at: '2026-10-02T12:02:00Z', started_at: '2026-10-02T12:02:30Z', completed_at: '2026-10-02T12:04:00Z',
          received_safe_count: 2, received_object_count: 2, triggered_by: 'system:scheduler',
        },
        {
          run_id: 'identity', source_system: 'identity_administration', status: 'failed',
          enqueued_at: '2026-10-02T12:05:00Z', started_at: '2026-10-02T12:05:30Z', completed_at: '2026-10-02T12:06:00Z',
          received_object_count: 5, error_count: 1, triggered_by: 'operator-1',
        },
        {
          run_id: 'sia', source_system: 'sia', status: 'partial',
          enqueued_at: '2026-10-02T12:09:00Z', started_at: '2026-10-02T12:09:30Z', completed_at: '2026-10-02T12:10:00Z',
          received_object_count: 3, error_count: 1, triggered_by: 'system:scheduler',
        },
        {
          run_id: 'netskope', source_system: 'netskope', status: 'completed',
          enqueued_at: '2026-10-02T12:04:00Z', started_at: '2026-10-02T12:04:30Z', completed_at: '2026-10-02T12:05:00Z',
          received_object_count: 10, triggered_by: 'system:scheduler',
        },
      ] }),
    }));
    let eventPolls = 0;
    await page.route('**/api/events**', (route) => {
      eventPolls += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rows: eventPolls === 1 ? [] : [{
          event_id: 101, kind: 'sync', actor_id: 'system:scheduler', actor_name: 'system:scheduler',
          run_id: 'sia-failed', source_system: 'sia', created_at: '2026-10-02T12:06:00Z',
        }] }),
      });
    });
    await page.route('**/api/ingestion/runs/sia-failed', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ run_id: 'sia-failed', source_system: 'sia', status: 'failed', error_count: 1 }),
    }));

    await page.goto('/admin/activity');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect.poll(() => eventPolls).toBe(1);
    await page.getByRole('tab', { name: 'Sincronizaciones' }).click();

    const queue = page.locator('.sync-runs-panel');
    await expect(queue.getByText('2 ciclos recientes', { exact: true })).toBeVisible();
    const cyberArkCycle = queue.locator('.sync-run-item').filter({ has: page.getByText('CyberArk', { exact: true }) });
    const netskopeCycle = queue.locator('.sync-run-item').filter({ has: page.getByText('Netskope', { exact: true }) });
    await expect(queue.locator('.sync-run-item')).toHaveCount(2);
    // Timeline: one strip per tool, status also written as text.
    const timeline = queue.getByRole('region', { name: 'Últimos ciclos por herramienta' });
    const cyberArkStrip = timeline.locator('.sync-timeline-row').filter({ hasText: 'CyberArk' });
    await expect(cyberArkStrip.getByRole('list')).toHaveAccessibleName(/ciclos de CyberArk/);
    await expect(cyberArkStrip.getByRole('listitem')).toHaveCount(1);
    await expect(cyberArkStrip).toContainText('1 con aviso o fallo');
    await expect(timeline.locator('.sync-timeline-row').filter({ hasText: 'Netskope' })).toContainText('Sin avisos');
    await expect(cyberArkCycle).toContainText('Fallida');
    await expect(cyberArkCycle).toContainText('1 componente fallido');
    await expect(cyberArkCycle).toContainText('1 parcial');
    await expect(cyberArkCycle).toContainText('14 objetos');
    await expect(cyberArkCycle).toContainText('Manual');
    await expect(netskopeCycle).toContainText('Completada');
    await expect(netskopeCycle).toContainText('10 objetos');

    await cyberArkCycle.getByText('Detalle por componente').click();
    const components = cyberArkCycle.getByRole('table', { name: 'Componentes de CyberArk' });
    await expect(components).toBeVisible();
    await expect(components.getByRole('columnheader')).toHaveText(['Componente', 'Estado', 'Objetos', 'Etapa', 'Última actualización']);
    await expect(components.getByRole('row')).toHaveCount(5);
    const pamRow = components.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'PAM', exact: true }) });
    await expect(pamRow).toContainText('Finalizada');
    await expect(pamRow).not.toContainText('Conectando con cyberark');
    await expect(components).toContainText('PAM · catálogo PSM');
    const cells = await pamRow.locator('th, td').evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right };
    }));
    expect(cells.every((cell, index) => index === 0 || cells[index - 1].right <= cell.left + 1)).toBe(true);
    const queueAxe = await new AxeBuilder({ page }).include('.sync-runs-panel').analyze();
    expect(queueAxe.violations.map(({ id }) => id), `${theme} sync queue axe`).toEqual([]);

    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => eventPolls).toBe(2);
    const notice = page.locator('.app-toast-notice');
    await expect(notice).toContainText('CyberArk · ACTUALIZACIÓN');
    await expect(notice).toContainText('Sincronización automática con errores');
    await expect(notice).not.toContainText('SIA');
    const noticeAxe = await new AxeBuilder({ page }).include('.app-toast-notice').analyze();
    expect(noticeAxe.violations.map(({ id }) => id), `${theme} automatic notice axe`).toEqual([]);

    await page.goto('/pam');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.getByRole('button', { name: 'Abrir notificaciones' }).click();
    const notifications = page.getByRole('region', { name: 'Notificaciones' });
    await expect(notifications).toContainText('CyberArk · Fallida');
    await expect(notifications).toContainText('Netskope · Completada');
    await expect(notifications).not.toContainText('objetos inventariados');
    await expect(notifications).not.toContainText('SIA');
    const notificationsAxe = await new AxeBuilder({ page }).include('.notification-popover').analyze();
    expect(notificationsAxe.violations.map(({ id }) => id), `${theme} notification axe`).toEqual([]);
  });
}

test('SYNC-UI-002 schedule is task-scoped, editable only by access admins, and runs only the selected task (UX-AUD2-009)', async ({ page }) => {
  await mockAuthenticatedApp(page);
  const scheduled = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const scheduleRows = [
    { task_key: 'pam_safes', source_system: 'cyberark', source_file: 'cyberark-api', configured: true, active: false, interval_minutes: 30, interval_source: 'administrative', admin_override: 30, last_success_at: '2026-10-04T10:00:00Z', last_attempt_at: '2026-10-04T10:00:30Z', last_status: 'completed', consecutive_failures: 0, next_scheduled_at: scheduled },
    { task_key: 'pam_psm', source_system: 'cyberark', source_file: 'cyberark-psm-api', configured: true, active: false, interval_minutes: 60, interval_source: 'global_default', admin_override: null, last_success_at: null, last_attempt_at: null, last_status: null, consecutive_failures: 0, next_scheduled_at: '2026-10-04T11:00:00Z' },
    { task_key: 'netskope_dlp', source_system: 'netskope', source_file: 'netskope-dlp-api', configured: false, active: false, interval_minutes: 0, interval_source: 'environment_task', admin_override: null, last_success_at: null, last_attempt_at: null, last_status: null, consecutive_failures: 0, next_scheduled_at: null },
  ];
  const saveCalls: Array<{ path: string; body: unknown }> = [];
  let runPath = '';
  await page.route('**/api/ingestion/schedules**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/ingestion/schedules' && route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: scheduleRows }) });
    }
    if (route.request().method() === 'PUT') {
      saveCalls.push({ path: url.pathname, body: route.request().postDataJSON() });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ updated: true }) });
    }
    if (route.request().method() === 'POST') {
      runPath = url.pathname;
      return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ run_id: 'manual-task-run', status: 'queued' }) });
    }
    return route.fallback();
  });
  await page.route('**/api/ingestion/runs/manual-task-run', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ run_id: 'manual-task-run', source_system: 'cyberark', task_key: 'pam_psm', source_file: 'cyberark-psm-api', status: 'completed', started_at: '2026-10-04T10:20:00Z', completed_at: '2026-10-04T10:20:01Z', error_count: 0 }),
  }));

  await page.goto('/admin/activity');
  await page.getByRole('tab', { name: 'Agenda' }).click();
  const panel = page.locator('.sync-schedule-panel');
  await expect(panel.getByRole('row')).toHaveCount(4);
  await expect(page.locator('html')).toHaveAttribute('data-theme', test.info().project.name.includes('light') ? 'light' : 'dark');
  await expect(panel.locator(`time[datetime="${scheduled}"]`)).toHaveAttribute('title', 'en 1 d');
  await expect(panel.locator('time[datetime="2026-10-04T10:00:00Z"]')).toHaveAttribute('title', /^hace /);
  await expect(panel).toContainText('pam_safes');
  await expect(panel).toContainText('pam_psm');
  await expect(panel).toContainText('netskope_dlp');
  await expect(panel).toContainText('Sin configurar');
  await expect(panel).toContainText('Valor global');
  await panel.getByRole('spinbutton', { name: 'Intervalo de pam_safes en minutos' }).fill('45');
  const safeRow = panel.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /pam_safes/ }) });
  await safeRow.getByRole('button', { name: 'Guardar' }).click();
  await expect.poll(() => saveCalls.length).toBe(1);
  expect(saveCalls[0]).toEqual({ path: '/api/ingestion/schedules/pam_safes', body: { interval_minutes: 45 } });

  const psmRow = panel.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /pam_psm/ }) });
  await psmRow.getByRole('button', { name: 'Sincronizar ahora' }).click();
  await expect.poll(() => runPath).toBe('/api/ingestion/schedules/pam_psm/runs');
  await page.mouse.move(0, 0);
  const axe = await new AxeBuilder({ page }).include('.sync-schedule-panel').analyze();
  expect(
    axe.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => ({ target: node.target, summary: node.failureSummary })) })),
    'schedule panel axe',
  ).toEqual([]);
});

test('SYNC-UI-002 reader can inspect schedule but cannot edit or run tasks', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'audit:read'] });
  await page.route('**/api/ingestion/schedules', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [
      { task_key: 'sia', source_system: 'sia', source_file: 'sia-api', configured: true, active: false, interval_minutes: 0, interval_source: 'global_default', admin_override: null, last_success_at: null, last_attempt_at: null, last_status: null, consecutive_failures: 0, next_scheduled_at: null },
    ] }),
  }));
  await page.goto('/admin/activity');
  await page.getByRole('tab', { name: 'Agenda' }).click();
  const panel = page.locator('.sync-schedule-panel');
  await expect(panel).toContainText('sia');
  await expect(panel.getByRole('button', { name: 'Guardar' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Sincronizar ahora' })).toHaveCount(0);
});

test('component detail stays open when a running cycle completes and shows its final result', async ({ page }) => {
  await mockAuthenticatedApp(page);
  const startedAt = new Date(Date.now() - 240_000).toISOString();
  const heartbeatAt = new Date(Date.now() - 180_000).toISOString();
  let completed = false;
  await page.route('**/api/ingestion/runs?limit=50', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ rows: [{
      run_id: 'netskope-progress', source_system: 'netskope', source_file: 'netskope-api',
      status: completed ? 'completed' : 'running', enqueued_at: startedAt, started_at: startedAt,
      completed_at: completed ? new Date().toISOString() : null, heartbeat_at: heartbeatAt,
      status_message: 'Persistiendo inventario Netskope', received_object_count: completed ? 25 : 10,
      triggered_by: 'operator-1', error_count: 0,
    }] }),
  }));
  await page.goto('/admin/activity');
  await page.getByRole('tab', { name: 'Sincronizaciones' }).click();
  const cycle = page.locator('.sync-run-item');
  const toggle = cycle.getByText('Detalle por componente');
  await toggle.focus();
  await page.keyboard.press('Enter');
  const table = cycle.getByRole('table', { name: 'Componentes de Netskope' });
  await expect(table).toBeVisible();
  await expect(table).toContainText('Persistiendo inventario Netskope');
  await expect(table.locator('.sync-run-update.is-stale')).toContainText('Última señal');
  completed = true;
  await expect(cycle).toContainText('25 objetos');
  await expect(table).toBeVisible();
  await expect(table).toContainText('Finalizada');
  await expect(table).not.toContainText('Persistiendo inventario Netskope');
  await expect(table.locator('.sync-run-update.is-stale')).toHaveCount(0);
  await expect(cycle).not.toContainText('No aplica');
});

test('SYNC-UI-001 a run with a failed optional layer shows its layers and what was not retired', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.route('**/api/ingestion/runs?limit=50', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ rows: [{
      run_id: 'identity-partial', source_system: 'identity_administration', source_file: 'identity-administration-scim',
      status: 'partial', enqueued_at: '2026-10-03T12:00:00Z', started_at: '2026-10-03T12:00:10Z',
      completed_at: '2026-10-03T12:00:40Z', received_object_count: 90, error_count: 1, triggered_by: 'system:scheduler',
    }] }),
  }));
  await page.route('**/api/ingestion/runs/identity-partial/stages', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ rows: [
      { stage: 'users', required: true, status: 'completed', item_count: 83, duration_ms: 1200, error_kind: null, detail: null },
      { stage: 'roles', required: true, status: 'completed', item_count: 26, duration_ms: 400, error_kind: null, detail: null },
      { stage: 'members_directory', required: false, status: 'failed', item_count: null, duration_ms: 90, error_kind: 'IdentityAdminError', detail: null },
      { stage: 'federations', required: false, status: 'skipped', item_count: null, duration_ms: 0, error_kind: null, detail: 'CA_IDENTITY_ADMIN_FEDERATIONS_PATH sin configurar' },
    ] }),
  }));
  await page.route('**/api/ingestion/sources/identity_administration/stages/history**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ rows: [
      { run_id: 'r3', completed_at: '2026-10-03T12:00:40Z', stage: 'users', status: 'completed', item_count: 83, duration_ms: 1500 },
      { run_id: 'r2', completed_at: '2026-10-03T11:00:40Z', stage: 'users', status: 'completed', item_count: 82, duration_ms: 1000 },
      { run_id: 'r2', completed_at: '2026-10-03T11:00:40Z', stage: 'members_directory', status: 'failed', item_count: null, duration_ms: 90 },
    ] }),
  }));
  await page.goto('/admin/activity');
  await page.getByRole('tab', { name: 'Sincronizaciones' }).click();
  const cycle = page.locator('.sync-run-item');
  await expect(cycle).toContainText('Con avisos');
  await expect(cycle).toContainText('Terminó con avisos');
  await cycle.getByText('Detalle por componente').click();
  const layers = cycle.getByRole('table', { name: /^Capas de/ });
  await expect(layers.getByRole('row')).toHaveCount(5);
  const failed = layers.getByRole('row').filter({ hasText: 'members directory' });
  await expect(failed).toContainText('Opcional');
  await expect(failed).toContainText('Fallida');
  await expect(failed).toContainText('No se retiró lo que esta capa gobierna.');
  await expect(layers.getByRole('row').filter({ hasText: 'federations' })).toContainText('sin configurar');
  await expect(layers.getByRole('row').filter({ hasText: 'users' })).toContainText('2 corridas · mediana 1,3 s · 83 filas');
  await expect(failed).toContainText('1 con fallo');
  const axe = await new AxeBuilder({ page }).include('.sync-runs-panel').analyze();
  expect(axe.violations.map(({ id }) => id)).toEqual([]);
});

test('SYNC-OBS-001 stale banner appears only for the workspace source with recorded evidence (UX-AUD2-009)', async ({ page }) => {
  await mockAuthenticatedApp(page);
  const base = { source_file: 'api', configured: true, active: false, interval_minutes: 30, interval_source: 'environment_source', admin_override: null, last_attempt_at: null, last_status: 'completed', consecutive_failures: 0, next_scheduled_at: null, stale_after_intervals: 3 };
  await page.route('**/api/ingestion/schedules', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [
      { ...base, task_key: 'netskope_dlp', source_system: 'netskope', last_success_at: '2026-10-04T10:00:00Z', freshness: 'stale', intervals_since_success: 5.2 },
      { ...base, task_key: 'sia', source_system: 'sia', last_success_at: null, freshness: 'unknown', intervals_since_success: null },
    ] }),
  }));
  await page.goto('/netskope');
  const banner = page.getByRole('status', { name: 'Datos desactualizados' });
  await expect(banner).toContainText('netskope_dlp');
  await expect(page.locator('html')).toHaveAttribute('data-theme', test.info().project.name.includes('light') ? 'light' : 'dark');
  await expect(banner.locator('time[datetime="2026-10-04T10:00:00Z"]')).toHaveAttribute('title', /^hace /);
  await expect(banner).toContainText('5,2 intervalos de 30 min; se avisa tras 3');
  const axe = await new AxeBuilder({ page }).include('.stale-data-banner').analyze();
  expect(axe.violations.map(({ id }) => id)).toEqual([]);
  await page.goto('/pam/sia');
  await expect(page.getByRole('status', { name: 'Datos desactualizados' })).toHaveCount(0);
});
