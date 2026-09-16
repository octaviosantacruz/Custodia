import AxeBuilder from '@axe-core/playwright';
import { expect, mockAuthenticatedApp, test } from './fixtures';

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
  await page.getByRole('button', { name: 'Filtrar columna estado' }).click();
  await expect(page.getByRole('option', { name: 'Retirada (1)', exact: true })).toBeVisible();

  await page.goto('/pam');
  safesRequestUrl = '';
  await page.getByRole('region', { name: 'Mi panel de métricas' }).getByRole('button', { name: 'Ueno', exact: true }).first().click();
  await expect.poll(() => safesRequestUrl ? new URL(safesRequestUrl).searchParams.get('business_unit') : null).toBe('3');
});

test('safe drawer shows a reviewable draft before saving classification', async ({ page }) => {
  let updateMethod = '';
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/safes/1/metadata') updateMethod = request.method();
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'inventory:write', 'catalogs:write', 'access:manage'], includeSafe: true });
  await page.goto('/pam/safes');

  await expect(page.getByRole('heading', { name: 'Safes', exact: true })).toBeVisible();
  await page.locator('.safe-name').filter({ hasText: 'Finance' }).click();
  const drawer = page.getByRole('dialog', { name: 'Finance' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: 'Clasificar' }).click();
  const workflow = drawer.locator('.detail-edit-section select').first();
  await expect(workflow.locator('option')).toHaveText(['Pendiente', 'En curso', 'Resuelto']);
  await expect(drawer.getByText('Más datos de clasificación')).toBeVisible();
  await expect(drawer.getByRole('region', { name: 'Resumen de cambios pendientes' })).toContainText('No hay cambios pendientes.');
  await expect(drawer.getByRole('button', { name: 'Guardar clasificación' })).toBeDisabled();

  await drawer.getByRole('button', { name: 'Unidad de negocio' }).click();
  const selectedUnit = page.getByRole('option', { name: 'Sin asignar', exact: true });
  const financeUnit = page.getByRole('option', { name: 'FIN - Finanzas' });
  await financeUnit.hover();
  const [selectedBackground, hoverBackground] = await Promise.all([
    selectedUnit.evaluate((element) => getComputedStyle(element).backgroundColor),
    financeUnit.evaluate((element) => getComputedStyle(element).backgroundColor),
  ]);
  expect(hoverBackground).not.toBe(selectedBackground);
  await financeUnit.click();
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

test('safe inventory keeps horizontal scroll inside the table wrapper', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'], includeSafe: true });
  await page.goto('/pam/safes');

  const tableWrap = page.locator('.database-surface .table-wrap');
  await expect(tableWrap).toBeVisible();
  const before = await tableWrap.boundingBox();
  const dimensions = await tableWrap.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    scrollLeft: element.scrollLeft,
  }));
  expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);

  await tableWrap.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expect.poll(() => tableWrap.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  const after = await tableWrap.boundingBox();
  expect(Math.abs((after?.x || 0) - (before?.x || 0))).toBeLessThan(2);
  expect(Math.abs((after?.y || 0) - (before?.y || 0))).toBeLessThan(2);
});

test('Safes marked for decommission have a dedicated indicator', async ({ page }) => {
  await mockAuthenticatedApp(page, { includeSafe: true, decommissionCandidate: true });
  await page.goto('/pam/safes');

  await expect(page.getByLabel('Marcado para dar de baja')).toBeVisible();
  await page.getByRole('button', { name: 'Accion siguiente de Finance' }).click();
  await expect(page.getByRole('option', { name: 'Revisar', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Dar de baja', exact: true })).toBeVisible();
});

test('Safes offers internal navigation to platforms and PAM infrastructure without leaving the subnav visible on unrelated workspaces', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/safes');

  const subnav = page.getByRole('tablist', { name: 'Navegación de Safes e infraestructura PAM' });
  await expect(subnav.getByRole('tab', { name: 'Safes Inventario y clasificación' })).toHaveAttribute('aria-selected', 'true');
  await expect(subnav.getByRole('tab', { name: /Plataformas y cuentas/ })).toBeVisible();
  await expect(subnav.getByRole('tab', { name: /Infraestructura PAM/ })).toBeVisible();

  // Every technical catalog is still reachable both from this subnav and
  // from its own standalone switcher/deep-link route -- the plan requires
  // validating with users before retiring the duplicated destinations.
  await subnav.getByRole('tab', { name: /Plataformas y cuentas/ }).click();
  await expect(page).toHaveURL(/\/pam\/platforms$/);
  await expect(page.getByRole('heading', { name: 'Plataformas', exact: true })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Navegación de Safes e infraestructura PAM' }).getByRole('tab', { name: /Plataformas y cuentas/ })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('tablist', { name: 'Navegación de Safes e infraestructura PAM' }).getByRole('tab', { name: /Infraestructura PAM/ }).click();
  await expect(page).toHaveURL(/\/pam\/connectors$/);
  const nested = page.getByRole('tablist', { name: 'Secciones de infraestructura PAM' });
  await expect(nested.getByRole('tab', { name: 'Conectores' })).toHaveAttribute('aria-selected', 'true');

  await expect(nested.getByRole('tab', { name: 'Aplicaciones AIM' })).toHaveCount(0);

  // General/Posture (unrelated workspaces) never show this subnav.
  await page.goto('/pam');
  await expect(page.getByRole('tablist', { name: 'Navegación de Safes e infraestructura PAM' })).toHaveCount(0);
});

test('an actor with only pam:catalogs_read still sees the Safes subnav reach the technical catalogs', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'pam:catalogs_read'] });
  await page.goto('/pam/safes');

  const subnav = page.getByRole('tablist', { name: 'Navegación de Safes e infraestructura PAM' });
  await expect(subnav.getByRole('tab', { name: /Plataformas y cuentas/ })).toBeVisible();
  await expect(subnav.getByRole('tab', { name: /Infraestructura PAM/ })).toBeVisible();
});

test('an actor without pam:catalogs_read or access:manage never sees the technical-catalog tabs', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'] });
  await page.goto('/pam/safes');

  const subnav = page.getByRole('tablist', { name: 'Navegación de Safes e infraestructura PAM' });
  await expect(subnav.getByRole('tab', { name: /Plataformas y cuentas/ })).toHaveCount(0);
  await expect(subnav.getByRole('tab', { name: /Infraestructura PAM/ })).toHaveCount(0);
});

test('Safes subnav axe check covers the top-level tabs and the nested infrastructure tabs', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/safes');
  const topResults = await new AxeBuilder({ page }).include('.pam-infra-subnav > .workspace-subnav').analyze();
  expect(topResults.violations).toEqual([]);

  await page.goto('/pam/connectors');
  const nestedResults = await new AxeBuilder({ page }).include('.workspace-subnav-nested').analyze();
  expect(nestedResults.violations).toEqual([]);
});
