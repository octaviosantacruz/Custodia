import AxeBuilder from '@axe-core/playwright';
import { expect, mockAuthenticatedApp, test } from './fixtures';

test('identity navigation replaces the Identity roles list with the richer CyberArk roles view', async ({ page }) => {
  let identityRequestUrl = '';
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/cmdb/identity-users') identityRequestUrl = request.url();
  });
  await mockAuthenticatedApp(page);
  await page.goto('/pam');

  await page.getByRole('button', { name: /Cambiar workspace/ }).click();
  const workspaceMenu = page.getByRole('region', { name: 'Workspaces' });
  await expect(workspaceMenu.locator('[data-section="tool-workspaces"]').getByRole('button', { name: /Identidades.*Directorio SCIM/ })).toBeVisible();
  await workspaceMenu.locator('[data-section="tool-workspaces"]').getByRole('button', { name: /Identidades.*Directorio SCIM/ }).click();
  await expect(page).toHaveURL(/\/pam\/identity$/);
  const identityNav = page.getByRole('tablist', { name: 'Secciones de identidad' });
  await expect(identityNav.getByRole('tab', { name: /Usuarios.*Directorio actual/ })).toBeVisible();
  await expect(page.getByText('Ada Identity', { exact: true })).toBeVisible();
  await expect.poll(() => identityRequestUrl).toContain('/api/cmdb/identity-users');

  await expect(identityNav.getByRole('tab')).toHaveCount(4);
  await expect(identityNav.getByRole('tab', { name: /Roles actuales de Identity Administration/ })).toHaveCount(0);
  await identityNav.getByRole('tab', { name: /Roles CyberArk.*Roles nativos/ }).click();
  await expect(page).toHaveURL(/\/pam\/roles$/);
  await expect(page.getByText('Operations', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Roles CyberArk.*Roles nativos/ })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('button', { name: /Cambiar workspace/ }).click();
  await expect(page.getByRole('region', { name: 'Workspaces' }).getByRole('button', { name: /Roles CyberArk/ })).toHaveCount(0);
});

test('legacy Identity roles URLs redirect to the consolidated CyberArk roles tab', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/identity?section=roles');

  await expect(page).toHaveURL(/\/pam\/roles$/);
  await expect(page.getByRole('heading', { name: 'Roles CyberArk', exact: true, level: 1 })).toBeVisible();
  const identityNav = page.getByRole('tablist', { name: 'Secciones de identidad' });
  await expect(identityNav.getByRole('tab', { name: /Roles CyberArk.*Roles nativos/ })).toHaveAttribute('aria-selected', 'true');

  await page.goto('/pam/identity/roles');
  await expect(page).toHaveURL(/\/pam\/roles$/);
  await expect(page.getByRole('tab', { name: /Roles CyberArk.*Roles nativos/ })).toHaveAttribute('aria-selected', 'true');
});

test('Identity Administration users show the Standard seat badge from the PAM UUID bridge', async ({ page }) => {
  let identityUsersRequest = '';
  page.on('request', (request) => {
    if (request.url().includes('/api/cmdb/identity-users')) identityUsersRequest = request.url();
  });
  await mockAuthenticatedApp(page);
  await page.goto('/pam/identity');
  await expect(page.getByRole('tablist', { name: 'Secciones de identidad' })).toBeVisible();
  await expect(page.getByText('Ada Identity', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Usuarios', exact: true, level: 2 })).toBeVisible();
  await expect(page.getByLabel('Asiento Standard conciliado')).toBeVisible();
  await expect(page.getByLabel('Asiento Standard conciliado')).toHaveAttribute('title', /UUID de Identity coincide/);
  await page.getByRole('button', { name: 'Filtrar usuarios de Identity Administration por conciliación de asiento Standard' }).click();
  await page.getByRole('option', { name: 'Asiento Standard conciliado', exact: true }).click();
  await expect.poll(() => identityUsersRequest ? new URL(identityUsersRequest).searchParams.get('standard_seat') : null).toBe('reconciled');
  await page.getByRole('button', { name: /Ada Identity/ }).click();
  await expect(page.getByRole('dialog', { name: 'Ada Identity' })).toContainText('Asiento Standard');
});

test('Federaciones is a fourth tab inside Identidades, navigable with the keyboard', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/identity');

  const identityNav = page.getByRole('tablist', { name: 'Secciones de identidad' });
  await expect(identityNav.getByRole('tab', { name: /Federaciones.*Catálogo de federaciones/ })).toBeVisible();

  await identityNav.getByRole('tab', { name: /Usuarios.*Directorio actual/ }).focus();
  // Roving tablist with "automatic activation" (see tablist-keyboard.ts):
  // moving focus also activates the tab immediately. A single ArrowLeft
  // from the first tab wraps around to the last one (Federaciones).
  await page.keyboard.press('ArrowLeft');

  await expect(page).toHaveURL(/\/pam\/identity\/federations$/);
  await expect(page.getByRole('heading', { name: 'Federaciones', exact: true, level: 3 })).toBeVisible();
  await expect(page.getByText('Okta-ITTI', { exact: true })).toBeVisible();
  await expect(identityNav.getByRole('tab', { name: /Federaciones.*Catálogo de federaciones/ })).toHaveAttribute('aria-selected', 'true');
});

test('reloading /pam/identity/federations keeps the Federaciones tab active', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/identity/federations');

  const identityNav = page.getByRole('tablist', { name: 'Secciones de identidad' });
  await expect(identityNav.getByRole('tab', { name: /Federaciones.*Catálogo de federaciones/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Okta-ITTI', { exact: true })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\/pam\/identity\/federations$/);
  await expect(identityNav.getByRole('tab', { name: /Federaciones.*Catálogo de federaciones/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Okta-ITTI', { exact: true })).toBeVisible();
});

test('a matched user shows the derived federation, never phrased as evidence from the API', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/identity');

  await expect(page.getByRole('cell', { name: 'Okta ITTI' })).toBeVisible();
  await page.getByRole('button', { name: /Ada Identity/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Ada Identity' });
  await expect(dialog).toContainText('Federación de ingreso');
  await expect(dialog).toContainText('Federación esperada por dominio de correo: Okta ITTI');
  await expect(dialog).toContainText('Derivada por dominio');
});

test('the switcher offers a single Identidades destination, not one per Identity subview', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam');

  await page.getByRole('button', { name: /Cambiar workspace/ }).click();
  const workspaceMenu = page.getByRole('region', { name: 'Workspaces' });
  await expect(workspaceMenu.getByRole('button', { name: /Identidades.*Directorio SCIM/ })).toHaveCount(1);
  await expect(workspaceMenu.getByRole('button', { name: /Federaciones/ })).toHaveCount(0);
  await expect(workspaceMenu.getByRole('button', { name: /Grupos de Okta/ })).toHaveCount(0);
});

test('the Federaciones tab is hidden without identity:catalogs_read/access:manage, and its direct route redirects to the first authorized tab', async ({ page }) => {
  // IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §6: a tab without
  // permission never shows, and a direct link to it redirects instead of
  // rendering a blocked/empty pane. Usuarios/Grupos/Roles require only
  // base inventory:read (already covered by every other test in this
  // file); only Federaciones needs the narrower identity:catalogs_read
  // or access:manage.
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'] });
  await page.goto('/pam/identity');

  const identityNav = page.getByRole('tablist', { name: 'Secciones de identidad' });
  await expect(identityNav.getByRole('tab', { name: /Usuarios.*Directorio actual/ })).toBeVisible();
  await expect(identityNav.getByRole('tab', { name: /Federaciones/ })).toHaveCount(0);

  // A direct link to the now-hidden tab redirects to the first
  // authorized one instead of rendering it anyway or an empty pane.
  await page.goto('/pam/identity/federations');
  await expect(page).toHaveURL(/\/pam\/identity$/);
  await expect(identityNav.getByRole('tab', { name: /Federaciones/ })).toHaveCount(0);
  await expect(identityNav.getByRole('tab', { name: /Usuarios.*Directorio actual/ })).toHaveAttribute('aria-selected', 'true');
});

test('an actor with identity:catalogs_read (but not access:manage) can still reach Federaciones', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'identity:catalogs_read'] });
  await page.goto('/pam/identity/federations');

  const identityNav = page.getByRole('tablist', { name: 'Secciones de identidad' });
  await expect(identityNav.getByRole('tab', { name: /Federaciones.*Catálogo de federaciones/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Okta-ITTI', { exact: true })).toBeVisible();
});

test('Identidades axe check covers the tab list, the Federación column and the Federaciones tab', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/identity');
  await expect(page.getByRole('tablist', { name: 'Secciones de identidad' })).toBeVisible();
  // Scoped narrowly to what this change actually adds (the tab list and
  // the new Federación header/cell), not the whole pre-existing table:
  // that table already carries unrelated legacy debt (e.g. StandardSeatBadge's
  // aria-label-on-a-plain-span, and .database-toolbar's contrast issue,
  // both predating this change and shared across other workspaces) that's
  // out of scope for the Identity/SIA consolidation's Phase 1 -- worth
  // their own follow-up, not a silent drive-by fix on unrelated markup.
  const tablistResults = await new AxeBuilder({ page }).include('.workspace-subnav').analyze();
  expect(tablistResults.violations).toEqual([]);
  const headerResults = await new AxeBuilder({ page }).include('.compact-table thead').analyze();
  expect(headerResults.violations).toEqual([]);

  await page.goto('/pam/identity/federations');
  await expect(page.getByText('Okta-ITTI', { exact: true })).toBeVisible();
  // Same scoping rationale as above: CatalogListPanel (shared by every
  // other catalog workspace: roles, connectors, platforms, SIA resources,
  // etc.) has its own pre-existing heading-order/contrast debt unrelated
  // to moving it under the Identidades tabs -- out of scope here.
  const federationsTableResults = await new AxeBuilder({ page }).include('.compact-table thead').analyze();
  expect(federationsTableResults.violations).toEqual([]);
});
