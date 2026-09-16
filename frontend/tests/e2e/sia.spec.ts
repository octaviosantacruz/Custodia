import AxeBuilder from '@axe-core/playwright';
import { expect, mockAuthenticatedApp, test } from './fixtures';

test('SIA exposes persisted destinations by policy and asset type', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/sia');
  await expect(page.getByRole('heading', { name: 'Políticas de acceso', exact: true })).toBeVisible();
  await page.getByRole('row', { name: /Finance access.*ver detalle/ }).click();
  await expect(page.getByRole('cell', { name: '10.67.10.186' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Finance access', exact: true })).toBeVisible();
  await expect(page.getByText('IP rules', { exact: true })).toBeVisible();
});

test('SIA shows all connection states on initial load', async ({ page }) => {
  let siaRequest: URL | null = null;
  page.on('request', (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.pathname === '/api/cmdb/sia-policies') siaRequest = requestUrl;
  });

  await mockAuthenticatedApp(page);
  await page.goto('/pam/sia');

  await expect(page.getByRole('heading', { name: 'Políticas de acceso', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Filtrar políticas SIA por vinculación con Safes' })).toHaveText('Todas las vinculaciones');
  await expect.poll(() => siaRequest?.searchParams.get('linkage_status')).toBe('');
});

test('SIA policy search is debounced instead of firing one request per keystroke', async ({ page }) => {
  let requestCount = 0;
  await mockAuthenticatedApp(page, {
    onRequest: (pathname) => { if (pathname === '/api/cmdb/sia-policies') requestCount += 1; },
  });
  await page.goto('/pam/sia');
  await expect(page.getByRole('heading', { name: 'Políticas de acceso', exact: true })).toBeVisible();
  const requestsBeforeTyping = requestCount;

  const searchBox = page.getByRole('searchbox', { name: 'Buscar políticas SIA por nombre o descripción' });
  await searchBox.pressSequentially('Finance', { delay: 30 });

  // While still typing quickly, the debounce must not have fired one request per keystroke yet.
  expect(requestCount).toBe(requestsBeforeTyping);
  await expect.poll(() => requestCount).toBeGreaterThan(requestsBeforeTyping);
  expect(requestCount).toBeLessThan(requestsBeforeTyping + 'Finance'.length);
});

test('an out-of-order SIA search response never clobbers a newer search result', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.route('**/api/cmdb/sia-policies*', async (route) => {
    const requestUrl = new URL(route.request().url());
    const q = requestUrl.searchParams.get('q') || '';
    if (q === 'stale-term') {
      // Simulate the network reordering itself: this request was issued
      // first but resolves well after the next one below.
      await new Promise((resolve) => setTimeout(resolve, 900));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rows: [{ object_id: 999, display_name: 'STALE RESULT', source_id: 'stale', attributes: { status: 'Enabled', description: '', platforms: [], rule_names: [], policy_type: 'DB', ip_rules: [], fqdn_rules: [], logical_names: [], granted_users: [], granted_groups: [], granted_roles: [] } }], total: 1, limit: 50, offset: 0 }),
      });
      return;
    }
    if (q === 'fresh-term') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rows: [{ object_id: 20, display_name: 'Finance access', source_id: 'policy-20', attributes: { status: 'Enabled', description: 'Acceso a bases Finance', platforms: ['OnPrem'], rule_names: ['ip rules'], policy_type: 'DB', ip_rules: ['10.67.10.186'], fqdn_rules: [], logical_names: [], granted_users: [], granted_groups: [], granted_roles: ['Operations'] } }], total: 1, limit: 50, offset: 0 }),
      });
      return;
    }
    await route.fallback();
  });
  await page.goto('/pam/sia');
  await expect(page.getByRole('heading', { name: 'Políticas de acceso', exact: true })).toBeVisible();

  const searchBox = page.getByRole('searchbox', { name: 'Buscar políticas SIA por nombre o descripción' });
  await searchBox.fill('stale-term');
  // Give the debounce time to fire the (slow) stale-term request, then
  // switch to the fresh term before it resolves.
  await page.waitForTimeout(350);
  await searchBox.fill('fresh-term');

  await expect(page.getByText('Finance access', { exact: true })).toBeVisible();
  // Wait past the point where the slow stale-term response resolves (it
  // was issued first but takes ~900ms) to prove it never overwrites the
  // fresh result once it finally arrives.
  await page.waitForTimeout(700);
  await expect(page.getByText('Finance access', { exact: true })).toBeVisible();
  await expect(page.getByText('STALE RESULT', { exact: true })).toHaveCount(0);
});

test('SIA hub has three tabs (Políticas/Recursos/Cobertura) navigable with the keyboard', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/sia');

  const siaNav = page.getByRole('tablist', { name: 'Secciones de SIA' });
  await expect(siaNav.getByRole('tab', { name: /Políticas.*Políticas de acceso/ })).toHaveAttribute('aria-selected', 'true');
  await expect(siaNav.getByRole('tab', { name: /Recursos.*VMs, Strong Accounts/ })).toBeVisible();
  await expect(siaNav.getByRole('tab', { name: /Cobertura.*Activos y conexiones/ })).toBeVisible();

  await siaNav.getByRole('tab', { name: /Políticas.*Políticas de acceso/ }).focus();
  // Roving tablist with automatic activation: one ArrowRight moves to and
  // activates Recursos.
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/\/pam\/sia\/resources$/);
  await expect(siaNav.getByRole('tab', { name: /Recursos.*VMs, Strong Accounts/ })).toHaveAttribute('aria-selected', 'true');
});

test('Recursos groups VMs, Strong Accounts and Access Assets as sub-tabs, plus a link to conectores SIA', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/sia/resources');

  const resourceNav = page.getByRole('tablist', { name: 'Tipos de recurso SIA' });
  await expect(resourceNav.getByRole('tab', { name: /Máquinas virtuales/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('web-01', { exact: true })).toBeVisible();

  await resourceNav.getByRole('tab', { name: /Cuentas fuertes de BD/ }).click();
  await expect(page).toHaveURL(/\/pam\/sia\/database-accounts$/);
  await expect(page.getByText('app-db-account', { exact: true })).toBeVisible();

  await resourceNav.getByRole('tab', { name: /Assets de Access/ }).click();
  await expect(page).toHaveURL(/\/pam\/access-assets$/);
  await expect(page.getByText('509_3', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Ver conectores SIA' }).click();
  await expect(page).toHaveURL(/\/pam\/connectors$/);
});

test('reloading /pam/sia/database-accounts keeps both the Recursos tab and the database-accounts sub-tab active', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/sia/database-accounts');

  const siaNav = page.getByRole('tablist', { name: 'Secciones de SIA' });
  const resourceNav = page.getByRole('tablist', { name: 'Tipos de recurso SIA' });
  await expect(siaNav.getByRole('tab', { name: /Recursos/ })).toHaveAttribute('aria-selected', 'true');
  await expect(resourceNav.getByRole('tab', { name: /Cuentas fuertes de BD/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('app-db-account', { exact: true })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\/pam\/sia\/database-accounts$/);
  await expect(siaNav.getByRole('tab', { name: /Recursos/ })).toHaveAttribute('aria-selected', 'true');
  await expect(resourceNav.getByRole('tab', { name: /Cuentas fuertes de BD/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('app-db-account', { exact: true })).toBeVisible();
});

test('Cobertura absorbs the existing Activos y conexiones workspace unchanged', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/assets');

  const siaNav = page.getByRole('tablist', { name: 'Secciones de SIA' });
  await expect(siaNav.getByRole('tab', { name: /Cobertura/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Activos y conexiones', exact: true, level: 2 })).toBeVisible();
});

test('the Recursos tab is hidden without any resource permission, and its direct routes redirect into the SIA hub', async ({ page }) => {
  // IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §6: a tab without
  // permission never shows, and a direct link to it redirects instead of
  // rendering a blocked/empty pane. Políticas/Cobertura never require
  // access:manage; only the three Recursos sources do (each keeps its own
  // narrow permission, see below).
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'] });
  await page.goto('/pam/sia');

  const siaNav = page.getByRole('tablist', { name: 'Secciones de SIA' });
  await expect(siaNav.getByRole('tab', { name: /Políticas/ })).toBeVisible();
  await expect(siaNav.getByRole('tab', { name: /Recursos/ })).toHaveCount(0);
  await expect(siaNav.getByRole('tab', { name: /Cobertura/ })).toBeVisible();

  await page.goto('/pam/sia/resources');
  await expect(page).toHaveURL(/\/pam\/sia$/);
  await expect(siaNav.getByRole('tab', { name: /Recursos/ })).toHaveCount(0);
});

test('an actor with only pam:catalogs_read (Access Assets) sees Recursos default straight to Access Assets, not bounce to Políticas', async ({ page }) => {
  // Real bug found and fixed: the "Recursos" tab used to always target
  // siaResources regardless of which of the three sources the actor
  // actually holds -- for an actor who only has pam:catalogs_read (Access
  // Assets) and not sia:catalogs_read (VMs/Strong Accounts), clicking
  // Recursos bounced them straight back to Políticas instead of landing
  // on the one resource kind they can actually see.
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'pam:catalogs_read'] });
  await page.goto('/pam/sia');

  const siaNav = page.getByRole('tablist', { name: 'Secciones de SIA' });
  await siaNav.getByRole('tab', { name: /Recursos/ }).click();

  await expect(page).toHaveURL(/\/pam\/access-assets$/);
  await expect(siaNav.getByRole('tab', { name: /Recursos/ })).toHaveAttribute('aria-selected', 'true');
  const resourceNav = page.getByRole('tablist', { name: 'Tipos de recurso SIA' });
  await expect(resourceNav.getByRole('tab', { name: /Assets de Access/ })).toHaveAttribute('aria-selected', 'true');
  await expect(resourceNav.getByRole('tab', { name: /Máquinas virtuales/ })).toHaveCount(0);
  await expect(page.getByText('509_3', { exact: true })).toBeVisible();

  // A direct link to a resource kind this actor can't see (siaResources,
  // requires sia:catalogs_read) lands on Access Assets, not Políticas.
  await page.goto('/pam/sia/resources');
  await expect(page).toHaveURL(/\/pam\/access-assets$/);
  await expect(page.getByText('509_3', { exact: true })).toBeVisible();
});

test('an actor with only sia:catalogs_read can still reach SIA resources and database accounts', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'sia:catalogs_read'] });
  await page.goto('/pam/sia/resources');

  const resourceNav = page.getByRole('tablist', { name: 'Tipos de recurso SIA' });
  await expect(resourceNav.getByRole('tab', { name: /Máquinas virtuales/ })).toHaveAttribute('aria-selected', 'true');
  await expect(resourceNav.getByRole('tab', { name: /Assets de Access/ })).toHaveCount(0);
  await expect(page.getByText('web-01', { exact: true })).toBeVisible();
});

test('SIA hub axe check covers the top-level tabs and the Recursos sub-tabs', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/sia');
  const topTabsResults = await new AxeBuilder({ page }).include('.sia-hub-workspace > .workspace-subnav').analyze();
  expect(topTabsResults.violations).toEqual([]);

  await page.goto('/pam/sia/resources');
  await expect(page.getByText('web-01', { exact: true })).toBeVisible();
  const resourceTabsResults = await new AxeBuilder({ page }).include('.sia-resources-tab-header').analyze();
  expect(resourceTabsResults.violations).toEqual([]);
});
