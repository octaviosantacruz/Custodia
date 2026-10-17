import AxeBuilder from '@axe-core/playwright';
import { expect, mockAuthenticatedApp, test } from '../../support/fixtures';

test('Safe Health keeps policy-neutral technical fields out of its signals', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/safes');

  await expect(page.getByRole('heading', { name: 'Safes', exact: true })).toBeVisible();
  await page.getByText('Indicadores rápidos', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Safe Health' })).toBeVisible();
  await page.getByRole('button', { name: 'Glosario de Safe Health' }).click();
  const glossary = page.getByRole('dialog', { name: 'Glosario de Safe Health' });
  await expect(glossary).toContainText('no se consideran un problema sin una política');
  await glossary.getByRole('button', { name: 'Volver' }).click();
  await expect(page.getByRole('button', { name: /OLAC/ })).toHaveCount(0);
});

test('Safe table classification summary covers the whole filtered result, not only loaded rows', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'], includeSafe: true, largeInventory: true });
  await page.goto('/pam/safes');
  const table = page.getByTestId('safe-table');
  const progress = table.getByRole('region', { name: 'Progreso de clasificación de Safes' });
  await expect(progress).toContainText('51 Safes · 1 cargadas en la tabla');
  await expect(progress.getByRole('img', { name: /En revisión: 1.*Pendientes: 50/ })).toBeVisible();
  await expect(progress.getByText('Pendientes', { exact: true })).toBeVisible();
  await expect(page.getByText('Seleccioná una fila para abrir el detalle.', { exact: true })).toHaveCount(0);
  await progress.getByRole('button', { name: 'Ayuda: Progreso de clasificación visible' }).click();
  await expect(progress).toContainText('estén o no cargadas en la tabla');
  const axe = await new AxeBuilder({ page }).include('.safe-classification-progress').analyze();
  expect(axe.violations.map(({ id }) => id)).toEqual([]);
});

test('classification summary stays constant while more Safe rows are loaded', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'], includeSafe: true });
  await page.route('**/api/safes?**', (route) => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get('offset') || 0);
    const first = { safe_number: 1, safe_name: 'Finance', safe_url_id: 'Finance', location: null, member_count: 1, account_count: 0, cpm_configured: true, olac_enabled: true, retention_configured: true, manage_safe_principal_count: 0, account_type_counts: {}, internal_name: null, business_unit_id: null, responsible_id: null, classification_status: 'pending', account_type_classification: null, inventory_scope: 'pending', data_quality_status: 'pending', scope_hint: null, business_unit_name: null, responsible_name: null, workflow_status: 'pending', next_action: null };
    const second = { ...first, safe_number: 2, safe_name: 'Treasury', safe_url_id: 'Treasury', classification_status: 'review' };
    const rows = offset === 0 ? [first] : [second];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows, total: 2, classification_counts: { assigned: 0, review: 1, pending: 1 }, limit: 50, offset }) });
  });
  await page.goto('/pam/safes');
  const table = page.getByTestId('safe-table');
  const progress = table.getByRole('region', { name: 'Progreso de clasificación de Safes' });
  await expect(progress).toContainText('2 Safes · 1 cargadas en la tabla');
  await expect(progress.getByRole('img', { name: /En revisión: 1.*Pendientes: 1/ })).toBeVisible();
  await table.getByRole('button', { name: 'Cargar 1 más' }).click();
  await expect(progress).toContainText('2 Safes');
  await expect(progress).not.toContainText('cargadas en la tabla');
  await expect(progress.getByRole('img', { name: /En revisión: 1.*Pendientes: 1/ })).toBeVisible();
});

test('clicking a classification state filters the table and clicking again clears it', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'], includeSafe: true });
  const requested: string[] = [];
  await page.route('**/api/safes?**', (route) => {
    requested.push(new URL(route.request().url()).searchParams.get('classification_status') || '');
    return route.fallback();
  });
  await page.goto('/pam/safes');
  const progress = page.getByTestId('safe-table').getByRole('region', { name: 'Progreso de clasificación de Safes' });
  const pending = progress.getByRole('button', { name: 'Pendientes' });
  await expect(pending).toHaveAttribute('aria-pressed', 'false');
  await pending.click();
  await expect(pending).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => requested.includes('pending')).toBe(true);
  await pending.click();
  await expect(pending).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => requested.at(-1)).toBe('');
});

test('Safe account rows show allowlisted management data and the non-rotation summary (UX-AUD2-009)', async ({ page }) => {
  let managementRequest = '';
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/analytics/account-management') managementRequest = request.url();
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'], includeSafe: true });
  await page.goto('/pam/safes');
  await expect.poll(() => managementRequest ? new URL(managementRequest).searchParams.get('include_internal') : null).toBe('true');

  await page.getByText('Indicadores rápidos', { exact: true }).click();
  const coverage = page.getByRole('region', { name: 'Cobertura de cuentas y plataformas' });
  await expect(coverage.getByText('Gestión automática deshabilitada')).toBeVisible();
  await expect(coverage).toContainText('de 3 cuentas activas');
  await expect(coverage.getByText('Gestión automática activa')).toBeVisible();
  await expect(coverage.getByText('Sin dato de gestión')).toBeVisible();
  await expect(coverage.getByText(/Último cambio de secreto o alta:/)).toBeVisible();
  // The interpretation note lives behind a help hint, not inline on the page.
  await coverage.getByRole('button', { name: 'Ayuda: Interpretación de gestión de cuentas' }).click();
  await expect(coverage.getByRole('note')).toContainText('no equivale a rotación');
  await expect(coverage.getByRole('note')).toContainText('CyberArk no entrega fecha de verificación ni de reconciliación en este tenant.');

  await page.getByRole('button', { name: 'Ver cuentas de Finance', exact: true }).click();
  const rows = page.locator('.account-inline-row:not(.account-inline-header)');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Activada');
  await expect(rows.nth(0)).toContainText('Correcto');
  await expect(rows.nth(0).locator('time')).toHaveAttribute('datetime', '2026-09-29T00:00:00Z');
  await expect(rows.nth(0).locator('time')).toHaveText('29 sept 2026, 12:00 a. m.');
  await expect(rows.nth(0).locator('time')).toHaveAttribute('title', /^hace /);
  await expect(page.locator('html')).toHaveAttribute('data-theme', test.info().project.name.includes('light') ? 'light' : 'dark');
  await expect(rows.nth(1)).toContainText('Deshabilitada');
  await expect(rows.nth(1)).toContainText('Falló');
  await expect(rows.nth(2)).toContainText('Sin dato');
  await expect(rows.nth(2)).toContainText('Sin estado');
});

test('account management summary failure does not hide platform coverage or show invented zeros', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'], includeSafe: true, accountManagementUnavailable: true });
  await page.goto('/pam/safes');

  await page.getByText('Indicadores rápidos', { exact: true }).click();
  const coverage = page.getByRole('region', { name: 'Cobertura de cuentas y plataformas' });
  await expect(coverage.getByText('Cuentas activas')).toBeVisible();
  await expect(coverage.getByText('Con plataforma')).toBeVisible();
  await expect(coverage.getByText('No se pudo cargar el resumen de gestión')).toBeVisible();
  await expect(coverage.getByText('Gestión automática deshabilitada')).toHaveCount(0);
  await coverage.getByRole('button', { name: 'Ayuda: Cobertura de cuentas y plataformas' }).click();
  await expect(coverage.getByRole('note')).toContainText('evidencia de rotación');
});

test('dashboard chart categories open the Safe inventory with the selected filter', async ({ page }) => {
  let safesRequestUrl = '';
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/safes') safesRequestUrl = request.url();
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'], includeSafe: true });
  await page.goto('/pam');

  const panel = page.getByRole('region', { name: 'Mi panel de métricas' });
  await expect(panel.getByRole('button', { name: 'Retirada', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Retirada', exact: true }).click();

  await expect(page).toHaveURL(/\/pam\/safes$/);
  await expect.poll(() => safesRequestUrl ? new URL(safesRequestUrl).searchParams.get('workflow_status') : null).toBe('retired');
  await page.getByRole('button', { name: 'Filtrar por estado' }).click();
  await expect(page.getByRole('option', { name: 'Retirada (1)', exact: true })).toBeVisible();

  await page.goto('/pam');
  safesRequestUrl = '';
  await page.getByRole('region', { name: 'Mi panel de métricas' }).getByRole('button', { name: 'Ueno', exact: true }).first().click();
  await expect.poll(() => safesRequestUrl ? new URL(safesRequestUrl).searchParams.get('business_unit') : null).toBe('3');
});

test('Safe filters share state across toolbar, column filters and removable chips without writing', async ({ page }) => {
  const safeRequests: string[] = [];
  const writes: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/safes') safeRequests.push(request.url());
    // Opening a workspace already records it under "recientes"; that preference write
    // predates this feature. The invariant under test is that filtering never writes inventory.
    if (url.pathname.startsWith('/api/') && url.pathname !== '/api/workspaces/preferences' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) {
      writes.push(`${request.method()} ${url.pathname}`);
    }
  });
  await mockAuthenticatedApp(page, {
    permissions: ['inventory:read', 'inventory:write', 'catalogs:write', 'access:manage'],
    includeSafe: true,
    onRequest: (pathname) => { if (pathname === '/api/safes') safeRequests.push(pathname); },
  });
  await page.goto('/pam/safes');
  await expect(page.locator('.safe-name').filter({ hasText: 'Finance' })).toBeVisible();

  await page.getByRole('button', { name: 'Unidad de Finance' }).click();
  await page.getByRole('option', { name: 'FIN', exact: true }).click();
  const pendingRow = page.locator('.safe-table tbody tr.has-pending-changes');
  await expect(pendingRow.getByRole('button', { name: 'Guardar asignación de Finance' })).toBeVisible();

  const moreFilters = page.locator('.safe-filter-details');
  await expect(moreFilters.locator('summary')).toContainText('(0)');
  await page.getByRole('button', { name: 'Filtrar por estado' }).click();
  await page.getByRole('option', { name: 'Retirada (1)', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Filtros activos' })).toContainText('Estado: Retirada');
  await expect(moreFilters.locator('summary')).toContainText('(0)');

  await moreFilters.locator('summary').click();
  await page.getByRole('button', { name: 'Filtrar por clasificación' }).click();
  await page.getByRole('option', { name: 'Asignada', exact: true }).click();
  await expect(moreFilters.locator('summary')).toContainText('(1)');
  await moreFilters.locator('summary').click();
  const chips = page.getByRole('list', { name: 'Filtros activos' });
  await expect(chips).toContainText('Clasificación: Asignada');
  await expect(chips).toContainText('Estado: Retirada');

  await chips.getByRole('button', { name: 'Quitar filtro Estado' }).click();
  await expect(chips).not.toContainText('Estado: Retirada');
  await expect(chips).toContainText('Clasificación: Asignada');
  await expect(moreFilters.locator('summary')).toContainText('(1)');

  await page.getByRole('button', { name: 'Filtrar por estado' }).click();
  await page.getByRole('option', { name: 'Pendiente (1)', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Filtrar por estado' })).toContainText('Pendiente');
  await expect(chips).toContainText('Estado: Pendiente');
  await page.getByRole('button', { name: 'Filtrar por acción siguiente' }).click();
  await page.getByRole('option', { name: 'Sin definir (1)', exact: true }).click();
  await expect(chips).toContainText('Acción siguiente: Sin definir');
  await expect(moreFilters.locator('summary')).toContainText('(1)');
  await chips.getByRole('button', { name: 'Quitar filtro Acción siguiente' }).click();
  await expect(chips).not.toContainText('Acción siguiente: Sin definir');
  await expect(chips).toContainText('Estado: Pendiente');
  await expect(chips).toContainText('Clasificación: Asignada');
  await expect.poll(() => safeRequests.some((request) => {
    if (!request.startsWith('http')) return false;
    const params = new URL(request).searchParams;
    return params.get('workflow_status') === 'pending' && params.get('classification_status') === 'assigned';
  })).toBe(true);
  expect(writes).toEqual([]);
});

test('Safe export keeps the active toolbar filters in its request', async ({ page }) => {
  let exportUrl: URL | null = null;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/safes/export.csv') exportUrl = url;
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'inventory:export'], includeSafe: true });
  await page.goto('/pam/safes');

  await page.getByRole('button', { name: 'Filtrar por estado' }).click();
  await page.getByRole('option', { name: 'Retirada (1)', exact: true }).click();
  await page.locator('.safe-filter-details summary').click();
  await page.getByRole('button', { name: 'Filtrar por clasificación' }).click();
  await page.getByRole('option', { name: 'Asignada', exact: true }).click();
  await page.getByRole('button', { name: 'Exportar CSV' }).click();

  await expect.poll(() => exportUrl?.searchParams.get('workflow_status') || null).toBe('retired');
  expect(exportUrl?.searchParams.get('classification_status')).toBe('assigned');
});

test('Safe filters and grouped inventory remain accessible and within desktop viewports in dark and light themes', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'], includeSafe: true });
  await page.goto('/pam/safes');
  const filters = page.locator('.safe-table-filters');
  await expect(filters.getByRole('group', { name: 'Búsqueda del inventario' })).toBeVisible();
  await expect(filters.getByRole('group', { name: 'Filtros principales' })).toBeVisible();
  await expect(filters.getByRole('searchbox', { name: 'Buscar Safes por nombre o Safe URL ID' })).toBeVisible();
  await expect(filters.getByRole('button', { name: 'Exportar CSV' })).toHaveCount(0);
  const safeRow = page.getByTestId('safe-table').locator('tbody tr').filter({ has: page.locator('.safe-name') }).first();
  await expect(safeRow.locator('.safe-name')).toHaveText('Finance');
  await expect(safeRow.locator('.safe-id')).toHaveText('#1 / Finance');
  const identityGeometry = await safeRow.evaluate((row) => {
    const name = row.querySelector('.safe-name')!.getBoundingClientRect();
    const identifier = row.querySelector('.safe-id')!.getBoundingClientRect();
    const accounts = row.querySelector('.account-expand')!.getBoundingClientRect();
    return { nameTop: name.top, identifierTop: identifier.top, accountsTop: accounts.top };
  });
  expect(identityGeometry.nameTop).toBeLessThan(identityGeometry.identifierTop);
  expect(identityGeometry.identifierTop).toBeLessThan(identityGeometry.accountsTop);
  await expect(safeRow.locator('td.number').first()).toHaveCSS('text-align', 'right');
  const groupRow = page.locator('.safe-table thead .safe-column-group-row');
  await expect(groupRow.getByRole('columnheader', { name: 'Datos de CyberArk' })).toBeVisible();
  await expect(groupRow.getByRole('columnheader', { name: 'Clasificación operativa (local)' })).toBeVisible();
  await expect(groupRow.locator('th[scope="colgroup"]')).toHaveCount(2);
  await expect(page.locator('.safe-table thead tr')).toHaveCount(2);

  const headerGeometry = await page.evaluate(() => {
    const group = document.querySelector('.safe-column-group-row th')!.getBoundingClientRect();
    const column = document.querySelector('.safe-column-header-row th')!.getBoundingClientRect();
    return { groupBottom: Math.round(group.bottom), columnTop: Math.round(column.top) };
  });
  expect(headerGeometry.columnTop).toBeGreaterThanOrEqual(headerGeometry.groupBottom - 1);

  for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    for (const theme of ['dark', 'light']) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      const documentWidth = await page.evaluate(() => ({
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      expect(documentWidth.scroll).toBeLessThanOrEqual(documentWidth.client);
      const axe = await new AxeBuilder({ page })
        .include('.safe-table-filters')
        .include('.safe-table')
        .analyze();
      expect(axe.violations).toEqual([]);
    }
  }
});

test('Safe filters can be cleared in one action while the extra-filters panel is closed', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'], includeSafe: true });
  await page.goto('/pam/safes');
  await page.getByRole('button', { name: 'Filtrar por estado' }).click();
  await page.getByRole('option', { name: 'Retirada (1)', exact: true }).click();
  const chips = page.getByRole('list', { name: 'Filtros activos' });
  await expect(chips).toContainText('Estado: Retirada');
  await expect(page.locator('.safe-filter-details')).not.toHaveAttribute('open', '');

  await page.getByRole('button', { name: 'Limpiar filtros' }).click();
  await expect(chips).toHaveCount(0);
});

test('both Safe header rows stay pinned, one directly below the other, while the table scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'], includeSafe: true });
  await page.goto('/pam/safes');
  await expect(page.locator('.safe-table tbody tr').first()).toBeVisible();

  // The mock returns a single Safe, so clone its row to create real vertical overflow.
  await page.evaluate(() => {
    const body = document.querySelector('.safe-table tbody')!;
    const row = body.querySelector('tr')!;
    for (let index = 0; index < 60; index += 1) body.append(row.cloneNode(true));
  });
  const wrap = page.locator('.database-surface .table-wrap');
  expect(await wrap.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

  await wrap.evaluate((element) => { element.scrollTop = 600; });
  const geometry = await page.evaluate(() => {
    const container = document.querySelector('.database-surface .table-wrap')!.getBoundingClientRect();
    const group = document.querySelector('.safe-column-group-row th')!.getBoundingClientRect();
    const column = document.querySelector('.safe-column-header-row th')!.getBoundingClientRect();
    return { containerTop: container.top, groupTop: group.top, groupBottom: group.bottom, columnTop: column.top, columnBottom: column.bottom };
  });
  expect(Math.abs(geometry.groupTop - geometry.containerTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.columnTop - geometry.groupBottom)).toBeLessThanOrEqual(1.5);
  expect(geometry.columnBottom).toBeGreaterThan(geometry.columnTop);
});

test('safe drawer shows a reviewable draft before saving classification (UX-AUD2-024)', async ({ page }) => {
  let updateMethod = '';
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/safes/1/metadata') updateMethod = request.method();
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'inventory:write', 'catalogs:write', 'access:manage'], includeSafe: true });
  await page.goto('/pam/safes');

  await expect(page.getByRole('heading', { name: 'Safes', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', test.info().project.name.includes('light') ? 'light' : 'dark');
  const tableUnitColor = await page.getByRole('button', { name: 'Unidad de Finance' }).evaluate(node => getComputedStyle(node).color);
  await page.getByRole('button', { name: 'Glosario de Estado operativo (Safe)', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Glosario de Estado operativo (Safe)' })).toContainText('cuando una sync completa retira sus cuentas');
  await page.keyboard.press('Escape');
  await page.locator('.safe-name').filter({ hasText: 'Finance' }).click();
  const drawer = page.getByRole('dialog', { name: 'Finance' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: 'Clasificar' }).click();
  const workflow = drawer.getByRole('button', { name: 'Estado operativo' });
  await expect(workflow).toHaveText('Pendiente');
  await workflow.click();
  await expect(page.getByRole('listbox', { name: 'Estado operativo' }).getByRole('option')).toHaveText(['Pendiente', 'En curso', 'Baja retenida', 'Resuelto']);
  await page.keyboard.press('Escape');
  await expect(drawer.getByText('Más datos de clasificación')).toBeVisible();
  await expect(drawer.getByRole('region', { name: 'Resumen de cambios pendientes' })).toContainText('No hay cambios pendientes.');
  await expect(drawer.getByRole('button', { name: 'Guardar clasificación' })).toBeDisabled();

  const unit = drawer.getByRole('button', { name: 'Unidad de negocio' });
  const neutralUnitColor = await unit.evaluate(node => getComputedStyle(node).color);
  expect(neutralUnitColor).toBe(tableUnitColor);
  await unit.click();
  const selectedUnit = page.getByRole('option', { name: 'Sin asignar', exact: true });
  const financeUnit = page.getByRole('option', { name: 'FIN - Finanzas' });
  await financeUnit.hover();
  const [selectedBackground, hoverBackground] = await Promise.all([
    selectedUnit.evaluate((element) => getComputedStyle(element).backgroundColor),
    financeUnit.evaluate((element) => getComputedStyle(element).backgroundColor),
  ]);
  expect(hoverBackground).not.toBe(selectedBackground);
  await financeUnit.click();
  expect(await unit.evaluate(node => getComputedStyle(node).color)).not.toBe(neutralUnitColor);
  const changes = drawer.getByRole('region', { name: 'Resumen de cambios pendientes' });
  await expect(changes).toContainText('1');
  await expect(changes).toContainText('Sin asignar');
  await expect(changes).toContainText('FIN');
  await drawer.getByRole('button', { name: 'Guardar clasificación' }).click();
  await expect.poll(() => updateMethod).toBe('PATCH');
  await expect(drawer.getByRole('status')).toContainText('Guardado correctamente');
});

test('safe drawer switches between classification and history tabs', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'inventory:write', 'catalogs:write'], includeSafe: true });
  await page.goto('/pam/safes');

  await page.locator('.safe-name').filter({ hasText: 'Finance' }).click();
  const drawer = page.getByRole('dialog', { name: 'Finance' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('heading', { name: 'Saltos a otros módulos' })).toBeVisible();

  await drawer.getByRole('button', { name: 'Historial' }).click();
  await expect(drawer.getByRole('heading', { name: 'Historial de cambios' })).toBeVisible();
  await expect(drawer.getByText('Sin cambios manuales registrados.', { exact: true })).toBeVisible();

  await drawer.getByRole('button', { name: 'Clasificar' }).click();
  await expect(drawer.getByRole('heading', { name: 'Seguimiento del Safe' })).toBeVisible();
});

test('drawer catalog actions move into an accessible overflow menu when constrained', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'inventory:write', 'catalogs:write', 'access:manage'], includeSafe: true });
  await page.goto('/pam/safes');

  await page.locator('.safe-name').filter({ hasText: 'Finance' }).click();
  const drawer = page.getByRole('dialog', { name: 'Finance' });
  await drawer.getByRole('button', { name: 'Clasificar' }).click();
  const actions = drawer.getByLabel('Acciones de catálogos');
  await actions.evaluate((element) => { (element as HTMLElement).style.width = '34px'; });

  const trigger = actions.getByRole('button', { name: 'Más acciones: Acciones de catálogos' });
  await expect(trigger).toBeVisible();
  await trigger.press('ArrowDown');
  const menu = page.getByRole('menu', { name: 'Acciones de catálogos' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('account search opt-in reaches Safe list, filters expanded accounts, and is retained in Safe export', async ({ page }) => {
  const safeRequests: URL[] = [];
  let exportRequest: URL | null = null;
  let accountRequest: URL | null = null;
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'inventory:export'], includeSafe: true });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/safes') safeRequests.push(url);
    if (url.pathname === '/api/safes/export.csv') exportRequest = url;
    if (url.pathname === '/api/safes/1/accounts') accountRequest = url;
  });
  await page.route('**/api/safes/1/accounts**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('q') === 'no-account-match') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ rows: [], total: 0, limit: 200, offset: 0 }) });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ rows: [{ safe_number: 1, safe_name: 'Finance', account_id: 'matching', account_name: 'needle-account', user_name: 'dbadmin', address: '10.0.0.1', platform_id: 'platform-1', platform_name: 'PostgreSQL', lifecycle_status: 'active', last_seen_at: '2026-09-29T00:00:00Z', attributes: {} }], total: 1, limit: 200, offset: 0 }),
    });
  });
  await page.goto('/pam/safes');
  await expect(page.getByRole('checkbox', { name: 'Incluir cuentas' })).not.toBeChecked();
  await expect.poll(() => safeRequests.length > 0 ? safeRequests.at(-1)?.searchParams.has('include_accounts') : null).toBe(false);

  const includeAccounts = page.getByRole('checkbox', { name: 'Incluir cuentas' });
  await includeAccounts.focus();
  await page.keyboard.press('Space');
  await expect(includeAccounts).toBeChecked();
  await page.getByRole('searchbox', { name: 'Buscar Safes por nombre o Safe URL ID' }).fill('needle-account');
  await expect.poll(() => safeRequests.some((url) => url.searchParams.get('include_accounts') === 'true' && url.searchParams.get('q') === 'needle-account')).toBe(true);
  await expect(page.getByRole('list', { name: 'Filtros activos' })).toContainText('Incluir cuentas: Sí');

  await page.getByRole('button', { name: 'Ver cuentas de Finance', exact: true }).click();
  const match = page.locator('.account-inline-row-match');
  await expect(match).toContainText('needle-account');
  await expect.poll(() => accountRequest?.searchParams.get('q') || null).toBe('needle-account');

  await page.getByRole('button', { name: 'Exportar CSV' }).click();
  await expect.poll(() => exportRequest?.searchParams.get('include_accounts') || null).toBe('true');
  expect(exportRequest?.searchParams.get('q')).toBe('needle-account');

  const filters = page.getByRole('list', { name: 'Filtros activos' });
  await filters.getByRole('button', { name: 'Quitar filtro Incluir cuentas' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('checkbox', { name: 'Incluir cuentas' })).not.toBeChecked();
  await expect.poll(() => safeRequests.at(-1)?.searchParams.has('include_accounts') ?? null).toBe(false);
  await expect(filters).toHaveCount(0);

  await includeAccounts.check();
  await page.getByRole('searchbox', { name: 'Buscar Safes por nombre o Safe URL ID' }).fill('no-account-match');
  await expect.poll(() => accountRequest?.searchParams.get('q') || null).toBe('no-account-match');
  await expect(page.getByText('Sin cuentas que coincidan', { exact: true })).toBeVisible();

  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    const axe = await new AxeBuilder({ page }).include('.safe-table-filters').include('.safe-table').analyze();
    expect(axe.violations).toEqual([]);
  }
});

test('account expansion announces loading, empty and error states without fixed waits', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'], includeSafe: true });
  let releaseAccounts!: () => void;
  const accountGate = new Promise<void>((resolve) => { releaseAccounts = resolve; });
  await page.route('**/api/safes/1/accounts**', async (route) => {
    await accountGate;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ rows: [], total: 0, limit: 200, offset: 0 }) });
  });
  await page.goto('/pam/safes');
  await page.getByRole('button', { name: 'Ver cuentas de Finance', exact: true }).click();
  await expect(page.getByText('Cargando cuentas...', { exact: true })).toBeVisible();
  releaseAccounts();
  await expect(page.getByText('Sin cuentas activas registradas', { exact: true })).toBeVisible();

  await page.unroute('**/api/safes/1/accounts**');
  await page.route('**/api/safes/1/accounts**', async (route) => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Unavailable' }) });
  });
  await page.getByRole('checkbox', { name: 'Incluir cuentas' }).check();
  await page.getByRole('searchbox', { name: 'Buscar Safes por nombre o Safe URL ID' }).fill('error-query');
  await expect(page.getByText('No se pudieron cargar las cuentas', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible();
});

test('Safes marked for decommission have a dedicated indicator', async ({ page }) => {
  await mockAuthenticatedApp(page, { includeSafe: true, decommissionCandidate: true });
  await page.goto('/pam/safes');

  await expect(page.getByLabel('Marcado para dar de baja')).toBeVisible();
  await page.getByRole('button', { name: 'Accion siguiente de Finance' }).click();
  await expect(page.getByRole('option', { name: 'Revisar', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Dar de baja', exact: true })).toBeVisible();
});

test('Safes offers internal navigation to platforms without leaving the subnav visible on unrelated workspaces', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/safes');

  const subnav = page.getByRole('tablist', { name: 'Safes y plataformas' });
  await expect(subnav.getByRole('tab', { name: 'Safes Inventario y clasificación' })).toHaveAttribute('aria-selected', 'true');
  await expect(subnav.getByRole('tab', { name: /Plataformas y cuentas/ })).toBeVisible();

  // UX-AUD-013(c): the subnav is the canonical path for the technical
  // catalogs; their standalone deep-link routes still work, but they are no
  // longer duplicated as switcher destinations.
  await subnav.getByRole('tab', { name: /Plataformas y cuentas/ }).click();
  await expect(page).toHaveURL(/\/pam\/platforms$/);
  await expect(page.getByRole('heading', { name: 'Plataformas', exact: true })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Safes y plataformas' }).getByRole('tab', { name: /Plataformas y cuentas/ })).toHaveAttribute('aria-selected', 'true');

  await page.goto('/pam/connectors');
  await expect(page.getByRole('tablist', { name: 'Secciones de Servicio' }).getByRole('tab', { name: 'Conectores' })).toHaveAttribute('aria-selected', 'true');

  // The switcher no longer duplicates those destinations.
  await page.getByRole('button', { name: /Cambiar workspace/ }).click();
  const menu = page.getByRole('region', { name: 'Workspaces' });
  await expect(menu.locator('[data-section="tool-workspaces"]').getByRole('link', { name: /Plataformas Safes y cuentas por plataforma/ })).toHaveCount(0);
  await expect(menu.locator('[data-section="tool-workspaces"]').getByRole('link', { name: /Conectores PSM y SIA/ })).toHaveCount(0);
  await expect(menu.locator('[data-section="tool-workspaces"]').getByRole('link', { name: /Salud PAM/ })).toHaveCount(0);

  // General/Posture (unrelated workspaces) never show this subnav.
  await page.goto('/pam');
  await expect(page.getByRole('tablist', { name: 'Safes y plataformas' })).toHaveCount(0);
});

test('an actor with only pam:catalogs_read still sees the Safes subnav reach the technical catalogs', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'pam:catalogs_read'] });
  await page.goto('/pam/safes');

  const subnav = page.getByRole('tablist', { name: 'Safes y plataformas' });
  await expect(subnav.getByRole('tab', { name: /Plataformas y cuentas/ })).toBeVisible();
});

test('an actor without pam:catalogs_read or access:manage never sees the technical-catalog tabs', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'] });
  await page.goto('/pam/safes');

  const subnav = page.getByRole('tablist', { name: 'Safes y plataformas' });
  await expect(subnav.getByRole('tab', { name: /Plataformas y cuentas/ })).toHaveCount(0);
});

test('Safes and Servicio tabs pass the axe check', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/safes');
  const topResults = await new AxeBuilder({ page }).include('.pam-infra-subnav > .workspace-subnav').analyze();
  expect(topResults.violations).toEqual([]);

  await page.goto('/pam/connectors');
  const nestedResults = await new AxeBuilder({ page }).include('.workspace-subnav-nested').analyze();
  expect(nestedResults.violations).toEqual([]);
});

test('Retiradas lists Safes absent after a complete sync as read-only', async ({ page }) => {
  const retiredMethods: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/lifecycle/retired') retiredMethods.push(request.method());
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'], includeSafe: true });
  await page.route('**/api/lifecycle/retired**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      rows: [
        { safe_number: 11, safe_name: 'Vieja-Prod', safe_url_id: 'Vieja-Prod', retired_at: '2026-09-20T12:00:00Z', retired_member_count: 4 },
        { safe_number: 12, safe_name: 'Sin-URL', safe_url_id: null, retired_at: null, retired_member_count: 0 },
      ],
      total: 2,
      deletion_enabled: false,
    }),
  }));
  await page.goto('/pam/safes');

  await expect(page.getByRole('tab', { name: 'Vigentes' })).toHaveAttribute('aria-selected', 'true');
  // Keyboard activation moves focus and selection from Vigentes to Retiradas.
  await page.getByRole('tab', { name: 'Vigentes' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Retiradas' })).toHaveAttribute('aria-selected', 'true');

  const panel = page.getByRole('region', { name: 'Safes retiradas' });
  await expect(panel).toBeVisible();
  const rows = panel.locator('.retired-safes-table tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Vieja-Prod');
  await expect(rows.nth(0).locator('td').nth(2)).toHaveText('4');
  await expect(rows.nth(0).locator('td').nth(1)).not.toHaveText('Sin dato');
  // null safe_url_id and null retired_at must render without breaking the row.
  await expect(rows.nth(1)).toContainText('Sin-URL');
  await expect(rows.nth(1).locator('td').nth(1)).toHaveText('Sin dato');
  await page.getByRole('button', { name: 'Ayuda: Inventario de Safes' }).click();
  await expect(page.getByRole('note')).toContainText('no borra registros ni ejecuta una baja en CyberArk');
  await expect(page.getByRole('note')).toContainText('No entra en KPIs ni en el alcance de negocio');
  await page.keyboard.press('Escape');
  // The read-only list has no delete/retire action.
  await expect(panel.getByRole('button', { name: /borrar|eliminar|dar de baja/i })).toHaveCount(0);
  expect(retiredMethods.length).toBeGreaterThan(0);
  expect(retiredMethods.every((method) => method === 'GET')).toBe(true);

  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    const axe = await new AxeBuilder({ page }).include('.retired-safes-panel').analyze();
    expect(axe.violations).toEqual([]);
  }
});

test('Retiradas shows a loading state then an empty state without touching the active inventory', async ({ page }) => {
  // Deterministic loading assertion: hold the list response behind a gate and
  // release it only after the test has observed the loading state.
  let releaseEmpty: () => void = () => {};
  const emptyGate = new Promise<void>((resolve) => { releaseEmpty = resolve; });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'], includeSafe: true });
  await page.route('**/api/lifecycle/retired**', async (route) => {
    const limit = new URL(route.request().url()).searchParams.get('limit');
    if (limit !== '50') {
      // The dashboard's retired-count request must not block page render.
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [], total: 0, deletion_enabled: false }) });
      return;
    }
    await emptyGate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [], total: 0, deletion_enabled: false }) });
  });
  await page.goto('/pam/safes');
  await expect(page.locator('.safe-name').filter({ hasText: 'Finance' })).toBeVisible();

  await page.getByRole('tab', { name: 'Retiradas' }).click();
  await expect(page.getByText('Cargando Safes retiradas…')).toBeVisible();
  releaseEmpty();
  await expect(page.getByText('No hay Safes retiradas')).toBeVisible();
});

test('Retiradas surfaces an error and retries on demand', async ({ page }) => {
  let listAttempts = 0;
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'], includeSafe: true });
  await page.route('**/api/lifecycle/retired**', (route) => {
    const limit = new URL(route.request().url()).searchParams.get('limit');
    if (limit !== '50') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [], total: 0, deletion_enabled: false }) });
    }
    listAttempts += 1;
    if (listAttempts === 1) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Retiradas temporalmente no disponible' }) });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows: [{ safe_number: 21, safe_name: 'Recuperada', safe_url_id: 'Recuperada', retired_at: '2026-09-22T12:00:00Z', retired_member_count: 1 }], total: 1, deletion_enabled: false }),
    });
  });
  await page.goto('/pam/safes');
  await page.getByRole('tab', { name: 'Retiradas' }).click();

  await expect(page.getByText('No se pudieron cargar las Safes retiradas')).toBeVisible();
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.locator('.retired-safes-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.retired-safes-table')).toContainText('Recuperada');
});

test('Retiradas stays read-only and returning to Vigentes keeps the active filters', async ({ page }) => {
  const retiredMethods: string[] = [];
  let safesRequests = 0;
  let filteredRequested = false;
  let exportRequested = false;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/lifecycle/retired') retiredMethods.push(request.method());
    if (url.pathname === '/api/safes') {
      safesRequests += 1;
      if (url.searchParams.get('workflow_status') === 'retired') filteredRequested = true;
    }
    if (url.pathname === '/api/safes/export.csv') exportRequested = true;
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'inventory:export'], includeSafe: true });
  await page.route('**/api/lifecycle/retired**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ rows: [{ safe_number: 31, safe_name: 'Vieja-Fin', safe_url_id: 'Vieja-Fin', retired_at: '2026-09-23T12:00:00Z', retired_member_count: 2 }], total: 1, deletion_enabled: false }),
  }));
  await page.goto('/pam/safes');
  await expect(page.locator('.safe-name').filter({ hasText: 'Finance' })).toBeVisible();

  await page.getByRole('button', { name: 'Filtrar por estado' }).click();
  await page.getByRole('option', { name: 'Retirada (1)', exact: true }).click();
  const chips = page.getByRole('list', { name: 'Filtros activos' });
  await expect(chips).toContainText('Estado: Retirada');
  await expect.poll(() => filteredRequested).toBe(true);

  const safesBefore = safesRequests;
  await page.getByRole('tab', { name: 'Retiradas' }).click();
  await expect(page.locator('.retired-safes-panel')).toBeVisible();
  await page.getByRole('tab', { name: 'Vigentes' }).click();

  await expect(chips).toContainText('Estado: Retirada');
  expect(safesRequests).toBe(safesBefore);
  expect(exportRequested).toBe(false);
  expect(retiredMethods.length).toBeGreaterThan(0);
  expect(retiredMethods.every((method) => method === 'GET')).toBe(true);
});

test('switching to Retiradas closes the open active Safe drawer and keeps the inventory filters', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'inventory:write', 'catalogs:write', 'access:manage'], includeSafe: true });
  await page.route('**/api/lifecycle/retired**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ rows: [{ safe_number: 41, safe_name: 'Vieja-Drawer', safe_url_id: 'Vieja-Drawer', retired_at: '2026-09-24T12:00:00Z', retired_member_count: 3 }], total: 1, deletion_enabled: false }),
  }));
  await page.goto('/pam/safes');
  await expect(page.locator('.safe-name').filter({ hasText: 'Finance' })).toBeVisible();

  // Apply a filter so the round-trip can prove it is left untouched.
  await page.getByRole('button', { name: 'Filtrar por estado' }).click();
  await page.getByRole('option', { name: 'Retirada (1)', exact: true }).click();
  const chips = page.getByRole('list', { name: 'Filtros activos' });
  await expect(chips).toContainText('Estado: Retirada');

  // Open the active Safe detail drawer.
  await page.locator('.safe-name').filter({ hasText: 'Finance' }).click();
  const drawer = page.getByRole('dialog', { name: 'Finance' });
  await expect(drawer).toBeVisible();

  // The open drawer makes the page behind it inert, so the scope control is
  // exercised through its own click handler instead of a blocked pointer hit.
  await page.getByRole('tab', { name: 'Retiradas' }).dispatchEvent('click');
  await expect(page.getByRole('dialog', { name: 'Finance' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Safes retiradas' })).toBeVisible();
  await expect(page.locator('.retired-safes-table tbody tr')).toHaveCount(1);

  // Back to Vigentes: the table and its active filter are intact.
  await page.getByRole('tab', { name: 'Vigentes' }).click();
  await expect(page.locator('.safe-table')).toBeVisible();
  await expect(chips).toContainText('Estado: Retirada');
  await expect(page.locator('.safe-name').filter({ hasText: 'Finance' })).toBeVisible();
});

test('safe inventory fits common desktop widths without horizontal scroll and filters each field once', async ({ page }) => {
  for (const width of [1100, 1280, 1366, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await mockAuthenticatedApp(page, { permissions: ['inventory:read'], includeSafe: true });
    await page.goto('/pam/safes');
    const tableWrap = page.locator('.database-surface .table-wrap');
    await expect(tableWrap).toBeVisible();
    const { clientWidth, scrollWidth } = await tableWrap.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
    expect(scrollWidth, `table overflows its wrapper at ${width}px`).toBeLessThanOrEqual(clientWidth + 1);
  }
  await expect(page.getByRole('button', { name: /^Filtrar columna/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Filtrar por acción siguiente' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Filtrar por tipo de cuenta' })).toBeVisible();
  await page.screenshot({ path: '/tmp/claude-1000/-home-ubuntu-Custodia/27c4ffc5-d05b-48f8-9b27-9c0b36277689/scratchpad/safes-1440.png' });
});

test('a row select that has to open upwards on a short window keeps a usable, selectable menu', async ({ page }) => {
  await page.setViewportSize({ width: 1428, height: 560 });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'inventory:write'], includeSafe: true });
  await page.goto('/pam/safes');
  const trigger = page.getByRole('button', { name: 'Accion siguiente de Finance' });
  await trigger.click();
  const menu = page.locator('.compact-select-menu').first();
  await expect(page.getByRole('option', { name: 'Revisar' })).toBeVisible();
  // Regression: legacy `top` + React Aria's inline `bottom` collapsed the flipped menu to ~18px.
  expect((await menu.boundingBox())?.height ?? 0).toBeGreaterThan(150);
  await page.getByRole('option', { name: 'Revisar' }).click();
  await expect(menu).toHaveCount(0);
});

test('a Safe held by CyberArk retention shows its retired accounts in the row and when expanded (UX-AUD2-009)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'], includeSafe: true });
  let retiredRequest = '';
  await page.route('**/api/safes?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [{ safe_number: 442, safe_name: 'EB_X', safe_url_id: 'EB_X', location: null, member_count: 4, account_count: 0, cpm_configured: true, olac_enabled: true, retention_configured: true, number_of_days_retention: 7, retired_account_count: 1, last_account_retired_at: '2026-10-06T15:26:29Z', manage_safe_principal_count: 0, account_type_counts: {}, internal_name: null, business_unit_id: null, responsible_id: null, classification_status: 'assigned', account_type_classification: 'nominal', inventory_scope: 'pending', data_quality_status: 'pending', scope_hint: null, business_unit_name: null, responsible_name: null, workflow_status: 'in_progress', next_action: 'Dar de baja' }], total: 1, limit: 50, offset: 0 }) }));
  await page.route('**/api/safes/442/accounts?**', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('lifecycle') === 'retired') retiredRequest = url.search;
    const rows = url.searchParams.get('lifecycle') === 'retired'
      ? [{ safe_number: 442, safe_name: 'EB_X', account_id: 'r1', account_name: 'old-account', user_name: 'svc', address: null, platform_id: 'P1', platform_name: null, lifecycle_status: 'retired', last_seen_at: '2026-10-06T14:25:00Z', retired_detected_at: '2026-10-06T15:26:29Z', attributes: {} }]
      : [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows, total: rows.length, limit: 200, offset: 0 }) });
  });
  await page.goto('/pam/safes');
  const row = page.locator('.safe-table tbody tr').first();
  await expect(row).toContainText('Retención: 7 días');
  await expect(row).toContainText('1 cuenta retirada');
  await expect(row.locator('.safe-retention').filter({hasText:'1 cuenta retirada'})).toHaveAttribute('title', /hace /);
  await row.getByRole('button', { name: /Ver cuentas/ }).click();
  const section = page.getByRole('region', { name: 'Cuentas retiradas de la Safe' });
  await expect(section).toContainText('old-account');
  await expect(page.locator('html')).toHaveAttribute('data-theme', test.info().project.name.includes('light') ? 'light' : 'dark');
  await expect(section.locator('time[datetime="2026-10-06T15:26:29Z"]')).toHaveAttribute("title", /^hace /);
  expect(retiredRequest).toContain('lifecycle=retired');
});

test('the Safe table needs no side scrolling even with long names, retention text and expanded accounts', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'inventory:write', 'inventory:export'], includeSafe: true });
  await page.route('**/api/safes?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [{ safe_number: 442, safe_name: 'EB_OCI_DEV_COMPUTE_FORMS001_WITH_A_VERY_LONG_NAME_THAT_KEEPS_GOING', safe_url_id: 'EB_OCI_DEV_COMPUTE_FORMS001_WITH_A_VERY_LONG_NAME_THAT_KEEPS_GOING', location: null, member_count: 4, account_count: 2, cpm_configured: true, olac_enabled: true, retention_configured: true, number_of_days_retention: 7, retired_account_count: 1, last_account_retired_at: '2026-10-06T15:26:29Z', manage_safe_principal_count: 0, account_type_counts: {}, internal_name: null, business_unit_id: null, responsible_id: null, classification_status: 'assigned', account_type_classification: 'nominal', inventory_scope: 'pending', data_quality_status: 'pending', scope_hint: null, business_unit_name: null, responsible_name: null, workflow_status: 'retention_hold', next_action: 'Dar de baja' }], total: 1, limit: 50, offset: 0 }) }));
  await page.route('**/api/safes/442/accounts?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [{ safe_number: 442, safe_name: 'X', account_id: 'a1', account_name: 'Operating System-Some-Very-Long-Account-Name', user_name: 'svc_long_user_name', address: '10.100.100.100', platform_id: 'WinDomain', platform_name: 'Windows Domain Platform', lifecycle_status: 'active', last_seen_at: '2026-10-06T15:00:00Z', attributes: {} }], total: 1, limit: 200, offset: 0 }) }));
  await page.goto('/pam/safes');
  await page.getByRole('button', { name: /Ver cuentas/ }).click();
  const tableWrap = page.locator('.database-surface .table-wrap');
  await expect(page.locator('.account-inline-row').first()).toBeVisible();
  const { clientWidth, scrollWidth } = await tableWrap.evaluate((el) => ({ clientWidth: el.clientWidth, scrollWidth: el.scrollWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  await page.screenshot({ path: '/tmp/claude-1000/-home-ubuntu-Custodia/27c4ffc5-d05b-48f8-9b27-9c0b36277689/scratchpad/noscroll-1100.png' });
});


test('UX-AUD2-009 retired Safes preserve calendar dates, microseconds and explicit missing dates', async ({ page }, testInfo) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'], includeSafe: true });
  await page.route('**/api/lifecycle/retired**', route => route.fulfill({json:{
    total: 4, deletion_enabled: false, rows: [
      {safe_number:41,safe_name:'Calendario',safe_url_id:null,retired_at:'2026-10-07',retired_member_count:0},
      {safe_number:42,safe_name:'Precisión',safe_url_id:'precision',retired_at:'2026-10-02T17:56:07.446661Z',retired_member_count:1},
      {safe_number:43,safe_name:'Sin fecha',safe_url_id:null,retired_at:null,retired_member_count:0},
      {safe_number:44,safe_name:'Fecha inválida',safe_url_id:null,retired_at:'invalid',retired_member_count:0},
    ],
  }}));
  await page.goto('/pam/safes');
  await expect(page.locator('html')).toHaveAttribute('data-theme', testInfo.project.name.includes('light') ? 'light' : 'dark');
  await page.getByRole('tab', {name:/Retiradas/}).click();
  const calendar = page.getByRole('row', {name:/Calendario/});
  await expect(calendar.locator('time')).toHaveAttribute('datetime','2026-10-07');
  await expect(calendar.locator('time')).toHaveText('7 oct 2026');
  const precision = page.getByRole('row', {name:/Precisión/});
  await expect(precision.locator('time')).toHaveAttribute('datetime','2026-10-02T17:56:07.446661Z');
  await expect(precision.locator('time')).toHaveAttribute('title',/^hace /);
  for (const name of ['Sin fecha', 'Fecha inválida']) {
    const row = page.getByRole('row', {name:new RegExp(name)});
    await expect(row).toContainText('Sin dato');
    await expect(row.locator('time')).toHaveCount(0);
  }
});

test('FE-AUD-002: a failed filtered read never keeps the previous rows nor says "Sin resultados"', async ({ page }) => {
  await mockAuthenticatedApp(page, { includeSafe: true });
  let failing = false;
  await page.route('**/api/safes?*', async (route) => {
    if (!failing) return route.fallback();
    return route.fulfill({ status: 503, json: { detail: 'Unavailable' } });
  });
  await page.goto('/pam/safes');
  await expect(page.getByText('Finance', { exact: true }).first()).toBeVisible();
  failing = true;
  await page.getByRole('searchbox', { name: 'Buscar Safes por nombre o Safe URL ID' }).fill('error-filter');
  await expect(page.getByText('No se pudo cargar el inventario de Safes')).toBeVisible();
  await expect(page.getByText('Finance', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Sin resultados', { exact: true })).toHaveCount(0);
  failing = false;
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.getByText('No se pudo cargar el inventario de Safes')).toHaveCount(0);
  await expect(page.getByText('Finance', { exact: true }).first()).toBeVisible();
});
