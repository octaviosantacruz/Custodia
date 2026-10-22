import AxeBuilder from '@axe-core/playwright';
import { expect, mockAuthenticatedApp, test } from '../../support/fixtures';

test('identity navigation has two tabs and combines roles and Okta groups from Identity', async ({ page }) => {
  await mockAuthenticatedApp(page);
  const rolesRequests: string[] = [];
  const pamRequests: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/api/cmdb/identity-roles') rolesRequests.push(request.url());
    if (path === '/api/cmdb/pam-roles') pamRequests.push(request.url());
  });
  await page.route('**/api/cmdb/identity-roles?**', async (route) => {
    await route.fulfill({ json: { rows: [
      { object_id: 32, display_name: 'Administration Role', source_id: 'hidden-role-id', attributes: { direct_member_count: 1 }, member_count: 1 },
      { object_id: 34, display_name: 'sg_cyberark_system_administrator', source_id: 'hidden-group-id', attributes: { direct_member_count: 2 }, member_count: 2 },
    ], total: 2, limit: 50, offset: 0, search: '' } });
  });
  await page.goto('/pam/identity');
  const navigation = page.getByRole('tablist', { name: 'Secciones de identidad' });
  await expect(navigation.getByRole('tab')).toHaveCount(2);
  await expect(page.getByText('Ada Identity', { exact: true })).toBeVisible();
  await navigation.getByRole('tab', { name: /Roles y grupos/ }).click();
  await expect(page).toHaveURL(/\/pam\/identity\/roles$/);
  await expect(page.getByText('Administration Role', { exact: true })).toBeVisible();
  await expect(page.getByText('sg_cyberark_system_administrator', { exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /Administration Role/ })).toContainText('Rol de CyberArk');
  await expect(page.getByRole('button', { name: 'sg_cyberark_system_administrator', exact: true })).toBeVisible();
  await expect.poll(() => rolesRequests.length).toBeGreaterThan(0);
  expect(new URL(rolesRequests[0]).searchParams.get('kind') || '').toBe('');
  expect(pamRequests).toEqual([]);
  await expect(page.getByText('hidden-role-id')).toHaveCount(0);
  await expect(page.getByText('hidden-group-id')).toHaveCount(0);
  await page.goto('/pam/identity/groups');
  await expect(page).toHaveURL(/\/pam\/identity\/roles$/);
  await expect(navigation.getByRole('tab')).toHaveCount(2);
  await expect(page.getByText('Administration Role', { exact: true })).toBeVisible();
  expect(pamRequests).toEqual([]);

  rolesRequests.length = 0;
  await page.goto('/pam/roles');
  await expect(page).toHaveURL(/\/pam\/roles$/);
  await expect(page.getByRole('searchbox', { name: 'Buscar roles cyberark' })).toBeVisible();
  await expect(page.getByText('Operations', { exact: true })).toBeVisible();
  await expect.poll(() => pamRequests.length).toBeGreaterThan(0);
  expect(rolesRequests).toEqual([]);
});

for (const theme of ['dark', 'light'] as const) {
  test(`roles and Okta groups can be filtered by type and sorted by name or member count in ${theme}`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('custodia-theme:v1', value), theme);
    await mockAuthenticatedApp(page);
    const requests: URL[] = [];
    await page.route('**/api/cmdb/identity-roles?**', async (route) => {
      requests.push(new URL(route.request().url()));
      await route.fulfill({ json: { rows: [
        { object_id: 32, display_name: 'Administration Role', source_id: 'r', attributes: { direct_member_count: 1 }, member_count: 1 },
        { object_id: 34, display_name: 'sg_cyberark_system_administrator', source_id: 'g', attributes: { direct_member_count: 2 }, member_count: 2 },
      ], total: 2, limit: 50, offset: 0, search: '' } });
    });
    await page.goto('/pam/identity/roles');
    const table = page.getByRole('table');
    await expect(table.getByRole('columnheader', { name: 'Tipo', exact: true })).toHaveCount(0);
    await expect(page.getByRole('row', { name: /Administration Role/ })).toContainText('Rol de CyberArk');
    await expect(page.getByRole('row', { name: /sg_cyberark_system_administrator/ })).toContainText('Grupo de Okta');
    await expect(table.getByRole('columnheader', { name: 'Rol o grupo' })).toHaveAttribute('aria-sort', 'ascending');

    await page.getByRole('button', { name: 'Filtrar por tipo de rol o grupo' }).click();
    await page.getByRole('option', { name: 'Grupos de Okta' }).click();
    await expect.poll(() => requests.at(-1)?.searchParams.get('kind')).toBe('okta_group');

    await table.getByRole('button', { name: 'Rol o grupo' }).click();
    await expect(table.getByRole('columnheader', { name: 'Rol o grupo' })).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(() => requests.at(-1)?.searchParams.get('direction')).toBe('desc');

    await table.getByRole('button', { name: 'Miembros directos' }).click();
    await expect.poll(() => `${requests.at(-1)?.searchParams.get('sort')}:${requests.at(-1)?.searchParams.get('direction')}`).toBe('members:desc');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.locator('main').evaluate((element) => Promise.all(
      element.getAnimations({ subtree: true }).filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished),
    ));
    const axe = await new AxeBuilder({ page }).include('table').analyze();
    expect(axe.violations.map(({ id }) => id)).toEqual([]);
  });
}

test('Identity roles URLs stay isolated from the PAM roles inventory', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/identity?section=roles');
  await expect(page).toHaveURL(/\/pam\/identity\/roles$/);
  await expect(page.getByText('global auditor', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Roles y grupos.*Miembros directos/ })).toHaveAttribute('aria-selected', 'true');
  await page.goto('/pam/identity/roles');
  await expect(page.getByText('global auditor', { exact: true })).toBeVisible();
});

test('Identidades keeps the navigation focused on users and roles/groups', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/identity');
  await expect(page.getByRole('tablist', { name: 'Secciones de identidad' })).toBeVisible();
  await expect(page.getByText('Ada Identity', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Usuarios', exact: true, level: 1 })).toBeVisible();
  const navigation = page.getByRole('tablist', { name: 'Secciones de identidad' });
  await expect(navigation.getByRole('tab')).toHaveCount(2);
  await expect(navigation.getByRole('tab', { name: /Asientos Standard/ })).toHaveCount(0);
  await expect(navigation.getByRole('tab', { name: /^Federaciones$/ })).toHaveCount(0);
});

test('a matched user shows the derived federation, never phrased as evidence from the API (UX-AUD2-009)', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/identity');

  await expect(page.getByRole('cell', { name: 'Okta ITTI' })).toBeVisible();
  await page.locator('.identity-user-cell').getByRole('button', { name: /Ada Identity/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Ada Identity' });
  await expect(dialog).toContainText('Federación de ingreso');
  await expect(page.locator('html')).toHaveAttribute('data-theme', test.info().project.name.includes('light') ? 'light' : 'dark');
  await expect(dialog.locator('time[datetime="2026-09-09T00:00:00Z"]').first()).toHaveAttribute('title', /^hace /);
  await expect(dialog.locator('time[datetime="2026-09-09T00:00:00Z"]').last()).toHaveAttribute('title', /^hace /);
  await expect(dialog).toContainText('Federación esperada por dominio de correo: Okta ITTI');
  await expect(dialog).toContainText('Derivada por dominio');
});

test('the switcher offers a single Identidades destination, not one per Identity subview', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam');

  const workspaceMenu = page.getByRole('navigation', { name: 'Secciones de CyberArk', exact: true });
  await expect(workspaceMenu.getByRole('link', { name: /^Identidades$/ })).toHaveCount(1);
  await expect(workspaceMenu.getByRole('link', { name: /^Federaciones$/ })).toHaveCount(0);
  await expect(workspaceMenu.getByRole('link', { name: /^Grupos de Okta$/ })).toHaveCount(0);
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
  await expect(identityNav.getByRole('tab', { name: /Usuarios.*Personas y cuentas registradas/ })).toBeVisible();
  await expect(identityNav.getByRole('tab', { name: /^Federaciones$/ })).toHaveCount(0);

  // A direct link to the now-hidden tab redirects to the first
  // authorized one instead of rendering it anyway or an empty pane.
  await page.goto('/pam/identity/federations');
  await expect(page).toHaveURL(/\/pam\/identity\/users$/);
  await expect(identityNav.getByRole('tab', { name: /^Federaciones$/ })).toHaveCount(0);
  await expect(identityNav.getByRole('tab', { name: /Usuarios.*Personas y cuentas registradas/ })).toHaveAttribute('aria-selected', 'true');
});

for (const theme of ['dark', 'light'] as const) {
  test(`Identidades axe check covers navigation, Federación and the Standard badge in ${theme}`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('custodia-theme:v1', value), theme);
    await mockAuthenticatedApp(page);
    await page.goto('/pam/identity');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.getByRole('tablist', { name: 'Secciones de identidad' })).toBeVisible();
    const badge = page.getByRole('img', { name: 'Asiento Standard conciliado', exact: true });
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('Licencia Standard');
    // FE-AUD-012: exercise the rendered text, including its real theme background.
    const results = await new AxeBuilder({ page })
      .include('.workspace-subnav').include('.compact-table thead').include('.standard-seat-badge')
      .analyze();
    expect(results.violations).toEqual([]);
  });
}

test('the retired Federaciones URL lands on Identidades even for catalog readers', async ({ page }) => {
  // Federaciones left the Identidades tabs in 496fb14; an old bookmark must
  // land on the first authorized tab instead of an empty or broken pane.
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'identity:catalogs_read'] });
  await page.goto('/pam/identity/federations');
  await expect(page).toHaveURL(/\/pam\/identity(\/users)?$/);
  const identityNav = page.getByRole('tablist', { name: 'Secciones de identidad' });
  await expect(identityNav.getByRole('tab', { name: /Usuarios.*Personas y cuentas registradas/ })).toHaveAttribute('aria-selected', 'true');
  await expect(identityNav.getByRole('tab', { name: /^Federaciones$/ })).toHaveCount(0);
});


for (const theme of ['dark', 'light'] as const) {
  test(`Identity layers expose direct members, Okta groups, cycles and user paths in ${theme} (UX-AUD2-009)`, async ({ page }) => {
    await mockAuthenticatedApp(page);
    await page.addInitScript((value) => localStorage.setItem('custodia-theme:v1', value), theme);
    const nodes = [
      { object_id: 32, display_name: 'Administration Role', kind: 'role' },
      { object_id: 33, display_name: 'System Administrator', kind: 'role' },
      { object_id: 34, display_name: 'sg_cyberark_system_administrator', kind: 'okta_group' },
      { object_id: 35, display_name: 'Ada', kind: 'user' },
      { object_id: 36, display_name: 'OKTA SCIM Service Role', kind: 'role' },
      { object_id: 37, display_name: 'Administrador', user_name: 'admin@cyberark.cloud', kind: 'user' },
    ].map((node) => ({ ...node, source_id: `id-${node.object_id}`, membership_status: 'complete', unresolved_member_count: node.object_id === 33 ? 1 : 0, direct_member_count: node.object_id === 33 ? 5 : undefined, unresolved_members: node.object_id === 33 ? [{ display_name: 'apiuser@cyberark.cloud', kind: 'user' }] : [], last_seen_at: '2026-10-03T12:00:00Z' }));
    await page.route('**/api/cmdb/identity-roles?**', (route) => route.fulfill({ json: { rows: [{ object_id: 32, display_name: 'Administration Role', source_id: 'id-32', attributes: { direct_member_count: 1 }, member_count: 1 }], total: 1, limit: 50, offset: 0 } }));
    await page.route('**/api/cmdb/identity-roles/32/membership', (route) => route.fulfill({ json: { root_id: 32, nodes, edges: [{ parent_id: 32, member_id: 33 }, { parent_id: 33, member_id: 34 }, { parent_id: 33, member_id: 35 }, { parent_id: 33, member_id: 37 }, { parent_id: 34, member_id: 35 }, { parent_id: 33, member_id: 36 }, { parent_id: 36, member_id: 32 }], truncated: false } }));
    await page.goto('/pam/identity/roles');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.getByRole('button', { name: 'Ver miembros de Administration Role' }).focus();
    await page.keyboard.press('Enter');
    const panel = page.getByRole('region', { name: 'Membresía de Administration Role' });
    await expect(panel).toContainText('2 usuarios únicos conocidos');
    await expect(panel.locator('time[datetime="2026-10-03T12:00:00Z"]')).toHaveAttribute('title', /^hace /);
    await expect(panel).toContainText('Cobertura parcial');
    await expect(panel.getByText('Usuarios directos', { exact: false })).toBeVisible();
    const okta = panel.locator('summary').filter({ hasText: 'sg_cyberark_system_administrator' });
    await expect(okta).toContainText('Grupo de Okta');
    await expect(panel.getByText('Usuarios del grupo', { exact: false })).toBeVisible();
    await expect(panel).toContainText('5 miembros directos · 3 usuarios · 2 roles/grupos');
    await expect(panel.locator('.membership-person').filter({ hasText: 'admin@cyberark.cloud' })).toBeVisible();
    await expect(panel.locator('.membership-person').filter({ hasText: 'apiuser@cyberark.cloud' })).toBeVisible();
    await expect(panel.getByText('Sin ficha de usuario', { exact: true })).toBeVisible();
    await expect(panel.getByText('Referencia circular · ya aparece en este recorrido')).toBeVisible();

    expect((await new AxeBuilder({ page }).include('.identity-membership').analyze()).violations).toEqual([]);
    await page.evaluate(() => window.scrollTo(0, 0));
    await panel.locator('.membership-tree').evaluate((element) => { element.scrollTop = 0; });
    await page.screenshot({ path: `/tmp/identity-layers-${theme}.png`, fullPage: true });
    await panel.getByRole('button', { name: 'Usuarios resultantes (2)' }).click();
    await expect(panel).toContainText('2 recorridos');
    await expect(panel.locator('.membership-person').filter({ hasText: 'apiuser@cyberark.cloud' })).toHaveCount(0);
    await panel.getByText('Ver recorrido de Ada').click();
    await expect(panel).toContainText('Administration Role → System Administrator → sg_cyberark_system_administrator → Ada');
    await panel.getByRole('searchbox', { name: 'Buscar usuarios resultantes' }).fill('missing');
    await expect(panel).toContainText('Sin usuarios para esta búsqueda.');
    const violations = await new AxeBuilder({ page }).include('.identity-membership').analyze();
    expect(violations.violations).toEqual([]);
  });
}


test('technical account with unreported state stays visible in inventory and drawer (UX-AUD2-009)', async ({ page }) => {
  await mockAuthenticatedApp(page);
  const user = { object_id: 901, source_id: 'service-id', display_name: 'SCIM service', role_count: 1, attributes: { user_name: 'okta_scim@example.com', email: '', active: null, service_user: true, oauth_client: true, last_login_date: '2026-10-01T10:00:00Z', last_modified: '', record_source: 'identity_directory' } };
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
  await page.route('**/api/ingestion/sources/identity_administration/stages/latest', (route) => route.fulfill({ json: { rows: [
    { stage: 'users', last_success_at: hoursAgo(1), last_status: 'completed', last_attempt_at: hoursAgo(1) },
    { stage: 'members_directory', last_success_at: hoursAgo(5), last_status: 'failed', last_attempt_at: hoursAgo(1) },
  ] } }));
  await page.route('**/api/cmdb/identity-users?**', (route) => route.fulfill({ json: { rows: [user], total: 1, limit: 50, offset: 0 } }));
  await page.route('**/api/cmdb/identity-users/901', (route) => route.fulfill({ json: { user, roles: [{ object_id: 902, source_id: 'role-id', display_name: 'OKTA SCIM Service Role', attributes: {}, member_count: 1 }] } }));
  await page.goto('/pam/identity');
  const row = page.getByRole('row').filter({ hasText: 'SCIM service' });
  await expect(row.getByText('Cuenta técnica', { exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', test.info().project.name.includes('light') ? 'light' : 'dark');
  await expect(row.locator('time[datetime="2026-10-01T10:00:00Z"]')).toHaveAttribute('title', /^hace /);
  await expect(row.locator('.status-badge').getByText('Sin dato', { exact: true })).toBeVisible();
  await expect(row.getByText('Inactivo', { exact: true })).toHaveCount(0);
  await row.getByRole('button', { name: /^SCIM service okta_scim/  }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('time[datetime="2026-10-01T10:00:00Z"]')).toHaveAttribute('title', /^hace /);
  await expect(dialog.getByText('Estado', { exact: true }).locator('..').getByText('Sin dato', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Cuenta técnica', { exact: true })).toBeVisible();
  await expect(dialog.getByText('OKTA SCIM Service Role', { exact: true })).toBeVisible();
  const origin = dialog.locator('.detail-section').filter({ hasText: 'Origen del dato' });
  await expect(origin).toContainText('Directorio de cuentas técnicas');
  await expect(origin).toContainText('Último intento fallido');
  await expect(origin).toContainText('se conserva el dato anterior');
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
});

const MATCH_SCOPE = 'Coincidencia de miembros: no prueba permisos iguales ni autoriza retirar roles. Sin acciones de eliminación.';
const matchSource = { source_system: 'identity_administration', last_run_status: 'completed', last_run_finished_at: '2026-10-03T12:00:00Z' };

test('member matches live inside the roles table: lazy, per-row chips, detail, filter and read-only (UX-AUD2-009)', async ({ page }) => {
  await mockAuthenticatedApp(page);
  const requests: string[] = [];
  const roleUrls: string[] = [];
  let release!: () => void;
  let attempt = 0;
  await page.route('**/api/cmdb/identity-roles?**', (route) => {
    roleUrls.push(route.request().url());
    return route.fulfill({ json: { rows: [
      { object_id: 71, display_name: 'Role Parent', source_id: 'role-parent', attributes: { direct_member_count: 3, membership_status: 'complete' }, member_count: 3 },
      { object_id: 73, display_name: 'Role Copy', source_id: 'role-copy', attributes: { direct_member_count: 3, membership_status: 'complete' }, member_count: 3 },
      { object_id: 90, display_name: 'Role Alone', source_id: 'role-alone', attributes: { direct_member_count: 1, membership_status: 'complete' }, member_count: 1 },
    ], total: 3, limit: 50, offset: 0 } });
  });
  await page.route('**/api/cmdb/identity-roles/71/membership', (route) => route.fulfill({ json: { root_id: 71, nodes: [{ object_id: 71, display_name: 'Role Parent', kind: 'role', source_id: 'role-parent', membership_status: 'complete', unresolved_member_count: 0, unresolved_members: [] }], edges: [], truncated: false } }));
  await page.route('**/api/cmdb/identity-roles/member-matches', async (route) => {
    requests.push(route.request().method());
    attempt += 1;
    if (attempt === 1) {
      await new Promise<void>((resolve) => { release = resolve; });
      await route.fulfill({ status: 503, json: { detail: 'No disponible' } });
      return;
    }
    await route.fulfill({ json: {
      same_direct_members: [{ roles: [{ id: 'role-parent', object_id: 71, name: 'Role Parent' }, { id: 'role-copy', object_id: 73, name: 'Role Copy' }], direct_members: 3 }],
      same_user_references: [{ roles: [
        { id: 'role-parent', object_id: 71, name: 'Role Parent', traversal: [{ id: 'role-parent', object_id: 71, name: 'Role Parent' }, { id: 'role-leaf', object_id: 72, name: 'Role Leaf' }] },
        { id: 'role-copy', object_id: 73, name: 'Role Copy', traversal: [{ id: 'role-copy', object_id: 73, name: 'Role Copy' }] },
      ], referenced_accounts: 3 }],
      roles_with_incomplete_user_paths: ['Unresolved'], permissions_status: 'not_collected', scope: MATCH_SCOPE,
      source: matchSource, complete: false, roles_analyzed: 3, roles_excluded: 1,
    } });
  });
  await page.goto('/pam/identity/roles');
  await expect(page.locator('html')).toHaveAttribute('data-theme', test.info().project.name.includes('light') ? 'light' : 'dark');
  await expect(page.getByRole('row', { name: /Role Parent/ })).toBeVisible();
  expect(requests).toEqual([]);
  const bar = page.locator('.identity-match-bar');
  const analyze = bar.getByRole('button', { name: 'Analizar coincidencias' });
  await analyze.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => requests.length).toBe(1);
  expect(requests).toEqual(['GET']);
  release();
  await expect(bar.getByRole('alert')).toBeVisible();
  await bar.getByRole('button', { name: 'Reintentar' }).click();
  await expect(bar).toContainText('1 grupo con los mismos miembros directos');
  await expect(bar).toContainText('1 grupo con las mismas cuentas');
  await expect(bar.getByRole('alert')).toContainText('Análisis incompleto · 1 rol excluido');
  await expect(bar.locator('time[datetime="2026-10-03T12:00:00Z"]')).toHaveAttribute('title', /^hace /);
  await bar.getByRole('button', { name: 'Ayuda: coincidencia de miembros' }).click();
  await expect(page.getByRole('note')).toHaveText(MATCH_SCOPE);
  await page.keyboard.press('Escape');
  // Chips live in the matching rows only; the unrelated row stays clean.
  const parentRow = page.getByRole('row', { name: /Role Parent/ });
  await expect(parentRow).toContainText('1 rol con los mismos miembros');
  await expect(parentRow).toContainText('1 rol con las mismas cuentas');
  await expect(page.getByRole('row', { name: /Role Alone/ })).not.toContainText('mismos miembros');
  await expect(page.getByText(/duplicad|permisos equivalentes/i)).toHaveCount(0);
  await parentRow.getByRole('button', { name: /Ver miembros de Role Parent/ }).click();
  const details = page.locator('.identity-match-details');
  await expect(details).toContainText('Mismos miembros directos');
  await expect(details.getByText('Role Copy').first()).toBeVisible();
  await expect(details.getByRole('list', { name: 'Recorrido de este rol' })).toContainText('Role Leaf');
  await expect(details).not.toContainText('role-leaf');
  // Server-side filter by the roles that have a match.
  await bar.getByRole('button', { name: /Solo con coincidencias/ }).click();
  await expect.poll(() => roleUrls.some((url) => url.includes('object_ids=71,73') || url.includes('object_ids=71%2C73'))).toBe(true);
  expect(requests).toEqual(['GET', 'GET']);
  expect((await new AxeBuilder({ page }).include('.identity-role-list').analyze()).violations).toEqual([]);
});

test('member match bar shows its explicit empty state', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.addInitScript(() => localStorage.setItem('custodia-theme:v1', 'light'));
  await page.route('**/api/cmdb/identity-roles/member-matches', (route) => route.fulfill({ json: {
    same_direct_members: [], same_user_references: [], roles_with_incomplete_user_paths: [],
    permissions_status: 'not_collected', scope: MATCH_SCOPE,
    source: { source_system: 'identity_administration', last_run_status: 'completed', last_run_finished_at: null },
    complete: true, roles_analyzed: 0, roles_excluded: 0,
  } }));
  await page.goto('/pam/identity/roles');
  const bar = page.locator('.identity-match-bar');
  await bar.getByRole('button', { name: 'Analizar coincidencias' }).click();
  await expect(bar.getByRole('status')).toHaveText('Sin coincidencias de miembros');
  await expect(bar.getByRole('button', { name: /Solo con coincidencias/ })).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect((await new AxeBuilder({ page }).include('.identity-match-bar').analyze()).violations).toEqual([]);
});

test('member match bar warns when the analysis is incomplete', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.addInitScript(() => localStorage.setItem('custodia-theme:v1', 'dark'));
  await page.route('**/api/cmdb/identity-roles/member-matches', (route) => route.fulfill({ json: {
    same_direct_members: [], same_user_references: [], roles_with_incomplete_user_paths: ['Unresolved'],
    permissions_status: 'not_collected', scope: MATCH_SCOPE,
    source: { source_system: 'identity_administration', last_run_status: 'completed', last_run_finished_at: null },
    complete: false, roles_analyzed: 3, roles_excluded: 1,
  } }));
  await page.goto('/pam/identity/roles');
  const bar = page.locator('.identity-match-bar');
  await bar.getByRole('button', { name: 'Analizar coincidencias' }).click();
  await expect(bar.getByRole('alert')).toContainText('Análisis incompleto');
  await expect(bar.getByRole('status')).toHaveText('Sin coincidencias en el análisis parcial');
  expect((await new AxeBuilder({ page }).include('.identity-match-bar').analyze()).violations).toEqual([]);
});

test('UX-AUD2-019: roles and groups keep their identity without an independent type column', async ({ page }, testInfo) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/identity/roles');
  await expect(page.locator('html')).toHaveAttribute('data-theme', testInfo.project.use.colorScheme === 'light' ? 'light' : 'dark');
  await expect(page.getByRole('columnheader', { name: 'Miembros directos' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Tipo', exact: true })).toHaveCount(0);
  await page.goto('/pam/identity/groups');
  await expect(page.getByRole('columnheader', { name: 'Rol o grupo' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Tipo', exact: true })).toHaveCount(0);
});

test('FE-AUD-001: a failed roles read shows an error with retry, never "Sin roles asignados"', async ({ page }) => {
  await mockAuthenticatedApp(page);
  const user = { object_id: 901, source_id: 'user-id', display_name: 'Ada Roles', role_count: 1, attributes: { user_name: 'ada.roles@example.com', email: 'ada.roles@example.com', active: true, service_user: false } };
  await page.route('**/api/cmdb/identity-users?**', (route) => route.fulfill({ json: { rows: [user], total: 1, limit: 50, offset: 0 } }));
  let calls = 0;
  await page.route('**/api/cmdb/identity-users/901', (route) => {
    calls += 1;
    if (calls === 1) return route.fulfill({ status: 503, json: { detail: 'Unavailable' } });
    if (calls === 2) return route.fulfill({ json: { user, roles: [] } });
    return route.fulfill({ json: { user, roles: [{ object_id: 902, source_id: 'role-id', display_name: 'Operadores', attributes: {}, member_count: 1 }] } });
  });
  await page.goto('/pam/identity');
  const row = page.getByRole('row').filter({ hasText: 'Ada Roles' });
  await row.getByRole('button', { name: /Ver roles de Ada Roles/ }).click();
  const detail = page.locator('#identity-user-roles-901');
  await expect(detail.getByText('No se pudieron cargar los roles')).toBeVisible();
  await expect(detail.getByText('Sin roles asignados')).toHaveCount(0);
  // A valid empty answer is the only thing that reads "Sin roles asignados".
  await detail.getByRole('button', { name: 'Reintentar' }).click();
  await expect(detail.getByText('Sin roles asignados')).toBeVisible();
  await expect(detail.getByText('No se pudieron cargar los roles')).toHaveCount(0);
});

test('FE-AUD-008: Usuarios search and filters travel in the URL and survive a reload', async ({ page }) => {
  await mockAuthenticatedApp(page);
  const requests: URLSearchParams[] = [];
  await page.route('**/api/cmdb/identity-users?**', (route) => {
    requests.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ json: { rows: [{ object_id: 910, source_id: 'u', display_name: 'Ada Lovelace', role_count: 0, attributes: { user_name: 'ada@example.com', email: 'ada@example.com', active: false, service_user: false } }], total: 1, limit: 50, offset: 0 } });
  });
  await page.goto('/pam/identity');
  await page.getByRole('searchbox', { name: /Buscar/ }).first().fill('ada');
  await expect(page).toHaveURL(/[?&]q=ada/);
  await page.reload();
  await expect(page.getByRole('searchbox', { name: /Buscar/ }).first()).toHaveValue('ada');
  await expect(page.getByText('Ada Lovelace').first()).toBeVisible();
  expect(requests.at(-1)?.get('q')).toBe('ada');
  // Unknown values in a shared link are ignored, never sent to the API.
  await page.goto('/pam/identity?active=maybe&utm=1');
  await expect(page.getByText('Ada Lovelace').first()).toBeVisible();
  expect(requests.at(-1)?.get('active') || '').toBe('');
});

test('UX-QA-006: the Usuarios table scrolls inside its panel and never widens the page at 1280 px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockAuthenticatedApp(page);
  const long = 'nombre.muy.largo.de.una.persona.con.apellidos.compuestos';
  await page.route('**/api/cmdb/identity-users?**', (route) => route.fulfill({ json: { rows: [{ object_id: 910, source_id: 'u', display_name: `Ada ${long}`, role_count: 3, attributes: { user_name: `${long}@example-company-domain.com`, email: `${long}@example-company-domain.com`, active: true, service_user: false, last_login: '2026-02-27T19:06:00Z' } }], total: 1, limit: 50, offset: 0 } }));
  await page.goto('/pam/identity');
  await expect(page.getByText(`Ada ${long}`).first()).toBeVisible();
  const widths = await page.evaluate(() => {
    const wrap = document.querySelector('.compact-table-wrap')!.getBoundingClientRect();
    return { right: wrap.right, viewport: window.innerWidth, shell: document.querySelector('.app-shell')!.scrollWidth };
  });
  expect(widths.right).toBeLessThanOrEqual(widths.viewport);
  expect(widths.shell).toBeLessThanOrEqual(widths.viewport);
});
