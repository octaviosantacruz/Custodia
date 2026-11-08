import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mockAuthenticatedApp } from '../../support/fixtures';

const CSV = [
  'Instance Name,Ambiente,Private IP,Puerto,CA SIA,CA DBA',
  'srv-nuevo,PROD,10.0.0.9,22,Sí,No',
].join('\n');

const preview = (mode: string) => ({
  mode,
  counts: { incoming: 1, new: 1, changed: 1, unchanged: 0, missing: 2, already_retired: 0 },
  samples: {
    new: [{ private_ip: '10.0.0.9', port: 22, instance_name: 'srv-nuevo', fields: [], reactivated: false }],
    changed: [{ private_ip: '10.67.9.143', port: 22, instance_name: 'dev-compute-db-desa', fields: ['environment'], reactivated: false }],
    missing: [{ private_ip: '10.0.0.1', port: 22, instance_name: 'srv-viejo', fields: [], reactivated: false }],
  },
  errors: [],
});

test('COV-002: the import shows what changes before writing and retires instead of deleting', async ({ page }) => {
  await mockAuthenticatedApp(page);
  const modes: string[] = [];
  let imported: { mode: string; rows: unknown[] } | null = null;
  await page.route('**/api/connection-inventory/import/preview', async (route) => {
    const body = route.request().postDataJSON() as { mode: string };
    modes.push(body.mode);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(preview(body.mode)) });
  });
  await page.route('**/api/connection-inventory/import', async (route) => {
    imported = route.request().postDataJSON() as { mode: string; rows: unknown[] };
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ imported: true, import_id: 'x', row_count: 1, mode: imported.mode, counts: preview(imported.mode).counts }),
    });
  });
  await page.goto('/pam/assets');
  await page.locator('input[type="file"]').setInputFiles({ name: 'destinos.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });

  const dialog = page.getByRole('alertdialog', { name: 'Importar destinos' });
  await expect(dialog).toBeVisible();
  const summary = dialog.getByRole('group', { name: 'Resumen de la importación' }).or(dialog.locator('.connection-import-counts'));
  await expect(summary).toContainText('Nuevos');
  await expect(summary).toContainText('Se retiran');
  await expect(dialog.getByText('10.0.0.1:22')).toBeVisible();
  await expect(dialog.getByText('ambiente')).toBeVisible();
  expect((await new AxeBuilder({ page }).include('.confirm-dialog').analyze()).violations.map(({ id }) => id)).toEqual([]);

  await dialog.getByText('Reemplazar todo').click();
  await expect(dialog.locator('.connection-import-counts')).toContainText('Se quitan');
  await dialog.getByText('Actualizar', { exact: true }).click();
  await expect(dialog.locator('.connection-import-counts')).toContainText('Se retiran');
  expect(modes).toEqual(['update', 'replace', 'update']);

  await dialog.getByRole('button', { name: 'Importar', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(imported).toMatchObject({ mode: 'update' });
  await expect(page.getByText(/Importado: 1 nuevos, 1 cambian, 2 retirados/)).toBeVisible();
});

test('COV-002: a file with row errors cannot be imported', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.route('**/api/connection-inventory/import/preview', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ...preview('update'), errors: [{ row: 3, message: 'IP y puerto repetidos (ya aparecen en la fila 2)' }] }),
  }));
  await page.goto('/pam/assets');
  await page.locator('input[type="file"]').setInputFiles({ name: 'destinos.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  const dialog = page.getByRole('alertdialog', { name: 'Importar destinos' });
  await expect(dialog.getByText('Fila 3: IP y puerto repetidos')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Importar', exact: true })).toBeDisabled();
});

test('COV-002: exporting downloads the destinations CSV', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.route('**/api/connection-inventory/export.csv', (route) => route.fulfill({
    status: 200, contentType: 'text/csv; charset=utf-8', body: '﻿Instance Name,Ambiente\n',
  }));
  await page.goto('/pam/assets');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar CSV' }).click();
  expect((await download).suggestedFilename()).toBe('custodia-destinos.csv');
  // The notice carries the tool's logo, not the generic check, because it was raised from a CyberArk workspace.
  const notice = page.locator('.app-toast-notice');
  await expect(notice).toContainText('CyberArk · ACTUALIZACIÓN');
  await expect(notice.locator('.app-toast-source-image')).toHaveAttribute('src', '/cyberark-logo-mint.png');
});

test('COV-ABM: add, edit, retire and bulk-edit destinations, each through its own endpoint', async ({ page }) => {
  await mockAuthenticatedApp(page);
  const calls: { method: string; path: string; body: unknown }[] = [];
  for (const pattern of ['**/api/connection-inventory', '**/api/connection-inventory/101', '**/api/connection-inventory/bulk-update']) {
    await page.route(pattern, async (route) => {
      const request = route.request();
      if (request.method() === 'GET') return route.fallback();
      calls.push({ method: request.method(), path: new URL(request.url()).pathname, body: request.postDataJSON() });
      return route.fulfill({ status: request.method() === 'POST' && !request.url().endsWith('bulk-update') ? 201 : 200, contentType: 'application/json', body: JSON.stringify({ inventory_id: 9, changed: 1 }) });
    });
  }
  await page.goto('/pam/assets');

  // Edit sends only what changed.
  await page.getByRole('button', { name: 'Editar dev-compute-db-desa' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Editar destino' });
  await dialog.getByLabel('Ambiente').fill('STG');
  await dialog.getByRole('button', { name: 'Guardar' }).click();
  await expect(dialog).toHaveCount(0);
  expect(calls[0]).toMatchObject({ method: 'PATCH', path: '/api/connection-inventory/101', body: { environment: 'STG' } });
  expect(Object.keys(calls[0].body as object)).toEqual(['environment']);

  // Add: IP + port are the key and the form blocks an invalid port.
  await page.getByRole('button', { name: 'Agregar destino' }).click();
  const add = page.getByRole('alertdialog', { name: 'Agregar destino' });
  await add.getByLabel('Instancia').fill('srv-nuevo');
  await add.getByLabel('IP', { exact: true }).fill('10.9.9.9');
  await add.getByLabel('Puerto').fill('99999');
  await expect(add.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  await add.getByLabel('Puerto').fill('22');
  await add.getByRole('button', { name: 'Guardar' }).click();
  expect(calls[1]).toMatchObject({ method: 'POST', path: '/api/connection-inventory', body: { instance_name: 'srv-nuevo', private_ip: '10.9.9.9', port: 22 } });

  // Retire from the row.
  await page.getByRole('button', { name: 'Retirar dev-compute-db-desa' }).click();
  await expect.poll(() => calls.length).toBe(3);
  expect(calls[2]).toMatchObject({ method: 'PATCH', body: { lifecycle_status: 'retired' } });

  // Bulk: select, pick a change, apply to the selection.
  await page.getByRole('checkbox', { name: 'Seleccionar dev-compute-db-desa' }).check();
  const bar = page.getByRole('region', { name: 'Edición en lote' });
  await expect(bar).toContainText('1 seleccionado');
  await expect(bar.getByRole('button', { name: /Aplicar a 1/ })).toBeDisabled();
  await bar.getByRole('button', { name: 'ZSP a aplicar' }).click();
  await page.getByRole('option', { name: 'No', exact: true }).click();
  await bar.getByRole('button', { name: /Aplicar a 1/ }).click();
  await expect.poll(() => calls.length).toBe(4);
  expect(calls[3]).toMatchObject({ method: 'POST', path: '/api/connection-inventory/bulk-update', body: { inventory_ids: [101], changes: { zsp_implemented: false } } });
});

test('COV-ABM: one click on a declared mark changes Platform and the label says Platform, not CA SIA', async ({ page }) => {
  await mockAuthenticatedApp(page);
  const bodies: unknown[] = [];
  await page.route('**/api/connection-inventory/101', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ changed: 1 }) });
  });
  await page.goto('/pam/assets');
  // The sheet had CA SIA = Sí, so the next value is No.
  await page.getByRole('button', { name: /^Platform de dev-compute-db-desa: Sí/ }).click();
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]).toEqual({ ca_sia: false });
  await page.getByRole('checkbox', { name: 'Seleccionar dev-compute-db-desa' }).check();
  const bar = page.getByRole('region', { name: 'Edición en lote' });
  await expect(bar.getByRole('button', { name: 'Platform a aplicar' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'DBA a aplicar' })).toBeVisible();
  await expect(page.getByText('CA SIA', { exact: true })).toHaveCount(0);
});

test('COV-003: classifying SIA policies is a person decision, saved in one call, and deviations filter the table', async ({ page }) => {
  await mockAuthenticatedApp(page);
  let saved: { items: { policy_source_id: string; capability: string | null }[] } | null = null;
  await page.route('**/api/connection-inventory/sia-policies', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    saved = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ changed: saved!.items.length }) });
  });
  const queries: string[] = [];
  await page.route('**/api/connection-inventory?*', (route) => { queries.push(new URL(route.request().url()).searchParams.get('deviation') ?? ''); return route.fallback(); });
  await page.goto('/pam/assets');

  // The strip shows the deviations of each capability and the banner says what is missing.
  await expect(page.getByRole('button', { name: /Desvíos DBA/ })).toContainText('1');
  await expect(page.getByRole('status').filter({ hasText: '2 de 3 políticas SIA sin clasificar' })).toBeVisible();
  await page.getByRole('button', { name: /Desvíos DBA/ }).click();
  await expect.poll(() => queries.at(-1)).toBe('dba');

  await page.getByRole('button', { name: 'Políticas SIA' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Clasificar políticas SIA' });
  await expect(dialog.getByText('sugerida: DBA')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  // The name only suggests: nothing changes until the suggestions are applied and saved.
  await dialog.getByRole('button', { name: /Usar sugerencias por nombre \(1\)/ }).click();
  await dialog.getByRole('button', { name: 'Guardar 1' }).click();
  await expect(dialog).toHaveCount(0);
  expect(saved).toEqual({ items: [{ policy_source_id: 'policy-21', capability: 'dba' }] });
});

test('COV-004: work state, responsible and note are edited inline, in bulk and filtered, with the history of the row', async ({ page }) => {
  await mockAuthenticatedApp(page);
  const calls: { path: string; body: unknown }[] = [];
  for (const pattern of ['**/api/connection-inventory/101', '**/api/connection-inventory/bulk-update']) {
    await page.route(pattern, async (route) => {
      if (route.request().method() === 'GET') return route.fallback();
      calls.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ changed: 1 }) });
    });
  }
  const queries: string[] = [];
  await page.route('**/api/connection-inventory?*', (route) => { const params = new URL(route.request().url()).searchParams; queries.push(`${params.get('work_status')}|${params.get('responsible')}`); return route.fallback(); });
  await page.goto('/pam/assets');

  await expect(page.getByRole('row', { name: /dev-compute-db-desa/ })).toContainText('Ana');
  // Inline: one change of state from the row.
  await page.getByRole('button', { name: 'Estado de trabajo de dev-compute-db-desa' }).click();
  await page.getByRole('option', { name: 'Bloqueado' }).click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0]).toEqual({ path: '/api/connection-inventory/101', body: { work_status: 'blocked' } });

  // Filters travel to the API, with the counts in the labels.
  await page.getByRole('button', { name: 'Filtrar por estado de trabajo' }).click();
  await expect(page.getByRole('option', { name: 'Pendiente (1)' })).toBeVisible();
  await page.getByRole('option', { name: 'Pendiente (1)' }).click();
  await expect.poll(() => queries.at(-1)).toBe('pending|');
  await page.getByRole('button', { name: 'Filtrar por responsable' }).click();
  await page.getByRole('option', { name: 'Ana' }).click();
  await expect.poll(() => queries.at(-1)).toBe('pending|Ana');

  // Bulk: state and responsible for the selection.
  await page.getByRole('checkbox', { name: 'Seleccionar dev-compute-db-desa' }).check();
  const bar = page.getByRole('region', { name: 'Edición en lote' });
  await bar.getByRole('button', { name: 'Estado de trabajo a aplicar' }).click();
  await page.getByRole('option', { name: 'En curso' }).click();
  await bar.getByRole('button', { name: 'Responsable a aplicar' }).click();
  await page.getByRole('option', { name: 'Sin responsable' }).click();
  await bar.getByRole('button', { name: /Aplicar a 1/ }).click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1].body).toEqual({ inventory_ids: [101], changes: { work_status: 'in_progress', responsible: '' } });

  // The detail shows the note and the history of the row.
  await page.getByRole('button', { name: /Ver cobertura de dev-compute-db-desa/ }).click();
  await expect(page.getByText('Ventana el viernes')).toBeVisible();
  await expect(page.getByText('Trabajo: Pendiente → En curso')).toBeVisible();
});

test('COV-008: Sin inventariar lists observed addresses and adds one through the destination dialog with only its IP filled in', async ({ page }) => {
  await mockAuthenticatedApp(page);
  const created: unknown[] = [];
  const uninventoriedQueries: string[] = [];
  page.on('request', (request) => { if (request.url().includes('/api/connection-inventory/uninventoried')) uninventoriedQueries.push(new URL(request.url()).searchParams.get('include_internal') ?? ''); });
  await page.route('**/api/connection-inventory', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') return route.fallback();
    created.push(request.postDataJSON());
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ inventory_id: 9, changed: 1 }) });
  });
  await page.goto('/pam/assets');
  await page.getByRole('tab', { name: 'Sin inventariar' }).click();

  await expect(page.getByRole('tab', { name: 'Sin inventariar' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText(/3 direcciones sin inventariar; se muestran las primeras 2/)).toBeVisible();
  const both = page.getByRole('row', { name: /^10\.67\.9\.200/ });
  await expect(both).toContainText('Politica-DEV-OCI-Platform');
  await expect(both).toContainText('1 Safe');
  await expect(page.getByRole('row', { name: /^10\.67\.9\.201/ })).toContainText('No aparece');
  expect(uninventoriedQueries.at(-1)).toBe('true');
  expect((await new AxeBuilder({ page }).include('#coverage-tabpanel').analyze()).violations.map(({ id }) => id)).toEqual([]);

  // The IP arrives filled in; a name is still required, so nothing is invented.
  await page.getByRole('button', { name: 'Dar de alta 10.67.9.200' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Agregar destino' });
  await expect(dialog.getByLabel('IP', { exact: true })).toHaveValue('10.67.9.200');
  await expect(dialog.getByLabel('Instancia')).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  await dialog.getByLabel('Instancia').fill('srv-observado');
  await dialog.getByRole('button', { name: 'Guardar' }).click();
  await expect(dialog).toHaveCount(0);
  expect(created).toHaveLength(1);
  expect(created[0]).toMatchObject({ instance_name: 'srv-observado', private_ip: '10.67.9.200', port: null, ca_sia: null, ca_dba: null, zsp_implemented: null, access_available: null });
  await expect(page.getByRole('tab', { name: 'Sin inventariar' })).toHaveAttribute('aria-selected', 'true');
});

test('COV-005: the Avance tab shows X of N per capability and environment and the weekly series', async ({ page }) => {
  await mockAuthenticatedApp(page);
  let snapshots = 0;
  const staleDays: string[] = [];
  page.on('request', (request) => { if (request.url().includes('/api/connection-inventory/stale')) staleDays.push(new URL(request.url()).searchParams.get('days') ?? ''); });
  await page.route('**/api/connection-inventory/progress/snapshot', async (route) => {
    snapshots += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total: {}, by_environment: [], by_responsible: [] }) });
  });
  await page.goto('/pam/assets');
  await page.getByRole('tab', { name: 'Avance' }).click();

  await expect(page.getByRole('tab', { name: 'Avance' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('45 de 51 coinciden')).toBeVisible();
  await expect(page.getByText('38 de 51 coinciden')).toBeVisible();
  await expect(page.getByText('8 de 51 incorporados')).toBeVisible();
  // Per environment, always with its denominator.
  const prod = page.getByRole('row', { name: /^PROD/ });
  await expect(prod).toContainText('28 de 30');
  await expect(prod).toContainText('4 de 30');
  // Per responsible: who carries the pending and blocked work, and the destinations nobody owns.
  const ana = page.getByRole('row', { name: /^Ana/ });
  await expect(ana).toContainText('10 de 21');
  await expect(ana).toContainText('4 de 21');
  await expect(page.getByRole('row', { name: /^Sin responsable/ })).toContainText('20 de 30');
  // Stale destinations: who is stuck, since when, and that the list is capped against the real total.
  await expect(page.getByText(/3 destinos llevan más de 14 días sin movimiento; se muestran los 2 más antiguos/)).toBeVisible();
  const stuck = page.getByRole('row', { name: /^dev-compute-db-desa/ });
  await expect(stuck).toContainText('56 días');
  await expect(stuck).toContainText('Bloqueado');
  await expect(page.getByRole('row', { name: /^prod-app-01/ })).toContainText('En el inventario desde');
  await page.getByRole('button', { name: /Plazo sin movimiento/ }).click();
  await page.getByRole('option', { name: '30 días' }).click();
  await expect.poll(() => staleDays.at(-1)).toBe('30');
  // The chart is an image with a text equivalent, and the plain-language summary compares first and current.
  await expect(page.getByRole('img', { name: /Evolución semanal/ })).toBeVisible();
  await expect(page.getByText(/Platform 40 de 51 → 45 de 51/)).toBeVisible();
  expect((await new AxeBuilder({ page }).include('.coverage-progress').analyze()).violations.map(({ id }) => id)).toEqual([]);

  await page.getByRole('button', { name: 'Guardar la foto de hoy' }).click();
  await expect.poll(() => snapshots).toBe(1);
  await page.getByRole('tab', { name: 'Destinos' }).click();
  await expect(page.getByText('10.67.9.143', { exact: true })).toBeVisible();
});
