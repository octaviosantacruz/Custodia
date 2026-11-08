import { expectSystemSearch } from '../../support/search-control';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, mockAuthenticatedApp, test } from '../../support/fixtures';

type SiaLink = {
  value: string;
  identity?: { status: 'matched' | 'ambiguous' | 'unmatched'; match?: { object_id: number; display_name: string } };
  pam?: { status: 'matched' | 'ambiguous' | 'unmatched'; match?: { object_id: number; display_name: string } };
};

async function routeSiaPolicy(page: Page, options: {
  grantedUsers?: string[];
  links?: SiaLink[];
  ruleNames?: string[];
  onRequest?: () => void;
} = {}) {
  const grantedUsers = options.grantedUsers ?? ['person@example.test'];
  await page.route('**/api/cmdb/sia-policies*', (route) => {
    options.onRequest?.();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        rows: [{
          object_id: 321,
          display_name: 'Recipients policy',
          source_id: 'policy-321',
          attributes: {
            status: 'Enabled', description: 'Policy detail for recipient links', platforms: ['OnPrem'],
            rule_names: options.ruleNames ?? ['Rule Alpha'], policy_type: 'DB',
            granted_users: grantedUsers, granted_groups: ['Operators'], granted_roles: ['Database Reader'],
            ip_rules: [], fqdn_rules: [], logical_names: [],
          },
          grantee_links: options.links ?? [],
          linked_safes: [], linkage_status: 'unlinked',
        }],
        total: 1, limit: 50, offset: 0,
      }),
    });
  });
}

async function openSiaRecipientDetail(page: Page) {
  await page.goto('/pam/sia');
  await expect(page.getByRole('heading', { name: 'SIA', exact: true, level: 1 })).toBeVisible();
  await page.getByRole('row', { name: /Recipients policy/ })
    .getByRole('button', { name: 'Ver detalle de Recipients policy' }).click();
  await expect(page.locator('.sia-grantee-detail')).toBeVisible();
}

test('SIA exposes persisted destinations by policy and asset type', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/sia');
  await expect(page.getByRole('heading', { name: 'SIA', exact: true, level: 1 })).toBeVisible();
  await page.getByRole('row', { name: /Finance access/ }).getByRole('button', { name: /Ver detalle de Finance access/ }).click();
  await expect(page.getByRole('dialog').getByText('10.67.10.186', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Finance access', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Por IP', { exact: true })).toBeVisible();
});

test('SIA recipient detail summarizes both authorized sides and keeps name references in the row', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'identity:catalogs_read', 'pam:catalogs_read'] });
  await routeSiaPolicy(page, {
    links: [
      { value: 'ada@example.test', identity: { status: 'matched', match: { object_id: 41, display_name: 'Ada Identity' } }, pam: { status: 'ambiguous' } },
      { value: 'bea@example.test', identity: { status: 'ambiguous' }, pam: { status: 'matched', match: { object_id: 42, display_name: 'Bea PAM' } } },
      { value: 'cy@example.test', identity: { status: 'unmatched' }, pam: { status: 'unmatched' } },
    ],
  });
  await openSiaRecipientDetail(page);

  const detail = page.locator('.sia-grantee-detail');
  await expect(detail.getByRole('heading', { name: 'Destinatarios', exact: true })).toBeVisible();
  await expect(detail.getByText('Identity Administration: vinculados 1 · ambiguos 1 · sin coincidencia 1 de 3 destinatarios', { exact: true })).toBeVisible();
  await expect(detail.getByText('PAM: vinculados 1 · ambiguos 1 · sin coincidencia 1 de 3 destinatarios', { exact: true })).toBeVisible();
  await expect(detail.getByText('Conteos de esta política; no son un KPI de cobertura.')).toBeVisible();
  await expect(detail.getByRole('heading', { name: 'Vínculos por correo exacto' })).toBeVisible();
  await expect(detail.getByRole('heading', { name: 'Referencia por nombre' })).toBeVisible();
  await expect(detail.getByText('Vinculado por correo', { exact: true }).first()).toBeVisible();
  await expect(detail.getByRole('button', { name: /Operators.*referencia por nombre/ })).toBeVisible();

  const emailRows = detail.getByRole('list', { name: 'Destinatarios vinculados por correo exacto' }).getByRole('listitem');
  await expect(emailRows).toHaveCount(3);
  for (const value of ['ada@example.test', 'bea@example.test', 'cy@example.test']) {
    const row = emailRows.filter({ hasText: value });
    await expect(row.locator('a, button')).toHaveCount(0);
  }
  await expect(emailRows.filter({ hasText: 'bea@example.test' })).toContainText('Ambiguo: más de un candidato');
  await expect(emailRows.filter({ hasText: 'cy@example.test' })).toContainText('Sin coincidencia');
  await expect(detail.getByText('Reglas de acceso', { exact: true })).toHaveCount(0);

  const sidebar = page.getByRole('dialog', { name: 'Recipients policy' });
  await expect(sidebar.getByText('Targets declarados')).toBeVisible();
  await expect(sidebar.getByText('Reglas de acceso')).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'Buscar coincidencia en Safes' })).toBeVisible();
  await expect(sidebar.getByRole('heading', { name: 'Vínculos por correo exacto' })).toHaveCount(1);
  await expect(sidebar.getByRole('button', { name: /Operators.*referencia por nombre/ })).toHaveCount(1);
  await expect(page.locator('table .sia-grantee-detail')).toHaveCount(0);
  await expect(sidebar.getByText('Rule Alpha', { exact: true })).toHaveCount(1);
});

test('SIA recipient links never name a source omitted from an Identity-only response', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'identity:catalogs_read'] });
  await routeSiaPolicy(page, { links: [{ value: 'ada@example.test', identity: { status: 'matched', match: { object_id: 41, display_name: 'Ada Identity' } } }] });
  await openSiaRecipientDetail(page);

  const detail = page.locator('.sia-grantee-detail');
  await expect(detail.getByText('Identity Administration: vinculados 1 · ambiguos 0 · sin coincidencia 0 de 1 destinatarios', { exact: true })).toBeVisible();
  await expect(detail).not.toContainText('PAM');
  await expect(detail).not.toContainText(/sin acceso|omitid/i);
  await expect(detail.getByRole('button', { name: 'Filtrar destinatarios por fuente' })).toHaveCount(0);
});

test('SIA recipient links never name a source omitted from a PAM-only response', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'pam:catalogs_read'] });
  await routeSiaPolicy(page, { links: [{ value: 'ada@example.test', pam: { status: 'unmatched' } }] });
  await openSiaRecipientDetail(page);

  const detail = page.locator('.sia-grantee-detail');
  await expect(detail.getByText('PAM: vinculados 0 · ambiguos 0 · sin coincidencia 1 de 1 destinatarios', { exact: true })).toBeVisible();
  await expect(detail).not.toContainText('Identity');
  await expect(detail).not.toContainText(/sin acceso|omitid/i);
  await expect(detail.getByRole('button', { name: 'Filtrar destinatarios por fuente' })).toHaveCount(0);
});

test('SIA without any returned authorized side shows name references without a link or permission hint', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'] });
  await routeSiaPolicy(page, { links: [{ value: 'person@example.test' }] });
  await openSiaRecipientDetail(page);

  const detail = page.locator('.sia-grantee-detail');
  await expect(detail.getByRole('heading', { name: 'Referencia por nombre' })).toBeVisible();
  await expect(detail.getByRole('heading', { name: 'Vínculos por correo exacto' })).toHaveCount(0);
  await expect(detail).not.toContainText(/Identity Administration|PAM|sin acceso|omitid/i);
  await expect(detail.getByRole('button', { name: /Operators.*referencia por nombre/ })).toBeVisible();
});

test('SIA recipient filters stay local and paginate long lists in explicit chunks of 25 (UX-AUD2-024)', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'identity:catalogs_read', 'pam:catalogs_read'] });
  let policyRequests = 0;
  const statuses = ['matched', 'ambiguous', 'unmatched'] as const;
  const links: SiaLink[] = Array.from({ length: 60 }, (_, index) => ({
    value: `recipient-${String(index).padStart(3, '0')}@example.test`,
    identity: { status: statuses[index % statuses.length] },
    pam: { status: index % 2 === 0 ? 'matched' : 'unmatched' },
  }));
  await routeSiaPolicy(page, { links, onRequest: () => { policyRequests += 1; } });
  await openSiaRecipientDetail(page);
  const initialPolicyRequests = policyRequests;

  const detail = page.locator('.sia-grantee-detail');
  const rows = detail.getByRole('list', { name: 'Destinatarios vinculados por correo exacto' }).getByRole('listitem');
  await expect(detail.locator('.sia-grantee-count')).toHaveText('60 de 60 destinatarios');
  await expect(rows).toHaveCount(25);
  await page.getByRole('button', { name: 'Mostrar 25 más' }).click();
  await expect(rows).toHaveCount(50);

  const textFilter = detail.getByRole('searchbox', { name: 'Filtrar destinatarios por valor' });
  await expectSystemSearch(textFilter);
  await textFilter.fill('RECIPIENT-059');
  await expect(detail.locator('.sia-grantee-count')).toHaveText('1 de 60 destinatarios');
  await expect(detail.getByText('Identity Administration: vinculados 20 · ambiguos 20 · sin coincidencia 20 de 60 destinatarios', { exact: true })).toBeVisible();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('recipient-059@example.test');

  await textFilter.fill('');
  await expect(rows).toHaveCount(25);
  await page.getByRole('button', { name: 'Mostrar 25 más' }).click();
  await expect(rows).toHaveCount(50);
  await page.getByRole('button', { name: 'Mostrar 10 más' }).click();
  await expect(rows).toHaveCount(60);

  const statusFilter = detail.getByRole('button', { name: 'Filtrar destinatarios por estado' });
  await statusFilter.click();
  await page.getByRole('option', { name: 'Vinculados', exact: true }).click();
  await expect(detail.locator('.sia-grantee-count')).toHaveText('40 de 60 destinatarios');
  await expect(rows).toHaveCount(25);
  const sourceFilter = detail.getByRole('button', { name: 'Filtrar destinatarios por fuente' });
  await sourceFilter.click();
  await page.getByRole('option', { name: 'PAM', exact: true }).click();
  await expect(detail.locator('.sia-grantee-count')).toHaveText('30 de 60 destinatarios');
  await expect(rows).toHaveCount(25);
  await expect(rows.filter({ hasText: 'recipient-003@example.test' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Mostrar 5 más' }).click();
  await expect(rows).toHaveCount(30);

  await textFilter.fill('no-such-recipient');
  await expect(detail.locator('.sia-grantee-count')).toHaveText('0 de 60 destinatarios');
  await expect(detail.getByText('Ningún destinatario coincide con los filtros')).toBeVisible();
  await detail.getByRole('button', { name: 'Limpiar filtros' }).click();
  await expect(textFilter).toHaveValue('');
  await expect(detail.getByRole('button', { name: 'Filtrar destinatarios por estado' })).toHaveText('Todos');
  await expect(detail.getByRole('button', { name: 'Filtrar destinatarios por fuente' })).toHaveText('Todas');
  await expect(detail.locator('.sia-grantee-count')).toHaveText('60 de 60 destinatarios');
  await expect(rows).toHaveCount(25);
  await expect(detail.getByText('Identity Administration: vinculados 20 · ambiguos 20 · sin coincidencia 20 de 60 destinatarios', { exact: true })).toBeVisible();
  expect(policyRequests).toBe(initialPolicyRequests);
});

test('SIA recipient controls work with Enter and avoid document overflow on desktop themes and sizes', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'identity:catalogs_read', 'pam:catalogs_read'] });
  const links: SiaLink[] = Array.from({ length: 60 }, (_, index) => ({
    value: `recipient-${String(index).padStart(3, '0')}@example.test`,
    identity: { status: index % 3 === 1 ? 'ambiguous' : 'matched' },
    pam: { status: 'unmatched' },
  }));
  await routeSiaPolicy(page, { links });
  await page.goto('/pam/sia');
  const expandButton = page.getByRole('row', { name: /Recipients policy/ })
    .getByRole('button', { name: 'Ver detalle de Recipients policy' });
  await expandButton.focus();
  await page.keyboard.press('Enter');
  const detail = page.locator('.sia-grantee-detail');
  await expect(detail).toBeVisible();

  const textFilter = detail.getByRole('searchbox', { name: 'Filtrar destinatarios por valor' });
  const statusFilter = detail.getByRole('button', { name: 'Filtrar destinatarios por estado' });
  const sourceFilter = detail.getByRole('button', { name: 'Filtrar destinatarios por fuente' });
  await textFilter.focus();
  await page.keyboard.press('Tab');
  await expect(statusFilter).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(sourceFilter).toBeFocused();
  await page.keyboard.press('Tab');
  const more = detail.getByRole('button', { name: 'Mostrar 25 más' });
  await expect(more).toBeFocused();
  await page.keyboard.press('Enter');
  const rows = detail.getByRole('list', { name: 'Destinatarios vinculados por correo exacto' }).getByRole('listitem');
  await expect(rows).toHaveCount(50);

  await textFilter.focus();
  await page.keyboard.insertText('recipient-001');
  await expect(detail.locator('.sia-grantee-count')).toHaveText('1 de 60 destinatarios');
  await statusFilter.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(detail.locator('.sia-grantee-count')).toHaveText('1 de 60 destinatarios');
  await sourceFilter.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(detail.locator('.sia-grantee-count')).toHaveText('1 de 60 destinatarios');

  const drawer = page.locator('.sia-policy-drawer');
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    for (const theme of ['dark', 'light']) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      const width = await page.evaluate(() => ({
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      expect(width.scroll).toBeLessThanOrEqual(width.client);
      const scroll = await drawer.evaluate((element) => ({ width: element.clientWidth, scrollWidth: element.scrollWidth, height: element.clientHeight, scrollHeight: element.scrollHeight }));
      expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.width);
      expect(scroll.scrollHeight).toBeGreaterThan(scroll.height);
      await drawer.hover();
      await page.mouse.wheel(0, 400);
      await expect.poll(() => drawer.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      const axe = await new AxeBuilder({ page }).include('.sia-policy-drawer').analyze();
      expect(axe.violations).toEqual([]);
    }
  }
});

test('SIA shows all connection states on initial load', async ({ page }) => {
  let siaRequest: URL | null = null;
  page.on('request', (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.pathname === '/api/cmdb/sia-policies') siaRequest = requestUrl;
  });

  await mockAuthenticatedApp(page);
  await page.goto('/pam/sia');

  await expect(page.getByRole('heading', { name: 'SIA', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Filtrar políticas SIA por vinculación con Safes' })).toHaveText('Todas las vinculaciones');
  await expect.poll(() => siaRequest?.searchParams.get('linkage_status')).toBe('');
});

test('SIA policy search is debounced instead of firing one request per keystroke', async ({ page }) => {
  let requestCount = 0;
  await mockAuthenticatedApp(page, {
    onRequest: (pathname) => { if (pathname === '/api/cmdb/sia-policies') requestCount += 1; },
  });
  await page.goto('/pam/sia');
  await expect(page.getByRole('searchbox', { name: 'Buscar políticas SIA por nombre o descripción' })).toBeVisible();
  await expect.poll(() => requestCount).toBeGreaterThan(0);
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
  await expect(page.getByRole('heading', { name: 'SIA', exact: true, level: 1 })).toBeVisible();

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

test('SIA hub has one row of authorized destinations navigable with the keyboard', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/sia');

  const siaNav = page.getByRole('tablist', { name: 'Secciones de SIA' });
  await expect(siaNav.getByRole('tab', { name: /Políticas.*Accesos definidos, usuarios y destinos/ })).toHaveAttribute('aria-selected', 'true');
  await expect(siaNav.getByRole('tab', { name: /Máquinas virtuales SIA.*Equipos disponibles/ })).toBeVisible();
  await expect(siaNav.getByRole('tab', { name: /Cobertura|Target sets|Activos de Access/ })).toHaveCount(0);

  await siaNav.getByRole('tab', { name: /Políticas.*Accesos definidos, usuarios y destinos/ }).focus();
  // Roving tablist with automatic activation: one ArrowRight moves to and
  // activates the virtual-machine destination.
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/\/pam\/sia\/resources$/);
  await expect(siaNav.getByRole('tab', { name: /Máquinas virtuales SIA.*Equipos disponibles/ })).toHaveAttribute('aria-selected', 'true');
});

test('SIA presents only policies, VMs and database accounts, plus a link to connectors', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/sia/resources');

  const resourceNav = page.getByRole('tablist', { name: 'Secciones de SIA' });
  await expect(resourceNav.getByRole('tab', { name: /Máquinas virtuales/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('web-01', { exact: true })).toBeVisible();

  await resourceNav.getByRole('tab', { name: /Cuentas de base de datos/ }).click();
  await expect(page).toHaveURL(/\/pam\/sia\/database-accounts$/);
  await expect(page.getByText('app-db-account', { exact: true })).toBeVisible();

  await expect(resourceNav.getByRole('tab')).toHaveText(['Políticas', 'Máquinas virtuales SIA', 'Cuentas de base de datos']);

  await page.getByRole('button', { name: 'Ver conectores SIA' }).click();
  await expect(page).toHaveURL(/\/pam\/connectors$/);
});

test('reloading database accounts keeps its canonical destination selected', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/sia/database-accounts');

  const siaNav = page.getByRole('tablist', { name: 'Secciones de SIA' });
  const resourceNav = page.getByRole('tablist', { name: 'Secciones de SIA' });
  await expect(resourceNav.getByRole('tab', { name: /Cuentas de base de datos/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('app-db-account', { exact: true })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\/pam\/sia\/database-accounts$/);
  await expect(resourceNav.getByRole('tab', { name: /Cuentas de base de datos/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('app-db-account', { exact: true })).toBeVisible();
});

test('retired SIA target-set and Access asset links land on supported destinations', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'sia:catalogs_read', 'pam:catalogs_read'] });
  await page.goto('/pam/sia/target-sets');
  await expect(page).toHaveURL(/\/pam\/sia\/resources$/);
  await expect(page.getByText('web-01', { exact: true })).toBeVisible();
  await page.goto('/pam/access-assets');
  await expect(page).toHaveURL(/\/pam\/assets$/);
  await expect(page.getByRole('heading', { name: 'Cobertura', exact: true, level: 1 })).toBeVisible();
});

test('Inventario is its own CyberArk destination, outside the SIA tabs', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/assets');

  await expect(page.getByRole('heading', { name: 'Cobertura', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Secciones de SIA' })).toHaveCount(0);
  await expect(page.getByText('dev-compute-db-desa', { exact: true })).toBeVisible();
});

test('the Recursos tab is hidden without any resource permission, and its direct routes redirect into the SIA hub', async ({ page }) => {
  // IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §6: a tab without
  // permission never shows, and a direct link to it redirects instead of
  // rendering a blocked/empty pane. Políticas never requires
  // access:manage; only the Recursos sources do (each keeps its own
  // narrow permission, see below).
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'] });
  await page.goto('/pam/sia');

  const siaNav = page.getByRole('tablist', { name: 'Secciones de SIA' });
  await expect(siaNav.getByRole('tab', { name: /Políticas/ })).toBeVisible();
  await expect(siaNav.getByRole('tab', { name: /Máquinas virtuales|Cuentas de base de datos/ })).toHaveCount(0);

  await page.goto('/pam/sia/resources');
  await expect(page).toHaveURL(/\/pam\/sia$/);
  await expect(siaNav.getByRole('tab', { name: /Máquinas virtuales|Cuentas de base de datos/ })).toHaveCount(0);
});

test('an actor with only sia:catalogs_read can still reach SIA resources and database accounts', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'sia:catalogs_read'] });
  await page.goto('/pam/sia/resources');

  const resourceNav = page.getByRole('tablist', { name: 'Secciones de SIA' });
  await expect(resourceNav.getByRole('tab', { name: /Máquinas virtuales/ })).toHaveAttribute('aria-selected', 'true');
  await expect(resourceNav.getByRole('tab', { name: /Cuentas de base de datos/ })).toBeVisible();
  await expect(page.getByText('web-01', { exact: true })).toBeVisible();
});

test('SIA navigation remains accessible in policy and resource destinations', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/sia');
  await expect(page.getByRole('tablist', { name: 'Secciones de SIA' })).toBeVisible();
  const topTabsResults = await new AxeBuilder({ page }).include('.sia-hub-workspace > .workspace-subnav').analyze();
  expect(topTabsResults.violations).toEqual([]);

  await page.goto('/pam/sia/resources');
  await expect(page.getByText('web-01', { exact: true })).toBeVisible();
  const resourceTabsResults = await new AxeBuilder({ page }).include('.sia-hub-workspace > .workspace-subnav').analyze();
  expect(resourceTabsResults.violations).toEqual([]);
});

test('UX-AUD2-019: VM context preserves unusual types and locations on later pages without separate columns', async ({ page }, testInfo) => {
  await mockAuthenticatedApp(page);
  await page.route('**/api/cmdb/sia-resources?*', route => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset'));
    return route.fulfill({ json: { rows: Array.from({ length: offset ? 1 : 100 }, (_, index) => ({ object_id: offset + index + 1, source_id: 'vm-' + (offset + index), display_name: offset ? 'Later VM' : index ? `Peer vm ${index}` : 'First VM', attributes: { resource_type: offset ? 'cloud_instance' : 'virtual_machine', location_type: offset ? 'Cloud region' : 'FQDN/IP', os_type: 'Linux', discovery_engine: 'Discovery' } })), total: 101, limit: 100, offset } });
  });
  await page.goto('/pam/sia/resources');
  await expect(page.locator('html')).toHaveAttribute('data-theme', testInfo.project.use.colorScheme === 'light' ? 'light' : 'dark');
  await expect(page.getByRole('row', { name: /First VM/ })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /^(Tipo|Ubicación)$/ })).toHaveCount(0);
  await expect(page.getByRole('row', { name: /First VM/ })).toContainText('FQDN/IP');
  await page.getByRole('button', { name: /Cargar \d+ más/ }).click();
  const later = page.getByRole('row', { name: /Later VM/ });
  await expect(later.getByRole('cell').first()).toContainText('cloud instance');
  await expect(later).toContainText('Cloud region');
});

test('FE-AUD-003: Inventario never shows "(0)" for a failed or pending summary and recovers its counts', async ({ page }) => {
  await mockAuthenticatedApp(page);
  let calls = 0;
  const totals = { total: 7, both: 3, pam_only: 4, sia_only: 0, none: 0, zsp_implemented: 0, zsp_pending: 0, zsp_unknown: 0 };
  await page.route('**/api/analytics/executive*', (route) => {
    calls += 1;
    if (calls === 1) return route.fulfill({ status: 503, json: { detail: 'Unavailable' } });
    return route.fulfill({ json: { connection_coverage: { totals, by_environment: [{ ...totals, environment: 'PROD' }], import: null }, access_concentration: { items: [], total: 0 } } });
  });
  await page.goto('/pam/assets');
  await expect(page.getByText('dev-compute-db-desa', { exact: true })).toBeVisible();
  const coverage = page.getByRole('button', { name: 'Filtrar por cobertura' });
  await expect(page.getByText('Conteos no disponibles')).toBeVisible();
  await expect(coverage).toContainText('Toda cobertura');
  await expect(coverage).not.toContainText('(0)');
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(coverage).toContainText('Toda cobertura (7)');
  await expect(page.getByText('Conteos no disponibles')).toHaveCount(0);
});
