import { expectSystemSearch } from '../support/search-control';
import AxeBuilder from '@axe-core/playwright';
import type { Locator } from '@playwright/test';
import { expect, mockAuthenticatedApp, test } from '../support/fixtures';
import { expectAtomicCellText } from '../support/cell-geometry';

/* UX-AUD-001: `.workspace-shell` used to retain `transform: translateX(0)`
   after its entrance animation (`animation-fill-mode: both`), which makes
   <main> the containing block of every `position: fixed` descendant. Drawers
   and modals inside a workspace were then positioned against <main> instead
   of the viewport. This is the regression for the CSS fix. */
test('UX-AUD-001: workspace drawers are positioned against the viewport, not <main>', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 360 });
  await mockAuthenticatedApp(page, { includeSafe: true, largeInventory: true });
  await page.goto('/pam/safes');

  const firstSafe = page.locator('.safe-name').filter({ hasText: 'Finance' }).first();
  await expect(firstSafe).toBeVisible();
  await firstSafe.click();

  const layer = page.locator('.drawer-layer');
  await expect(layer).toBeVisible();
  await layer.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));

  const viewport = page.viewportSize()!;
  const rect = await layer.boundingBox();
  expect(rect).not.toBeNull();
  expect({ x: rect!.x, y: rect!.y, width: rect!.width, height: rect!.height }).toEqual({
    x: 0, y: 0, width: viewport.width, height: viewport.height,
  });

  // The panel scrolls internally instead of leaking the wheel to the page.
  const drawer = page.locator('.detail-drawer');
  const metrics = await drawer.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  expect(metrics.scrollHeight, `drawer content (${metrics.scrollHeight}px) must overflow its ${metrics.clientHeight}px viewport`).toBeGreaterThan(metrics.clientHeight);
  await drawer.hover();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 120);
  await expect.poll(() => drawer.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

  // Any page scroll keeps the fixed layer and its close button in view.
  await page.evaluate(() => window.scrollTo(0, 500));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const scrolledRect = await layer.boundingBox();
  expect(scrolledRect).not.toBeNull();
  expect(scrolledRect!.y).toBe(0);
  await expect(page.getByRole('button', { name: 'Cerrar', exact: true })).toBeVisible();
});

/* UX-AUD-002: the command center declares aria-modal="true" but had no focus
   trap: Tab eventually escaped to the workspace switcher in the header. This
   is the regression for adopting useDialogFocusTrap. */
test('UX-AUD-002: the command center traps focus and Escape returns it to the trigger', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam');

  const trigger = page.getByRole('button', { name: 'Abrir command center' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Command center' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Buscar inventario, herramientas y acciones' })).toBeFocused();

  const focusables = dialog.locator('button:not([disabled]), input:not([disabled])');
  const focusableCount = await focusables.count();
  expect(focusableCount).toBeGreaterThan(2);
  for (let step = 0; step < focusableCount + 2; step += 1) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => Boolean(document.activeElement?.closest('.global-search-layer')));
    expect(inside, `Tab ${step + 1} escaped the command center`).toBe(true);
  }
  await page.keyboard.press('Shift+Tab');
  const insideBackwards = await page.evaluate(() => Boolean(document.activeElement?.closest('.global-search-layer')));
  expect(insideBackwards).toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

/* UX-AUD-003: full-screen overlay layers were not scroll containers, so a
   wheel over the backdrop chained to the document and left the page scrolled
   after closing. The layers now contain their overscroll. */
test('UX-AUD-003: a wheel over a full-screen overlay backdrop never scrolls the page', async ({ page }) => {
  await mockAuthenticatedApp(page, { includeSafe: true, largeInventory: true });
  await page.goto('/pam/safes');
  await expect(page.locator('.safe-name').filter({ hasText: 'Finance' }).first()).toBeVisible();
  // The page must be genuinely scrollable for this regression to mean anything.
  expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)).toBe(true);

  const scrollY = () => page.evaluate(() => window.scrollY);
  const wheelOverBackdrop = async () => {
    // The top-left corner is backdrop in every one of these overlays.
    await page.mouse.move(8, 8);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(120);
  };

  // Command center, starting from the top so the wheel has room to leak.
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Command center' });
  await expect(dialog).toBeVisible();
  const beforeCommand = await scrollY();
  await wheelOverBackdrop();
  expect(await scrollY(), 'the command center backdrop leaked the wheel to the page').toBe(beforeCommand);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // Safe drawer: the panel owns its internal scroll, the backdrop owns nothing.
  await page.locator('.safe-name').filter({ hasText: 'Finance' }).first().click();
  await expect(page.locator('.drawer-layer')).toBeVisible();
  const beforeDrawer = await scrollY();
  await wheelOverBackdrop();
  expect(await scrollY(), 'the Safe drawer backdrop leaked the wheel to the page').toBe(beforeDrawer);
  await page.keyboard.press('Escape');
  await expect(page.locator('.drawer-layer')).toHaveCount(0);

  // "Mi cuenta" modal (the audit's already-correct contrast case).
  await page.getByRole('button', { name: 'Abrir menú de usuario' }).click();
  await page.getByRole('button', { name: 'Mi cuenta' }).click();
  await expect(page.getByRole('dialog', { name: 'Datos personales' })).toBeVisible();
  const beforeProfile = await scrollY();
  await wheelOverBackdrop();
  expect(await scrollY(), 'the account modal backdrop leaked the wheel to the page').toBe(beforeProfile);
});

/* UX-AUD-004: Escape used to close a popover with focus inside it and leave
   focus on <body>, because usePopover never restored it. */
test('UX-AUD-004: Escape returns focus to the trigger of every popover', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam');

  const escapeFromPopover = async (trigger: Locator, popover: Locator) => {
    await trigger.click();
    await expect(popover).toBeVisible();
    const focusable = popover.locator('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])').first();
    if (await focusable.count()) {
      await focusable.focus();
      expect(await popover.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);
    await expect(trigger).toBeFocused();
  };

  // Workspace switcher: the audit's named reproduction (focus inside → Escape → BODY).
  await escapeFromPopover(page.getByRole('button', { name: /Cambiar workspace/ }), page.getByRole('region', { name: 'Workspaces' }));
  // Tool switcher.
  await escapeFromPopover(page.getByRole('button', { name: /Cambiar herramienta/ }), page.getByRole('region', { name: 'Herramientas' }));
  // Profile menu.
  await escapeFromPopover(page.getByRole('button', { name: 'Abrir menú de usuario' }), page.getByRole('region', { name: 'Menú de usuario' }));
  // Dashboard presets.
  await escapeFromPopover(page.getByRole('button', { name: 'Vistas iniciales' }), page.getByRole('menu', { name: 'Vistas iniciales' }));
  // Notification menu has no focusable content: smoke check that Escape never
  // leaves focus behind.
  await escapeFromPopover(page.getByRole('button', { name: 'Abrir notificaciones' }), page.getByRole('region', { name: 'Notificaciones' }));

  // «Nuevo rol» opens the role editor directly; there is no create menu to escape from.

  // "Mi cuenta": the menu item that opened the modal is unmounted, so closing
  // must fall back to the profile trigger instead of <body>.
  const profileTrigger = page.getByRole('button', { name: 'Abrir menú de usuario' });
  await profileTrigger.click();
  await page.getByRole('button', { name: 'Mi cuenta' }).click();
  const profileDialog = page.getByRole('dialog', { name: 'Datos personales' });
  await expect(profileDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(profileDialog).toHaveCount(0);
  await expect(profileTrigger).toBeFocused();
});

/* UX-AUD-005: `.compact-table-wrap`/`.activity-table-wrap` had no bounded
   height, so they never scrolled vertically and their sticky `thead` scrolled
   away with the page. Safes additionally lost its max-height on phones. */
const STICKY_VIEWPORTS = [
  { width: 1440, height: 900 }, { width: 1280, height: 720 },
  { width: 768, height: 1024 }, { width: 390, height: 844 },
];

for (const viewport of STICKY_VIEWPORTS) {
  test(`UX-AUD-005: sticky table headers stay visible at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockAuthenticatedApp(page, { includeSafe: true });
    const many = (count: number, build: (index: number) => Record<string, unknown>) =>
      Array.from({ length: count }, (_, index) => build(index));

    await page.route('**/api/safes**', async (route) => {
      if (new URL(route.request().url()).pathname !== '/api/safes') { await route.fallback(); return; }
      const rows = many(60, (index) => ({
        safe_number: index + 1, safe_name: `Safe ${index + 1}`, safe_url_id: `Safe-${index + 1}`,
        location: null, member_count: 1, account_count: 1, cpm_configured: true, olac_enabled: true,
        retention_configured: true, manage_safe_principal_count: 1, account_type_counts: {},
        internal_name: null, business_unit_id: null, responsible_id: null,
        classification_status: 'pending', inventory_scope: 'pending', data_quality_status: 'pending',
        scope_hint: null, business_unit_name: null, responsible_name: null,
        workflow_status: 'pending', next_action: null,
      }));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows, total: rows.length, classification_counts: { assigned: 0, review: 0, pending: rows.length }, limit: 50, offset: 0 }) });
    });
    await page.route('**/api/cmdb/identity-users**', async (route) => {
      const rows = many(60, (index) => ({
        object_id: 1000 + index, display_name: `Identity User ${index}`, source_id: `id-${index}`,
        attributes: { user_name: `user${index}@example.test`, email: `user${index}@example.test`, active: true, service_user: false, oauth_client: false, last_login_date: '', last_modified: '2026-09-09T00:00:00Z' },
        role_count: 1, standard_seat_reconciled: false, federation_resolution: null,
      }));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows, total: rows.length, limit: 50, offset: 0, search: '', active_filter: 'active', standard_seat: '' }) });
    });
    await page.route('**/api/activity**', async (route) => {
      const rows = many(60, (index) => ({
        audit_id: 1000 + index, actor_id: 'operator-1', actor_name: 'Operador', action: 'update',
        entity_type: 'safe_metadata', entity_id: String(index), entity_name: `Safe ${index}`,
        before_data: null, after_data: { workflow_status: 'in_progress' }, created_at: '2026-08-29T00:00:00Z',
      }));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows, total: rows.length, limit: 50, offset: 0 }) });
    });
    await page.route('**/api/cmdb/pam-platforms**', async (route) => {
      const rows = many(60, (index) => ({
        object_id: 2000 + index, display_name: `Platform ${index}`, source_id: `platform-${index}`,
        system_type: 'Unix', active: true, allowed_safes_pattern: `^Platform-${index}`, safe_count: 1, account_count: 2, psms: [],
      }));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows, total: rows.length, limit: 100, offset: 0, search: '' }) });
    });

    const cases = [
      { path: '/pam/safes', wrapper: '.database-surface .table-wrap', header: '.safe-table thead th' },
      { path: '/pam/identity', wrapper: '.compact-table-wrap', header: '.compact-table thead th' },
      { path: '/admin/activity', wrapper: '.activity-table-wrap', header: '.activity-table thead th' },
      { path: '/pam/platforms', wrapper: '.compact-table-wrap', header: '.compact-table thead th' },
    ];

    for (const item of cases) {
      await page.goto(item.path);
      const wrapper = page.locator(item.wrapper).first();
      await expect(wrapper.locator('tbody tr').first()).toBeVisible();
      const topbar = page.locator('.topbar');
      const topbarHeight = (await topbar.boundingBox())?.height ?? 68;
      await wrapper.evaluate((element, offset) => {
        const top = element.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo(0, Math.max(0, top));
      }, topbarHeight + 8);
      const context = `${item.path} @${viewport.width}x${viewport.height}`;
      await expect.poll(
        () => wrapper.evaluate((element) => element.scrollHeight > element.clientHeight),
        { message: `${context}: the wrapper must be vertically scrollable` },
      ).toBe(true);
      await wrapper.hover();
      await page.mouse.wheel(0, 600);
      await expect.poll(() => wrapper.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      const topbarBox = await topbar.boundingBox();
      const headerBox = await wrapper.locator(item.header).first().boundingBox();
      const wrapperBox = await wrapper.boundingBox();
      expect(headerBox, `${context}: sticky header cell must be measurable`).not.toBeNull();
      expect(headerBox!.y, `${context}: sticky header must stay below the topbar`).toBeGreaterThanOrEqual(topbarBox!.y + topbarBox!.height - 1);
      expect(headerBox!.y, `${context}: sticky header must stay at the wrapper top`).toBeLessThanOrEqual(wrapperBox!.y + 1);
    }
  });
}

/* UX-AUD-006: `.filter-row > label` used #63707d (3.69:1 on the dark elevated
   surface, axe serious). It now uses the shared --text-secondary token. */
test('UX-AUD-006: admin filter labels meet WCAG AA contrast', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/admin/access');
  await expect(page.getByRole('button', { name: 'Todos los roles Filtrar por rol' })).toBeVisible();

  const ratio = await page.getByRole('button', { name: 'Todos los roles Filtrar por rol' }).evaluate((element) => {
    const channel = (value: number) => {
      const normalized = value / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    const parseColor = (value: string) => {
      const trimmed = value.trim();
      if (trimmed.startsWith('#')) {
        const normalized = trimmed.length === 4
          ? trimmed.slice(1).split('').map((character) => character + character).join('')
          : trimmed.slice(1, 7);
        return [0, 2, 4].map((index) => Number.parseInt(normalized.slice(index, index + 2), 16));
      }
      return (trimmed.match(/\d+/g) ?? []).slice(0, 3).map(Number);
    };
    const luminance = (value: string) => {
      const [red, green, blue] = parseColor(value);
      return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
    };
    const root = getComputedStyle(document.documentElement);
    const foreground = luminance(getComputedStyle(element).color);
    const background = luminance(root.getPropertyValue('--bg-elevated'));
    const lighter = Math.max(foreground, background);
    const darker = Math.min(foreground, background);
    return (lighter + 0.05) / (darker + 0.05);
  });
  expect(ratio, `filter label contrast is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);

  const results = await new AxeBuilder({ page })
    .include('.user-directory-toolbar')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations.filter((violation) => violation.id === 'color-contrast')).toEqual([]);
});

/* UX-AUD-007: expandable rows used aria-expanded/aria-label/tabIndex on <tr>,
   which axe rejects for plain tables and which replaced the row's cell
   contents as its accessible name. The expansion now lives in a real button
   inside the first cell. */
test('UX-AUD-007: expandable rows use a button and expose their columns', async ({ page }) => {
  await mockAuthenticatedApp(page, { includeSafe: true });
  const routes = [
    { path: '/pam/sia', rowName: /Finance access.*Habilitada/ },
    { path: '/admin/activity', rowName: /Safe Metadata.*Operador/ },
    { path: '/pam/identity', rowName: /Ada Identity.*ada@itti\.digital/ },
    { path: '/pam/roles', rowName: /Operations.*42/ },
    { path: '/pam/assets', rowName: /dev-compute-db-desa.*10\.67\.9\.143/ },
  ];

  for (const route of routes) {
    await page.goto(route.path);
    const row = page.getByRole('row', { name: route.rowName }).first();
    await expect(row, `${route.path}: the row name must include its columns`).toBeVisible();
    await expect(row).not.toHaveAttribute('aria-expanded');
    await expect(row).not.toHaveAttribute('tabindex');

    const button = row.locator('.row-expand-button');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    const controls = await button.getAttribute('aria-controls');
    expect(controls, `${route.path}: the expand button needs aria-controls`).toBeTruthy();
    await expect(page.locator(`#${controls}`)).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include('table')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations.filter((violation) => violation.id === 'aria-conditional-attr'), `${route.path} axe`).toEqual([]);
  }
});

/* UX-AUD-008: with the full quick-access catalog the editor was taller than the
   menu, leaving Guardar/Cancelar off-screen until the user scrolled. The
   actions row is now sticky at the bottom of the scrollable menu. */
test('UX-AUD-008: quick-access editor keeps its actions visible', async ({ page }) => {
  await mockAuthenticatedApp(page);
  const viewports = [
    { width: 1440, height: 900 }, { width: 1280, height: 720 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto('/pam');
    await page.getByRole('button', { name: /Cambiar workspace/ }).click();
    await page.getByRole('button', { name: /Editar vistas rápidas/ }).click();
    const editor = page.getByRole('dialog', { name: 'Accesos rápidos' });
    await expect(editor).toBeVisible();
    const menu = page.getByRole('region', { name: 'Workspaces' });
    const metrics = await menu.evaluate((element) => ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, scrollTop: element.scrollTop }));
    expect(metrics.scrollHeight, 'the catalog must overflow to exercise sticky actions').toBeGreaterThan(metrics.clientHeight);
    // Still at the top of the menu: the actions are visible without scrolling.
    expect(metrics.scrollTop).toBe(0);
    await expect(editor.getByRole('button', { name: 'Guardar', exact: true })).toBeInViewport({ ratio: 1 });
    await expect(editor.getByRole('button', { name: 'Cancelar', exact: true })).toBeInViewport({ ratio: 1 });
    await page.keyboard.press('Escape');
  }
});

/* UX-AUD-009: the workspace intro printed the raw run status enum
   ("Última sincronización completed") while the topbar translated it. */
test('UX-AUD-009: the workspace intro translates the run status (UX-AUD2-024)', async ({ page }) => {
  await mockAuthenticatedApp(page, {
    latestRun: {
      run_id: 'run-9', source_system: 'cyberark', status: 'completed',
      enqueued_at: '2026-09-27T04:00:00Z', started_at: '2026-09-27T04:00:00Z', completed_at: '2026-09-27T04:05:00Z',
      expected_safe_count: 465, received_safe_count: 465, received_member_count: 0, received_object_count: 465,
      error_count: 0, retired_object_count: 0, retired_relationship_count: 0,
    },
  });
  await page.goto('/pam/safes');
  await expect(page.locator('html')).toHaveAttribute('data-theme', test.info().project.name.includes('light') ? 'light' : 'dark');
  const summary = page.locator('.run-summary');
  await expect(summary).toContainText('Última sincronización completada');
  await expect(summary).not.toContainText('completed');
});

/* UX-AUD-012: a lone KPI left two thirds of the "Datos clave" row empty, and
   the inventory-trend axis repeated the same date for several runs in one
   day. The backend label keeps the timestamp and the axis shows HH:MM. */
test('UX-AUD-012: the home panel widens a lone KPI and keeps intraday ticks', async ({ page }, testInfo) => {
  await mockAuthenticatedApp(page, {
    dashboardWidgets: [
      {
        widget_id: 'without-accounts', title: 'Safes sin cuentas', kind: 'count', measure: 'safes', chart: null,
        filters: { workflow_status: '', classification_status: '', inventory_scope: '', data_quality_status: '', health_filter: 'no_accounts' },
        target_value: null, target_direction: null, period_label: null, value_format: 'count', position: null, size: 'sm', value: 1,
      },
      {
        widget_id: 'trend', title: 'Evolución del inventario', kind: 'chart', measure: 'safes',
        chart: { style: 'line', group_by: 'inventory_trend' }, filters: {}, position: 0, size: 'md',
        target_value: null, target_direction: null, period_label: null, value_format: 'count', value: 120,
        chart_data: {
          labels: ['2026-09-26 04:00:00+00:00', '2026-09-26 05:30:00+00:00', '2026-09-26 07:15:00+00:00'],
          series: [{ key: 'safes', label: 'Safes', values: [100, 110, 120] }],
        },
      },
    ],
  });
  await page.goto('/pam');

  const strip = page.locator('.dashboard-data-strip');
  await expect(strip.locator('.dashboard-data-item')).toHaveCount(1);
  const stripBox = await strip.boundingBox();
  const itemBox = await strip.locator('.dashboard-data-item').boundingBox();
  expect(itemBox!.width, 'a lone KPI must span the strip').toBeGreaterThan(stripBox!.width - 4);

  await expect(page.locator('.advanced-chart')).toBeVisible();
  // Evidence capture of the panel for the audit.
  await page.screenshot({ path: testInfo.outputPath('home-panel.png'), fullPage: true });
});

/* UX-AUD-013: the hub tablists had no associated tabpanel, and the
   coming-soon tool used native disabled, which screen readers skip. */
test('UX-AUD-013: hub tabs control a labelled panel and coming-soon tools announce themselves', async ({ page }) => {
  await mockAuthenticatedApp(page);

  const checkPanel = async (path: string, tablistName: string) => {
    await page.goto(path);
    const tablist = page.getByRole('tablist', { name: tablistName });
    const selected = tablist.getByRole('tab', { selected: true });
    await expect(selected).toBeVisible();
    const controls = await selected.getAttribute('aria-controls');
    expect(controls, `${path}: the selected tab needs aria-controls`).toBeTruthy();
    const panel = page.locator(`#${controls}`);
    await expect(panel).toHaveAttribute('role', 'tabpanel');
    await expect(panel).toHaveAttribute('aria-labelledby', (await selected.getAttribute('id')) ?? '');
  };

  await checkPanel('/admin/access', 'Administración de acceso');
  await checkPanel('/pam/identity', 'Secciones de identidad');
  await checkPanel('/pam/sia', 'Secciones de SIA');

  // Coming-soon tool: announced and focusable, but it does not navigate.
  await page.goto('/pam');
  await page.getByRole('button', { name: /Cambiar herramienta/ }).click();
  const bigid = page.getByRole('button', { name: /BigID DSPM/ });
  await expect(bigid).toHaveAttribute('aria-disabled', 'true');
  await bigid.focus();
  await expect(bigid).toBeFocused();
  await bigid.dispatchEvent('click');
  await expect(page).toHaveURL(/\/pam$/);
});


for (const [path, tool, platform] of [
  ['/pam/safes', 'CyberArk PAM', 'CyberArk'],
  ['/pam/identity/users', 'CyberArk Identity Administration', 'CyberArk'],
  ['/pam/sia/resources', 'CyberArk SIA', 'CyberArk'],
  ['/netskope/inventory', 'Netskope', 'Netskope'],
]) {
  test(`UX-AUD2-007: ${path} names the platform on the left and its owning tool in the location`, async ({ page }) => {
    await mockAuthenticatedApp(page);
    await page.goto(path);
    const header = page.getByRole('banner');
    await expect(header.getByRole('group', { name: 'Ubicación actual' }).locator('span')).toHaveText(tool);
    await expect(header.getByRole('button', { name: `Cambiar herramienta. Actual: ${platform}`, exact: true })).toBeVisible();
  });
}

test('the location does not repeat the tool name as its own workspace (CyberArk SIA > SIA)', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/sia');
  const location = page.getByRole('banner').getByRole('group', { name: 'Ubicación actual' });
  await expect(location).toHaveText('CyberArk SIA');
  await expect(location.locator('strong')).toHaveCount(0);
  await page.goto('/pam/safes');
  await expect(location.locator('strong')).toHaveCount(1);
});

test('UX-AUD2-025: Identity root redirects to its canonical users destination', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/identity');
  await expect(page).toHaveURL(/\/pam\/identity\/users$/);
  await page.reload();
  await expect(page).toHaveURL(/\/pam\/identity\/users$/);
  await expect(page.getByRole('tab', { name: /Usuarios.*Personas y cuentas/ })).toHaveAttribute('aria-selected', 'true');
  for (const path of ['/pam/identity?section=roles', '/identity?section=groups']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/pam\/identity\/roles$/);
    await expect(page.getByRole('tab', { name: /Roles y grupos.*Miembros directos/ })).toHaveAttribute('aria-selected', 'true');
  }
  await page.goto('/pam');
  await page.getByRole('button', { name: /Cambiar workspace/ }).click();
  await page.getByRole('region', { name: 'Workspaces' }).getByRole('link', { name: /^Identidades/ }).first().click();
  await expect(page).toHaveURL(/\/pam\/identity\/users$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/pam$/);
});

test('UX-AUD2-025: SIA resources use one navigation row with canonical selection', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/sia/database-accounts');
  const hub = page.getByRole('region', { name: 'Secure Infrastructure Access', exact: true });
  await expect(hub.getByRole('tablist')).toHaveCount(1);
  expect(await hub.getByRole('tablist').evaluate((nav) => nav.scrollWidth <= nav.clientWidth)).toBe(true);
  await expect(hub.getByRole('tab', { name: /Cuentas de base de datos/ })).toHaveAttribute('aria-selected', 'true');
});

for (const layout of [
  { path: '/admin/access', tabs: 'Administración de acceso', panel: '.user-admin' },
  { path: '/admin/activity', tabs: 'Actividad administrativa', panel: '.activity-panel' },
]) {
  test(`UX-AUD2-013: ${layout.path} content aligns with its navigation`, async ({ page }) => {
    await mockAuthenticatedApp(page);
    await page.goto(layout.path);
    const tabs = page.getByRole('tablist', { name: layout.tabs });
    const panel = page.locator(layout.panel);
    await expect(panel).toBeVisible();
    await expect.poll(async () => {
      const nav = await tabs.boundingBox();
      const content = await panel.boundingBox();
      return nav && content ? Math.max(Math.abs(nav.x - content.x), Math.abs(nav.width - content.width)) : Infinity;
    }).toBeLessThan(2);
    if (layout.path === '/admin/access') {
      await page.getByRole('tab', { name: /Roles y permisos/ }).click();
      await page.getByRole('button', { name: /^Administrador de plataforma/ }).click();
      const members = page.locator('.role-capability-table');
      await expect(members).toBeVisible();
      const inset = await members.evaluate((node) => node.getBoundingClientRect().left - node.closest('.role-access-editor')!.getBoundingClientRect().left);
      expect(inset).toBeGreaterThanOrEqual(12);
    }
  });
}

test('UX-AUD2-013: Netskope provenance aligns with inventory context', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['netskope:read'] });
  await page.route('**/api/cmdb/netskope/devices?*', (route) => route.fulfill({
    json: { rows: [], total: 0, limit: 50, offset: 0, source_evidence: {
      source_fresh: true, source_status: 'completed', source_completed_at: '2026-10-05T11:00:00Z', as_of: '2026-10-05T12:00:00Z',
    } },
  }));
  await page.goto('/netskope/inventory');
  const caption = page.locator('.netskope-inventory-source');
  await expect(caption).toBeVisible();
  const captionLeft = await caption.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return range.getBoundingClientRect().left;
  });
  const context = await page.locator('.netskope-filter-row, .search-row').filter({ has: page.getByRole('searchbox') }).first().locator('.search-box').boundingBox();
  expect(context).not.toBeNull();
  expect(Math.abs(captionLeft - context!.x)).toBeLessThan(2);
});

test('UX-AUD2-024: Activity tabs use the compact navigation typography and system searches', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/admin/activity');
  const tabs = page.getByRole('tablist', { name: 'Actividad administrativa' });
  await expect(tabs.getByRole('tab')).toHaveCount(5);
  const sizes = await tabs.getByRole('tab').evaluateAll((nodes) => nodes.map((node) => {
    const label = node.querySelector('strong') ?? node;
    return parseFloat(getComputedStyle(label).fontSize);
  }));
  expect(sizes).toHaveLength(5);
  expect(sizes.every((size) => size <= 12)).toBe(true);
  for (const section of [
    { tab: 'Actividad', search: 'Buscar actividad por actor, Safe o entidad' },
    { tab: 'Logs operativos', search: 'Buscar logs operativos' },
    { tab: 'Errores del sistema', search: 'Buscar errores por referencia, ruta o tipo' },
  ]) {
    await tabs.getByRole('tab', { name: section.tab, exact: true }).click();
    await expectSystemSearch(page.getByRole('searchbox', { name: section.search }));
  }
});

const resourceRowCases = [
  { path: '/pam/sia/resources', endpoint: 'sia-resources', attributes: { resource_type: 'virtual_machine', os_type: 'Linux', location_type: 'Datacenter', discovery_engine: 'Discovery', scanned_on: '2026-10-02T17:56:07.446661Z' } },
  { path: '/pam/sia/database-accounts', endpoint: 'sia-database-accounts', attributes: { store_type: 'PostgreSQL', platform: 'Database', database: 'Finance', port: 5432, created_at: '', modified_at: '2026-10-02T17:56:07.446661Z' } },
];

for (const resource of resourceRowCases) {
  test(`UX-AUD2-020: ${resource.path} shows an identifier once and preserves copying`, async ({ page, context }) => {
    await mockAuthenticatedApp(page, { permissions: ['sia:catalogs_read', 'pam:catalogs_read'] });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.route(`**/api/cmdb/${resource.endpoint}*`, (route) => route.fulfill({ json: {
      rows: [
        { object_id: 901, display_name: 'same-resource-901', source_id: 'same-resource-901', attributes: resource.attributes },
        { object_id: 902, display_name: 'Readable resource', source_id: 'opaque-id-902', attributes: resource.attributes },
      ], total: 2, limit: 50, offset: 0,
    } }));
    await page.goto(resource.path);
    const duplicate = page.getByRole('row').filter({ has: page.getByText('same-resource-901', { exact: true }) });
    await expect(duplicate).toBeVisible();
    expect((await duplicate.innerText()).split('same-resource-901').length - 1).toBe(1);
    if ('store_type' in resource.attributes) await expect(duplicate.getByText('PostgreSQL', { exact: true })).toHaveCount(1);
    await duplicate.getByRole('button', { name: 'Copiar identificador' }).click();
    await expect(duplicate.getByRole('button', { name: 'Copiado' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('same-resource-901');
    const distinct = page.getByRole('row').filter({ has: page.getByText('Readable resource', { exact: true }) });
    await expect(distinct).toContainText('opaque-id-902');
    await distinct.getByRole('button', { name: 'Copiar identificador' }).click();
    await expect(distinct.getByRole('button', { name: 'Copiado' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('opaque-id-902');
  });
}

for (const resource of resourceRowCases.slice(0, 2)) {
  test(`UX-AUD2-009: ${resource.path} formats operational dates and explains their age`, async ({ page }) => {
    await mockAuthenticatedApp(page, { permissions: ['sia:catalogs_read'] });
    const timestamp = '2026-10-02T17:56:07.446661Z';
    await page.route(`**/api/cmdb/${resource.endpoint}*`, (route) => route.fulfill({ json: {
      rows: [{ object_id: 901, display_name: 'Dated resource', source_id: 'dated-901', attributes: resource.attributes }], total: 1, limit: 50, offset: 0,
    } }));
    await page.goto(resource.path);
    const row = page.getByRole('row').filter({ has: page.getByText('Dated resource', { exact: true }) });
    const time = row.locator('time');
    await expect(time).toHaveAttribute('datetime', timestamp);
    await expect(time).toContainText(/2 oct 2026/);
    await expect(time).not.toContainText(/T17:56:07/);
    await expect(time).toHaveAttribute('title', /^hace /);
  });
}

test('UX-AUD2-014: remote search keeps distinct context and omits repeated titles and group badges', async ({ page }) => {
  await mockAuthenticatedApp(page, { includeSafe: true });
  await page.route('**/api/search?*', (route) => route.fulfill({ json: {
    query: 'Audit finance', groups: { safes: [
      { type: 'safe', label: 'Audit finance', detail: 'Audit finance', workspace: 'safes', target: 1, query: 'Audit finance' },
      { type: 'safe', label: 'Distinct safe', detail: 'Protected vault', workspace: 'safes', target: 2, query: 'Distinct safe' },
    ] },
  } }));
  await page.goto('/pam/safes');
  await expect(page.getByRole('button', { name: 'Abrir command center' })).toBeVisible();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Command center' });
  await dialog.getByRole('combobox').fill('Audit finance');
  const safes = dialog.getByRole('group', { name: 'Safes', exact: true });
  const repeated = safes.getByRole('option').filter({ has: page.getByText('Audit finance', { exact: true }) });
  await expect(repeated).toBeVisible();
  expect((await repeated.innerText()).split('Audit finance').length - 1).toBe(1);
  await expect(repeated.locator('.global-search-badge')).toHaveCount(0);
  await expect(safes.getByRole('option').filter({ hasText: 'Distinct safe' })).toContainText('Protected vault');
  await expect(dialog.locator('.global-search-input .icon-button')).toHaveCount(1);
  await repeated.click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/pam\/safes/);
  await expect(page.getByRole('searchbox', { name: 'Buscar Safes por nombre o Safe URL ID' })).toHaveValue('Audit finance');
});

for (const operatorView of [
  { path: '/netskope/users', ready: '.netskope-table tbody tr' },
  { path: '/pam/connectors', ready: '.pam-connectors-table tbody tr' },
  { path: '/pam/graph', ready: '.chain-column-header' },
  { path: '/pam/sia/resources', ready: '.sia-record-name' },
  { path: '/help', ready: '.help-content' },
]) {
  test(`UX-AUD2-017: ${operatorView.path} explains inventory without internal field names`, async ({ page }) => {
    await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'pam:catalogs_read', 'sia:catalogs_read', 'netskope:read'] });
    await page.goto(operatorView.path);
    await expect(page.locator(operatorView.ready).first()).toBeVisible();
    const text = await page.locator('main').evaluate((main) => {
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
      const copy: string[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        // Inventory names/IDs and explicit technical code are data, not interface copy.
        if (parent?.getClientRects().length && !parent.closest('tbody, code, pre')) copy.push(node.textContent ?? '');
      }
      return copy.join(' ');
    });
    expect(text).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
    expect(text).not.toMatch(/\bworkspace\b|Solo asiento Standard conciliado|Owner \/ Regla de actualización|\bTarget\b(?! sets?\b)/);
    if (operatorView.path === '/pam/sia/resources') await expect(page.getByRole('columnheader', { name: 'Máquina virtual', exact: true })).toBeVisible();
  });
}

// UX-AUD2-015: the shell owns the view title; a tool must retain its controls
// and methodology without rendering the same view name/description again.
const singleViewTitleCases = [
  { path: '/pam/safes', title: 'Safes', duplicate: /^Inventario de Safes$/, ready: '.safe-name', help: 'Inventario de Safes' },
  { path: '/pam/identity/users', title: 'Usuarios', duplicate: /^Usuarios$/, ready: '.identity-user-cell', help: 'Usuarios de Identity Administration' },
  { path: '/pam/identity/roles', title: 'Roles y grupos', duplicate: /^Roles y grupos$/, ready: '.identity-role-list tbody tr', help: '' },
  { path: '/pam/roles', title: 'Roles CyberArk', duplicate: /^Roles CyberArk$/, ready: '.pam-role-table tbody tr', help: 'Clasificación de roles PAM' },
  { path: '/pam/sia', title: 'SIA', duplicate: /^Políticas de acceso$/, ready: '.sia-hub-workspace .compact-table tbody .cell-lead', help: 'Políticas de acceso SIA' },
  { path: '/pam/sia/resources', title: 'Máquinas virtuales SIA', duplicate: /^Máquinas virtuales SIA$/, ready: '.sia-record-name', help: 'Inventario de máquinas virtuales SIA' },
  { path: '/pam/sia/database-accounts', title: 'Cuentas de base de datos SIA', duplicate: /^Cuentas de base de datos SIA$/, ready: '.sia-record-name', help: 'Inventario de cuentas de base de datos SIA' },
  { path: '/pam/assets', title: 'Cobertura', duplicate: /^Cobertura$/, ready: '.connection-inventory-table tbody tr', help: 'Cobertura' },
  { path: '/pam/connectors', title: 'Conectores PSM y SIA', duplicate: /^Conectores$/, ready: '.pam-connectors-table tbody tr', help: 'Inventarios de conectores PSM y SIA' },
  { path: '/pam/platforms', title: 'Plataformas', duplicate: /^Plataformas activas$/, ready: '.pam-platforms-table tbody tr', help: 'Inventario de plataformas PAM' },
  { path: '/netskope/inventory', title: 'Inventario', duplicate: /^Inventario de equipos$/, ready: '.netskope-table tbody tr', help: 'Evidencia del inventario Netskope' },
  { path: '/netskope/devices', title: 'Inventario', duplicate: /^Inventario de equipos$/, ready: '.netskope-table tbody tr', help: 'Evidencia del inventario Netskope' },
  { path: '/netskope/users', title: 'Inventario', duplicate: /^Cobertura de usuarios$/, ready: '.netskope-table tbody tr', help: 'Evidencia del inventario Netskope' },
];

for (const view of singleViewTitleCases) {
  test(`UX-AUD2-015: ${view.path} has one view heading and keeps contextual help and controls`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await mockAuthenticatedApp(page, { includeSafe: true, permissions: ['inventory:read', 'access:manage', 'pam:catalogs_read', 'sia:catalogs_read', 'netskope:read', 'identity:catalogs_read'] });
    await page.goto(view.path);
    await expect(page.locator(view.ready).first()).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', testInfo.project.use.colorScheme === 'light' ? 'light' : 'dark');
    await expect(page.getByRole('heading', { name: view.title, exact: true, level: 1 })).toHaveCount(1);
    await expect(page.locator('main h2, main h3').filter({ hasText: view.duplicate })).toHaveCount(0);
    if (view.path.startsWith('/netskope/')) await expect(page.locator('.netskope-inventory-context > strong')).toHaveCount(0);
    const copy = page.locator('.intro-copy');
    const geometry = await copy.evaluate((element) => {
      const range = document.createRange(); range.selectNodeContents(element);
      const rects = [...range.getClientRects()];
      const bounds = element.getBoundingClientRect();
      return { lines: rects.length, fits: rects.every((rect) => rect.right <= bounds.right + 1), ellipsis: getComputedStyle(element).textOverflow };
    });
    expect(geometry.lines).toBe(1);
    expect(geometry.fits).toBe(true);
    expect(geometry.ellipsis).not.toBe('ellipsis');
    if (view.help) {
      const help = page.locator('.intro').getByRole('button', { name: `Ayuda: ${view.help}`, exact: true });
      await help.click();
      const methodology: Record<string, RegExp> = {
        '/pam/safes': /clasificación local/,
        '/pam/identity/users': /Identity Administration/,
        '/pam/roles': /clasificación no modifica/,
        '/pam/sia': /correo exacto/,
        '/pam/sia/resources': /direcciones IP/,
        '/pam/sia/database-accounts': /credenciales/,
        '/pam/assets': /Inventario de destinos/,
        '/pam/connectors': /Inventarios separados/,
        '/pam/platforms': /identificador/,
      };
      await expect(page.getByRole('note')).toContainText(methodology[view.path] ?? /24 horas/);
      await page.keyboard.press('Escape');
      await expect(help).toBeFocused();
    }
    await expect(page.getByRole('searchbox').first()).toBeVisible();
    if (view.path === '/pam/safes') {
      await page.getByRole('tab', { name: /^Retiradas/ }).click();
      await expect(page.getByRole('heading', { name: 'Safes', exact: true, level: 1 })).toBeVisible();
      await expect(page.locator('main h2, main h3').filter({ hasText: /^(Inventario de Safes|Safes retiradas)$/ })).toHaveCount(0);
    }
    if (view.path === '/pam/connectors') {
      await page.getByRole('button', { name: 'Elegir inventario de conectores' }).click();
      await page.getByRole('option', { name: 'SIA', exact: true }).click();
      await expect(page.getByRole('searchbox', { name: 'Buscar conectores SIA' })).toBeVisible();
    }
    if (view.path === '/pam/platforms') {
      await page.getByRole('button', { name: 'Elegir vista de plataformas' }).click();
      await page.getByRole('option', { name: 'Política CPM', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Política CPM por plataforma', exact: true })).toBeVisible();
    }
    const aliases: Record<string, string[]> = {
      '/pam/identity/users': ['/pam/identity'],
      '/pam/identity/roles': ['/pam/identity/groups'],
      '/pam/assets': ['/pam/ip-inventory'],
      '/pam/connectors': ['/pam/sia/connectors'],
    };
    for (const alias of aliases[view.path] ?? []) {
      await page.goto(alias);
      await expect(page.locator(view.ready).first()).toBeVisible();
      await expect(page.getByRole('heading', { name: view.title, exact: true, level: 1 })).toHaveCount(1);
      await expect(page.locator('main h2, main h3').filter({ hasText: view.duplicate })).toHaveCount(0);
      if (view.help) await expect(page.locator('.intro').getByRole('button', { name: `Ayuda: ${view.help}`, exact: true })).toHaveCount(1);
    }
  });
}

test('UX-AUD2-015: contextual help closes when keyboard navigation changes tool views', async ({ page }, testInfo) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'pam:catalogs_read', 'sia:catalogs_read'] });
  await page.goto('/pam/sia/database-accounts');
  await expect(page.locator('html')).toHaveAttribute('data-theme', testInfo.project.use.colorScheme === 'light' ? 'light' : 'dark');
  await page.locator('.intro').getByRole('button', { name: 'Ayuda: Inventario de cuentas de base de datos SIA' }).click();
  await expect(page.getByRole('note')).toContainText('credenciales');
  // Native keyboard activation has no outside mousedown to dismiss the note.
  const machines = page.getByRole('tab', { name: /Máquinas virtuales SIA/ });
  await machines.focus();
  await machines.press('Enter');
  await expect(page.getByRole('heading', { name: 'Máquinas virtuales SIA', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole('note')).toHaveCount(0);
  const machineHelp = page.locator('.intro').getByRole('button', { name: 'Ayuda: Inventario de máquinas virtuales SIA' });
  await machineHelp.click();
  await expect(page.getByRole('note')).toContainText('direcciones IP');
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Cuentas de base de datos SIA', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole('note')).toHaveCount(0);
});

for (const board of [
  { path: '/pam', region: 'Mi panel de métricas', preferences: '/api/dashboard/preferences' },
  { path: '/netskope', region: 'Mi panel de métricas Netskope', preferences: '/api/dashboard/netskope/preferences' },
]) {
  test(`UX-AUD2-021: ${board.path} uses one heading per dashboard section in reading, editing and empty states`, async ({ page }, testInfo) => {
    await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
    await page.goto(board.path);
    const panel = page.getByRole('region', { name: board.region, exact: true });
    await expect(panel.locator('.dashboard-data-item').first()).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', testInfo.project.use.colorScheme === 'light' ? 'light' : 'dark');
    await expect(panel.getByRole('heading', { name: 'Lo que elegiste seguir', exact: true })).toHaveCount(0);
    await expect(panel.locator('.eyebrow').filter({ hasText: /^MI VISTA$/ })).toHaveCount(0);
    const headers = panel.locator('.dashboard-section-heading');
    await expect(headers.first()).toBeVisible();
    // The Netskope board adds only its colour legend and chart note (UX-AUD2-021 allows no other extra text).
    await expect(headers.locator('p:not(.netskope-chart-color-note), span:not(.netskope-color-legend *)')).toHaveCount(0);
    await expect(panel.getByRole('heading', { name: 'Datos clave', exact: true, level: 2 })).toBeVisible();
    await panel.getByRole('button', { name: 'Editar vista', exact: true }).click();
    await expect(panel.getByRole('toolbar', { name: /Edición del tablero/ })).toBeVisible();
    await expect(panel.locator('.netskope-editor-guide')).toHaveCount(0);
    // The Netskope board adds only its colour legend and chart note (UX-AUD2-021 allows no other extra text).
    await expect(headers.locator('p:not(.netskope-chart-color-note), span:not(.netskope-color-legend *)')).toHaveCount(0);
    await panel.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Editar vista', exact: true })).toBeVisible();
    let saved = 0;
    await page.route((url) => url.pathname === board.preferences, async (route) => {
      if (route.request().method() !== 'GET') saved++;
      await route.fulfill({ json: { widgets: [], is_default: false } });
    });
    await page.reload();
    const empty = page.locator('.dashboard-empty-state');
    await expect(empty.getByRole('heading', { name: 'Todavía no elegiste qué seguir', exact: true })).toBeVisible();
    await expect(empty.getByRole('heading')).toHaveCount(1);
    await expect(empty.locator('.eyebrow')).toHaveCount(0);
    await expect(empty.getByRole('button', { name: 'Usar vista recomendada', exact: true })).toBeVisible();
    await empty.getByRole('button', { name: 'Ayuda: Vista recomendada', exact: true }).click();
    await expect(page.getByRole('note')).toContainText('sólo si la aceptás');
    await page.keyboard.press('Escape');
    expect(saved).toBe(0);
  });
}

test('UX-AUD2-021: Netskope KPI summaries fit and charts follow the shared dashboard grid without changing saved preferences', async ({ page }, testInfo) => {
  const widgets = [
    { id: 'devices_total', size: 'sm', filters: {} },
    { id: 'devices_stale_30d', size: 'sm', filters: { os: 'Windows' } },
    { id: 'devices_observed_user_unmatched', size: 'sm', filters: {} },
    { id: 'users_total', size: 'sm', filters: {} },
    { id: 'users_recent_activity', size: 'sm', filters: {} },
    { id: 'devices_observed_user_matched', size: 'sm', filters: {} },
    { id: 'devices_by_os', size: 'md', filters: {} },
    { id: 'devices_by_classification', size: 'md', filters: {} },
  ];
  let writes = 0;
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'], netskopeMetrics: {
    users_total: 8975, users_enabled: 7618, users_disabled: 1237, users_with_device_activity_7d: 4442,
    devices_total: 12000, devices_stale_30d: 2000, devices_stale_unclassified: 900,
    devices_observed_user_unmatched: 500, devices_observed_user_matched: 11000, devices_observed_user_ambiguous: 500,
  } });
  await page.route('**/api/dashboard/netskope/preferences', async (route) => {
    if (route.request().method() !== 'GET') writes++;
    await route.fulfill({ json: { widgets, is_default: false } });
  });
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/netskope');
    await expect(page.locator('html')).toHaveAttribute('data-theme', testInfo.project.use.colorScheme === 'light' ? 'light' : 'dark');
    await expect(page.locator('.netskope-data-card')).toHaveCount(6);
    await expect(page.locator('.netskope-data-card .dashboard-data-open > strong').first()).toHaveText('12.000');
    const summaries = page.locator('.netskope-data-card .dashboard-data-open > small');
    for (const summary of await summaries.all()) {
      const geometry = await summary.evaluate((element) => {
        const range = document.createRange(); range.selectNodeContents(element);
        const bounds = element.getBoundingClientRect();
        const rects = [...range.getClientRects()];
        return { lines: rects.length, fits: rects.every((rect) => rect.right <= bounds.right + 1), ellipsis: getComputedStyle(element).textOverflow };
      });
      expect(geometry).toEqual({ lines: 1, fits: true, ellipsis: 'clip' });
    }
    const cards = page.locator('.netskope-chart-grid .personal-chart-card');
    await expect(cards).toHaveCount(2);
    const chartBoxes = await cards.evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect(); return { y: rect.y, left: rect.left, right: rect.right };
    }));
    const grid = (await page.locator('.netskope-chart-grid').boundingBox())!;
    // DASH-GRID-001 (reverts the flexible rows of UX-AUD2-021): two wide charts
    // cannot share a row of the shared 3-zone grid, each covers 2 of 3 zones.
    expect(chartBoxes[1].y).toBeGreaterThan(chartBoxes[0].y);
    for (const box of chartBoxes) {
      expect(Math.abs(box.left - grid.x)).toBeLessThan(2);
      expect(box.right).toBeLessThan(grid.x + grid.width * 0.7);
    }
    const stale = page.locator('.netskope-data-card').filter({ hasText: 'Equipos sin señal hace más de 30 días' });
    await stale.getByRole('button', { name: 'Qué mide: Equipos sin señal hace más de 30 días' }).click();
    await expect(page.getByRole('note')).toContainText('Equipos activos cuyo último evento tiene más de 30 días');
    await page.keyboard.press('Escape');
  }
  widgets.splice(7, 1,
    { id: 'devices_by_company', size: 'sm', filters: {} },
    { id: 'users_by_company', size: 'lg', filters: {} });
  await page.reload();
  const mixed = page.locator('.netskope-chart-grid .personal-chart-card');
  await expect(mixed).toHaveCount(3);
  await expect(mixed.locator('.metric-label')).toHaveText(['Dispositivos por sistema operativo', 'Dispositivos por empresa', 'Usuarios por empresa']);
  const geometry = await mixed.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect(); return { y: rect.y, left: rect.left, right: rect.right, width: rect.width };
  }));
  const bounds = (await page.locator('.netskope-chart-grid').boundingBox())!;
  // Wide + small share the first row; the large chart covers 2×2 zones below, as on the PAM board.
  expect(geometry[0].width).toBeGreaterThan(geometry[1].width);
  expect(Math.abs(geometry[0].y - geometry[1].y)).toBeLessThan(2);
  expect(Math.abs(geometry[1].right - (bounds.x + bounds.width))).toBeLessThan(2);
  expect(geometry[2].y).toBeGreaterThan(geometry[0].y);
  expect(Math.abs(geometry[2].width - geometry[0].width)).toBeLessThan(2);
  expect(writes).toBe(0);
});

test('UX-AUD2-021: aggregate alerts keep their windows and values with one contextual scope hint', async ({ page }, testInfo) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({ json: { widgets: [
    { id: 'alerts_7d', size: 'sm' }, { id: 'alerts_30d', size: 'sm' },
  ], is_default: false } }));
  await page.goto('/netskope');
  await expect(page.locator('html')).toHaveAttribute('data-theme', testInfo.project.use.colorScheme === 'light' ? 'light' : 'dark');
  const alerts = page.getByRole('region', { name: 'Alertas Netskope agregadas', exact: true });
  await expect(alerts.getByRole('heading', { name: 'Alertas Netskope agregadas', exact: true, level: 2 })).toBeVisible();
  await expect(alerts.locator('.netskope-alert-kpi > strong')).toHaveText(['3', '12']);
  await expect(alerts.locator('.netskope-alert-kpi > span')).toHaveText(['Últimos 7 días', 'Últimos 30 días']);
  await expect(alerts.locator('.netskope-alert-overview-heading > div > p')).toHaveCount(0);
  await expect(page.locator('.netskope-alert-dimension-note')).toHaveCount(0);
  await alerts.getByRole('button', { name: 'Ayuda: Alcance de las alertas agregadas', exact: true }).click();
  await expect(page.getByRole('note')).toContainText('no deben sumarse entre sí');
  await expect(page.getByRole('note')).toContainText('sin guardar sus resultados en la base local');
  await page.keyboard.press('Escape');
  await expect(alerts.getByRole('button', { name: 'Ayuda: Alcance de las alertas agregadas', exact: true })).toBeFocused();
});

// Owner-boundary regressions: dialog lifecycle and the audited empty surfaces.
// These use the rendered workspace, not the component's implementation shape.
test('UX-AUD2-022: SIA opens one complete policy dialog without narrowing the table and restores focus', async ({ page }, testInfo) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'sia:catalogs_read', 'pam:catalogs_read'] });
  await page.goto('/pam/sia');
  await expect(page.locator('html')).toHaveAttribute('data-theme', testInfo.project.name.includes('light') ? 'light' : 'dark');
  const table = page.locator('.sia-hub-workspace .compact-table');
  const trigger = page.getByRole('button', { name: 'Ver detalle de Finance access' });
  await expect(trigger).toBeVisible();
  const before = await table.boundingBox();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Finance access', exact: true });
  await expect(dialog).toBeVisible();
  expect((await table.boundingBox())!.width).toBe(before!.width);
  await expect(dialog.getByText('10.67.10.186', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Destinatarios', exact: true })).toBeVisible();
  await expect(dialog.getByText('ID de política', { exact: true })).toBeVisible();
  await expect(dialog.getByText('policy-20', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Reglas de acceso', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Buscar coincidencia en Safes' })).toBeVisible();
  const focusable = dialog.locator('button:not([disabled]), input:not([disabled])');
  for (let index = 0; index < await focusable.count() + 1; index++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  const axe = await new AxeBuilder({ page }).include('[aria-labelledby="sia-policy-title"]').analyze();
  expect(axe.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('UX-QA-005: PAM platform types are shown in Spanish and keep CyberArk\'s value as the tooltip', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'pam:catalogs_read'] });
  const row = (id: number, type: string) => ({ object_id: id, display_name: `Plat-${id}`, source_id: `Plat-${id}`, system_type: type, active: true, allowed_safes_pattern: null, safe_count: 1, account_count: 1, psms: [] });
  await page.route('**/api/cmdb/pam-platforms*', (route) => route.fulfill({ json: { rows: [row(1, 'Operating System'), row(2, 'Imported Platforms'), row(3, 'Brand New Type'), row(4, '')], total: 4, limit: 100, offset: 0, search: '' } }));
  await page.goto('/pam/platforms');
  const types = page.locator('.pam-platform-type');
  await expect(types).toHaveText(['Sistema operativo', 'Plataformas importadas', 'Brand New Type', 'Sin tipo']);
  await expect(types.first()).toHaveAttribute('title', 'Operating System');
});

test('UX-QA-003: a person search without matches asks to adjust the term and hides the initial instruction', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'pam:catalogs_read'] });
  await page.route('**/api/chains/person/search*', (route) => route.fulfill({ json: { people: [], query: 'zzzz-inexistente' } }));
  await page.goto('/chains/person');
  const instruction = page.getByText('Elegí una persona para ver sus herramientas', { exact: true });
  await expect(instruction).toBeVisible();
  await page.getByRole('searchbox', { name: 'Buscar persona por correo o nombre' }).fill('zzzz-inexistente');
  await expect(page.getByText(/^Sin coincidencias\. Probá con otro nombre/)).toBeVisible();
  await expect(instruction).toHaveCount(0);
});

test('UX-AUD2-022: Personas starts with one compact instruction and contextual methodology', async ({ page }, testInfo) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'pam:catalogs_read'] });
  await page.goto('/chains/person');
  await expect(page.locator('html')).toHaveAttribute('data-theme', testInfo.project.name.includes('light') ? 'light' : 'dark');
  await expect(page.getByRole('searchbox', { name: 'Buscar persona por correo o nombre' })).toBeVisible();
  const instruction = page.getByText('Elegí una persona para ver sus herramientas', { exact: true });
  await expect(instruction).toBeVisible();
  expect((await instruction.boundingBox())!.height).toBeLessThan(40);
  await expect(page.getByRole('heading', { name: /Buscá una persona|Elegí una persona/ })).toHaveCount(0);
  await expect(page.getByRole('note')).toHaveCount(0);
  const help = page.getByRole('heading', { name: /Personas/, level: 1 }).locator('..').getByRole('button', { name: 'Ayuda: Vínculos por persona' });
  await help.click();
  await expect(page.getByRole('note')).toContainText('correo exacto 1 a 1');
  await expect(page.getByRole('note')).toContainText('sin registro');
});

test('UX-AUD2-022: Hallazgos readers see contextual help and a compact empty result without an empty action surface', async ({ page }, testInfo) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'] });
  await page.route('**/api/findings?*', (route) => route.fulfill({ json: { rows: [], total: 0, limit: 50, offset: 0 } }));
  await page.goto('/pam/posture');
  await expect(page.locator('html')).toHaveAttribute('data-theme', testInfo.project.name.includes('light') ? 'light' : 'dark');
  const empty = page.getByText('Custodia: no hay hallazgos para estos filtros', { exact: true });
  await expect(empty).toBeVisible();
  expect((await empty.locator('..').boundingBox())!.height).toBeLessThan(65);
  await expect(page.locator('.posture-toolbar')).toHaveCount(0);
  await page.getByRole('heading', { level: 1, name: /Postura/ }).locator('..').getByRole('button', { name: 'Ayuda: Acerca de Postura PAM' }).click();
  await expect(page.getByRole('note')).toContainText('cada fuente');
});

test('UX-AUD2-022: the retired steering link lands on Equipos', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.goto('/netskope/steering');
  await expect(page).toHaveURL(/\/netskope\/operations$/);
  await expect(page.getByText('Túneles de steering')).toHaveCount(0);
});

test('UX-AUD2-022: SIA filtered empties keep clear filters and never claim an external connection', async ({ page }, testInfo) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'sia:catalogs_read'] });
  await page.route('**/api/cmdb/sia-policies*', (route) => route.fulfill({ json: { rows: [], total: 0, limit: 50, offset: 0 } }));
  await page.goto('/pam/sia');
  await expect(page.locator('html')).toHaveAttribute('data-theme', testInfo.project.name.includes('light') ? 'light' : 'dark');
  const empty = page.getByText('Sin políticas de acceso registradas', { exact: true });
  await expect(empty).toBeVisible();
  expect((await empty.locator('..').boundingBox())!.height).toBeLessThan(65);
  await expect(page.getByText(/SIA está conectado/)).toHaveCount(0);
  const search = page.getByRole('searchbox', { name: 'Buscar políticas SIA por nombre o descripción' });
  await search.fill('inexistente');
  await expect(page.getByText('Sin políticas para estos filtros')).toBeVisible();
  await page.getByRole('button', { name: 'Limpiar filtros', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(empty).toBeVisible();
});

test('UX-AUD2-022: Hallazgos keeps authorized actions and compact Risk Management subview empties', async ({ page }, testInfo) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'findings:manage', 'pam:risk_read'] });
  await page.route('**/api/findings?*', (route) => route.fulfill({ json: { rows: [], total: 0, limit: 50, offset: 0 } }));
  await page.route('**/api/cyberark-risk/**', (route) => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith('/overview') ? {
    source: 'cyberark_risk_management', fetched_at: '2026-10-08T00:00:00Z',
    summary: { total_findings_by_severity: {}, entity_types: [] }, risk_types: [], remediations: [],
    progress: { total_onboarded_current: null, total_onboarded_through_discovery_current: null, points: [] }, recommendations_status: 'catalog_options_only',
  } : { source: 'cyberark_risk_management', fetched_at: '2026-10-08T00:00:00Z', rows: [], limit: 50, offset: 0, is_last_page: true, entity_names_visible: false } }));
  await page.goto('/pam/posture');
  await expect(page.locator('html')).toHaveAttribute('data-theme', testInfo.project.name.includes('light') ? 'light' : 'dark');
  await expect(page.getByRole('button', { name: 'Actualizar reglas Custodia' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Actualizar lectura' })).toBeVisible();
  await page.getByRole('button', { name: 'Hallazgos', exact: true }).click();
  await page.getByRole('button', { name: 'Filtrar hallazgos por severidad' }).click();
  await page.getByRole('option', { name: 'Alta', exact: true }).click();
  await page.getByRole('button', { name: 'Limpiar filtros Custodia' }).click();
  await expect(page.getByRole('button', { name: 'Filtrar hallazgos por severidad' })).toContainText('Todas las severidades');
  for (const view of [{ button: 'Tipos de riesgo (0)', empty: 'Sin tipos de riesgo informados' }, { button: 'Resumen', empty: 'Sin evolución informada' }]) {
    await page.getByRole('button', { name: view.button, exact: true }).click();
    const result = page.getByText(view.empty, { exact: true });
    await expect(result).toBeVisible();
    expect((await result.locator('..').boundingBox())!.height).toBeLessThan(65);
  }
  await expect(page.locator('.risk-hero-kpis')).toContainText('Sin dato');
});

for (const surface of ['psm', 'sia-connectors', 'netskope-devices'] as const) {
  test(`UX-AUD2-023: ${surface} keeps atomic values and allocates desktop table columns for long inventory data`, async ({ page }, testInfo) => {
    await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'pam:catalogs_read', 'sia:catalogs_read', 'netskope:read'] });
    const psmName = 'PSM-FINANCE-PRODUCTION-EU-WEST-001';
    const platformName = 'Windows Domain Account Production Finance';
    const version = '141.1.7.2827 (64-bit)';
    if (surface === 'psm') await page.route('**/api/cmdb/pam-connectors*', route => route.fulfill({ json: { rows: [{ object_id: 11, display_name: psmName, source_id: 'PSM-FINANCE-PRODUCTION-001', address: '10.67.100.186', platform_count: 1, platforms: [{ object_id: 10, display_name: platformName, source_id: 'platform-10' }] }], total: 1, limit: 100, offset: 0 } }));
    if (surface === 'sia-connectors') await page.route('**/api/cmdb/sia-connectors*', route => route.fulfill({ json: { rows: [{ object_id: 60, display_name: 'SIA-PRODUCTION-001', source_id: 'sia-60', attributes: { status: 'connected', version, is_latest_version: false, os: 'Windows Server 2022', region: 'eu-west-1', active_sessions_count: 2 } }], total: 1, limit: 100, offset: 0 } }));
    if (surface === 'netskope-devices') await page.route('**/api/cmdb/netskope/devices?*', route => route.fulfill({ json: { rows: [{ object_id: 701, source_id: 'device-701', display_name: 'FINANCEPRODUCTIONWORKSTATIONWITHEXPLICITLONGASSETIDENTIFIER001', attributes: { hostname: 'FINANCEPRODUCTIONWORKSTATIONWITHEXPLICITLONGASSETIDENTIFIER001', device_make: 'Dell', device_model: 'Latitude', os: 'Windows', os_version: '11 (64-bit)', client_version: version, username: 'long.finance.operator@example.test' }, first_seen_at: '2026-09-01T21:06:00Z', last_seen_at: '2026-10-08T21:06:00Z', observed_user_status: 'unmatched', device_evidence: { state: 'recent', reason: 'Evento reciente', last_signal_at: '2026-10-08T21:06:00Z', age_days: 0 }, review: null }], total: 1, limit: 50, offset: 0, source_evidence: { source_fresh: true, source_status: 'completed', source_completed_at: '2026-10-08T21:06:00Z', as_of: '2026-10-08T21:06:00Z' } } }));
    await page.goto(surface === 'netskope-devices' ? '/netskope/inventory' : surface === 'psm' ? '/pam/connectors' : '/pam/sia/connectors');
    await expect(page.locator('html')).toHaveAttribute('data-theme', testInfo.project.name.includes('light') ? 'light' : 'dark');
    if (surface === 'sia-connectors') {
      await page.getByRole('button', { name: 'Elegir inventario de conectores' }).click();
      await page.getByRole('option', { name: 'SIA', exact: true }).click();
    }
    const table = page.locator(surface === 'netskope-devices' ? '.netskope-table' : '.pam-platforms-table');
    const row = table.getByRole('row').nth(1);
    await expect(row).toBeVisible();
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      if (surface === 'psm') {
        await expectAtomicCellText(row.getByText(psmName, { exact: true }));
        await expectAtomicCellText(row.getByText('PSM-FINANCE-PRODUCTION-001', { exact: true }));
        await expectAtomicCellText(row.getByRole('button', { name: platformName, exact: true }));
      } else if (surface === 'sia-connectors') {
        await expectAtomicCellText(row.getByRole('cell', { name: version, exact: true }));
        await expect(row.getByRole('cell', { name: '2', exact: true })).toBeVisible();
      } else {
        await expectAtomicCellText(row.getByRole('cell', { name: version, exact: true }));
        await expectAtomicCellText(row.getByRole('cell').nth(3).locator('strong'));
        await expectAtomicCellText(row.getByRole('cell').nth(5));
        await expectAtomicCellText(row.getByRole('cell').nth(3).locator('small'));
      }
      const wrap = table.locator('..');
      const dimensions = await wrap.evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
      expect(dimensions.scroll, `${surface} table at ${width}`).toBeLessThanOrEqual(dimensions.client);
    }
    if (surface === 'psm') {
      await row.getByRole('button', { name: platformName, exact: true }).click();
      await expect(page).toHaveURL(/\/pam\/platforms/);
      await expect(page.getByRole('searchbox', { name: 'Buscar plataformas PAM' })).toHaveValue(platformName);
    } else if (surface === 'netskope-devices') {
      const name = 'FINANCEPRODUCTIONWORKSTATIONWITHEXPLICITLONGASSETIDENTIFIER001';
      await expect(row.getByRole('cell').first()).toHaveAttribute('title', name);
      await row.click();
      const card = page.locator('.netskope-device-detail');
      await expect(card).toBeVisible();
      await expect(card).toContainText('long.finance.operator@example.test');
      await row.click();
      await expect(card).toHaveCount(0);
    }
  });
}

test('UX-AUD2-023: existing compact catalog dates and badges remain atomic in desktop themes', async ({ page }, testInfo) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'pam:catalogs_read', 'sia:catalogs_read'] });
  for (const resource of resourceRowCases) {
    await page.route(`**/api/cmdb/${resource.endpoint}*`, route => route.fulfill({ json: { rows: [{ object_id: 901, display_name: 'Readable resource', source_id: 'resource-901', attributes: resource.attributes }], total: 1, limit: 50, offset: 0 } }));
  }
  await page.route('**/api/cmdb/sia-policies*', route => route.fulfill({ json: {
    rows: ['unlinked', 'linked', 'multiple'].map((linkage_status, index) => ({
      object_id: 320 + index, display_name: `Finance access ${index + 1}`, source_id: `policy-${index + 1}`,
      attributes: { status: 'Enabled', description: '', platforms: ['OnPrem'], policy_type: 'DB', rule_names: [], granted_users: [], granted_groups: [], granted_roles: ['Operations'], ip_rules: [], fqdn_rules: [], logical_names: [] },
      linkage_status, linked_safes: index ? [{ safe_number: 1, safe_name: 'Finance', matched_ips: ['10.0.0.1'], accounts: [] }] : [],
    })), total: 3, limit: 50, offset: 0,
  } }));
  for (const path of ['/pam/sia', '/pam/sia/resources', '/pam/sia/database-accounts', '/pam/posture']) {
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('data-theme', testInfo.project.name.includes('light') ? 'light' : 'dark');
    const row = page.locator('.compact-table').first().getByRole('row').nth(1);
    await expect(row).toBeVisible();
    const atomic = path === '/pam/sia' ? page.locator('.compact-table tbody .status-badge') : row.locator('time, .status-badge, .status-pill');
    await expect(atomic.first()).toBeVisible();
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (let index = 0; index < await atomic.count(); index++) await expectAtomicCellText(atomic.nth(index));
      if (path === '/pam/posture') await expectAtomicCellText(row.getByRole('cell').nth(5));
      const bounds = await page.locator('.compact-table-wrap').first().evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
      expect(bounds.scroll, `${path} at ${width}`).toBeLessThanOrEqual(bounds.client);
    }
  }
});


test('UX-AUD2-024: sync warnings form one sentence with lowercase relative time', async ({ page }, testInfo) => {
  await mockAuthenticatedApp(page, { latestRun: {
    run_id: 'run-warnings', source_system: 'cyberark', status: 'partial',
    enqueued_at: new Date().toISOString(), started_at: new Date().toISOString(), completed_at: new Date().toISOString(),
    expected_safe_count: 465, received_safe_count: 465, received_member_count: 0, received_object_count: 465,
    error_count: 1, retired_object_count: 0, retired_relationship_count: 0,
  } });
  await page.goto('/pam/safes');
  await expect(page.locator('html')).toHaveAttribute('data-theme', testInfo.project.name.includes('light') ? 'light' : 'dark');
  await expect(page.locator('.run-summary')).toContainText('Última sincronización con avisos');
  await expect(page.locator('.run-summary time')).toHaveAttribute('title', /^hace /);
  await expect(page.locator('.run-summary span')).not.toContainText('hace');
});

test('UX-AUD2-024: existing inventory searches keep the system control in desktop themes', async ({ page }) => {
  await mockAuthenticatedApp(page, { includeSafe: true });
  for (const path of ['/pam/safes', '/chains/person', '/pam/identity/users', '/pam/roles', '/pam/platforms', '/pam/connectors', '/pam/sia', '/pam/sia/resources', '/pam/sia/database-accounts']) {
    await page.goto(path);
    await expectSystemSearch(page.getByRole('searchbox').first());
  }
});
