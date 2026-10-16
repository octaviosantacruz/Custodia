import AxeBuilder from '@axe-core/playwright';
import { expect, mockAuthenticatedApp, test } from '../../support/fixtures';

const PERMISSIONS = ['inventory:read', 'netskope:read', 'netskope:admin_inventory_read'];
const admin = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, active: true, is_locked: false, record_type: 'USER', last_login: '2026-10-01T10:00:00Z', mfa_enabled: true,
  role_id: '10', role_name: 'Tenant Admin', ...extra,
});
const listing = (rows: unknown[], filtered = rows.length) => ({
  configured: true, rows, total: 3, filtered_total: filtered, active: 2, active_without_role: 1, service_accounts: 1,
  active_people_without_mfa: 1, last_observed_at: '2026-10-14T12:00:00Z',
});
const ROWS = [
  admin('a1', 'alice@example.test'),
  admin('a2', 'svc@example.test', { record_type: 'SERVICE_ACCOUNT', mfa_enabled: false, active: false }),
  admin('a3', 'carol@example.test', { role_id: null, role_name: null, mfa_enabled: false, last_login: null }),
];
const ROLE = {
  id: '10', name: 'Tenant Admin', last_edited: '2026-01-01', api_groups_total: 3,
  permissions: [
    { group_id: 1, group: 'admins', permission: 'rwa', pages: ['Administrators', 'Roles'] },
    { group_id: 2, group: 'devices', permission: 'r', pages: [] },
  ],
  admins: [{ id: 'a1', name: 'alice@example.test', active: true, record_type: 'USER' }],
};

test('NSK-RBAC-001 without the strict permission the view stays closed and nothing is requested', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/cmdb/netskope/admin*', (route) => { requests.push(route.request().url()); return route.fulfill({ status: 403, json: { detail: 'Requiere el permiso netskope:admin_inventory_read.' } }); });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read', 'access:manage'] });
  await page.goto('/netskope/admins');
  await expect(page.getByRole('region', { name: 'Administradores de Netskope', exact: true })).toHaveCount(0);
  expect(requests).toEqual([]);
});

test('NSK-RBAC-001 lists administrators with honest gaps, filters on the server and opens a role', async ({ page }, testInfo) => {
  await mockAuthenticatedApp(page, { permissions: PERMISSIONS });
  const seen: URLSearchParams[] = [];
  await page.route('**/api/cmdb/netskope/admins?**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    seen.push(params);
    return route.fulfill({ json: listing(params.get('role') === 'none' ? [ROWS[2]] : ROWS, params.get('role') === 'none' ? 1 : 3) });
  });
  await page.route('**/api/cmdb/netskope/admin-roles/10', (route) => route.fulfill({ json: ROLE }));
  await page.goto('/netskope/admins');

  await expect(page.locator('html')).toHaveAttribute('data-theme', testInfo.project.name.includes('light') ? 'light' : 'dark');
  const section = page.getByRole('region', { name: 'Administradores de Netskope', exact: true });
  await expect(section.locator('.summary-stat').filter({ hasText: 'Activos sin rol' })).toContainText('1');
  await expect(section.getByRole('row', { name: /svc@example.test/ })).toContainText('Cuenta de servicio');
  await expect(section.getByRole('row', { name: /svc@example.test/ })).toContainText('Inactivo');
  await expect(section.getByRole('row', { name: /carol@example.test/ })).toContainText('Sin rol');
  await expect(section.getByRole('row', { name: /carol@example.test/ })).toContainText('Sin dato');
  // MFA does not apply to a service account: it reads as a dash, never as "No".
  await expect(section.getByRole('row', { name: /svc@example.test/ }).getByRole('cell').last()).toHaveText('—');

  // The quick filter travels to the server and shows only the account without a role.
  await section.locator('.summary-stat').filter({ hasText: 'Activos sin rol' }).getByRole('button').click();
  await expect(section.getByRole('row', { name: /alice@example.test/ })).toHaveCount(0);
  await expect(section.getByRole('row', { name: /carol@example.test/ })).toBeVisible();
  expect(seen.at(-1)?.get('role')).toBe('none');
  expect(seen.at(-1)?.get('state')).toBe('active');
  await section.locator('.summary-stat').filter({ hasText: 'Activos sin rol' }).getByRole('button').click();

  // A role name opens its permissions with the console pages each group opens.
  await section.getByRole('button', { name: 'Tenant Admin' }).first().click();
  await expect(section.getByRole('heading', { name: 'Tenant Admin', level: 3 })).toBeVisible();
  const permissions = section.getByRole('table', { name: 'Permisos del rol Tenant Admin' });
  await expect(permissions.getByRole('row', { name: /admins/ })).toContainText('Administración');
  await expect(permissions.getByRole('row', { name: /admins/ })).toContainText('Administrators · Roles');
  await expect(permissions.getByRole('row', { name: /devices/ })).toContainText('Lectura');
  await expect(permissions.getByRole('row', { name: /devices/ })).toContainText('Sin página asociada');
  await section.getByRole('button', { name: 'Roles' }).first().click();

  const results = await new AxeBuilder({ page }).include('.netskope-admins').analyze();
  expect(results.violations).toEqual([]);
});

test('NSK-RBAC-001 the roles tab marks a role without administrators and a failed read shows a retry', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: PERMISSIONS });
  await page.route('**/api/cmdb/netskope/admins?**', (route) => route.fulfill({ json: listing(ROWS) }));
  let calls = 0;
  await page.route('**/api/cmdb/netskope/admin-roles', (route) => {
    calls += 1;
    if (calls === 1) return route.fulfill({ status: 500, json: { detail: 'falló' } });
    return route.fulfill({ json: { configured: true, total: 2, last_observed_at: '2026-10-14T12:00:00Z', rows: [
      { id: '10', name: 'Tenant Admin', reported_user_count: 2, last_edited: '2026-01-01', api_groups_total: 3, admins: 2, read_groups: 1, write_groups: 0, admin_groups: 1, last_seen_at: '2026-10-14T12:00:00Z' },
      { id: '11', name: 'Reader', reported_user_count: 0, last_edited: null, api_groups_total: 1, admins: 0, read_groups: 1, write_groups: 0, admin_groups: 0, last_seen_at: '2026-10-14T12:00:00Z' },
    ] } });
  });
  await page.goto('/netskope/admins');
  const section = page.getByRole('region', { name: 'Administradores de Netskope', exact: true });
  await section.getByRole('tab', { name: 'Roles' }).click();
  await expect(section.getByText('No se pudieron cargar los roles')).toBeVisible();
  await section.getByRole('button', { name: 'Reintentar' }).click();
  await expect(section.getByRole('row', { name: /Reader/ })).toContainText('Ninguno');
  await expect(section.getByRole('row', { name: /Tenant Admin/ })).toContainText('2');
});
