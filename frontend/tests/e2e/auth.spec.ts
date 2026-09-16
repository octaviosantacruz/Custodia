import AxeBuilder from '@axe-core/playwright';
import { expect, mockAuthenticatedApp, test, unauthenticated } from './fixtures';
import type { Page } from '@playwright/test';

test('login view exposes an accessible form', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('openpam-theme', 'light'));
  await page.route('**/api/auth/status', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(unauthenticated),
  }));
  await page.goto('/pam');

  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Contraseña')).toBeVisible();
  await expect.poll(() => page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    legacyTheme: window.localStorage.getItem('openpam-theme'),
    currentTheme: window.localStorage.getItem('dshub-theme:v1'),
  }))).toEqual({ theme: 'light', legacyTheme: null, currentTheme: 'light' });

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('hybrid login offers local and Okta access paths', async ({ page }) => {
  await page.route('**/api/auth/status', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ...unauthenticated, mode: 'hybrid' }),
  }));
  await page.goto('/');

  await expect(page.getByRole('tab', { name: 'Acceso local' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Contraseña')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible();
  await page.getByRole('tab', { name: 'Okta corporativo' }).click();
  await expect(page.getByLabel('Email corporativo')).toBeVisible();
  await expect(page.getByLabel('Contraseña')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continuar con Okta' })).toBeVisible();
});

test('hybrid login method switch supports arrow-key roving navigation', async ({ page }) => {
  await page.route('**/api/auth/status', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ...unauthenticated, mode: 'hybrid' }),
  }));
  await page.goto('/');

  const localTab = page.getByRole('tab', { name: 'Acceso local' });
  const oidcTab = page.getByRole('tab', { name: 'Okta corporativo' });
  await expect(localTab).toHaveAttribute('tabindex', '0');
  await expect(oidcTab).toHaveAttribute('tabindex', '-1');

  await localTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(oidcTab).toBeFocused();
  await expect(oidcTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Email corporativo')).toBeVisible();

  await page.keyboard.press('ArrowLeft');
  await expect(localTab).toBeFocused();
  await expect(localTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Email')).toBeVisible();
});

test('hovering CyberArk syncs the left action and visibility wheel states', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/');

  const cyberArkAction = page.locator('.home-domain-button').filter({ hasText: 'CyberArk PAM' });
  const cyberArkNode = page.locator('.home-visibility-node-cyberark');
  await cyberArkAction.hover();

  await expect(cyberArkAction).toHaveAttribute('title', 'Abrir métricas, inventario y gobierno de CyberArk PAM');
  await expect(page.locator('.home-visibility')).toHaveAttribute('data-active-domain', 'cyberark');
  await expect(page.locator('.home-visibility-node-cyberark')).toHaveCSS('border-color', 'rgb(53, 196, 119)');
  await expect(cyberArkAction).toHaveClass(/is-active/);

  await cyberArkNode.hover();
  await expect(cyberArkAction).toHaveClass(/is-active/);
});

test('Netskope DLP is clickable from home and lands on its preparation workspace', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/');

  const netskopeAction = page.locator('.home-domain-button').filter({ hasText: 'Netskope DLP' });
  const netskopeNode = page.locator('.home-visibility-node-netskope');
  await expect(netskopeAction).not.toHaveAttribute('aria-disabled', 'true');
  await expect(netskopeAction).not.toHaveText(/Próximamente/);
  await netskopeAction.hover();
  await expect(page.locator('.home-visibility')).toHaveAttribute('data-active-domain', 'netskope');
  await expect(netskopeAction).toHaveClass(/is-active/);

  await netskopeAction.click();
  await expect(page).toHaveURL(/\/netskope$/);
  await expect(page.getByRole('heading', { name: 'Workspace habilitado' })).toBeVisible();
  await expect(page.getByText(/Todavía no hay una fuente configurada ni datos sincronizados/)).toBeVisible();

  await page.goto('/');
  await netskopeNode.click();
  await expect(page).toHaveURL(/\/netskope$/);
});

test('BigID DSPM stays disabled and unclickable from home', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/');

  const bigIdAction = page.locator('.home-domain-button').filter({ hasText: 'BigID DSPM' });
  await expect(bigIdAction).toHaveAttribute('aria-disabled', 'true');
  await expect(bigIdAction).toHaveText(/Próximamente/);
});

test('administration is available from home for authorized users', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/');

  await expect(page.locator('.home-admin-button')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Abrir Administración' })).toBeVisible();
  await page.getByRole('button', { name: /Cambiar herramienta/ }).click();
  const toolMenu = page.getByRole('region', { name: 'Herramientas' });
  await expect(toolMenu.getByRole('button', { name: /Inicio Resumen general de DS Hub/ })).toBeVisible();
  await expect(toolMenu.getByRole('button', { name: /Inicio Resumen general de DS Hub/ })).toHaveAttribute('aria-current', 'page');
  await toolMenu.getByRole('button', { name: /Inicio Resumen general de DS Hub/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Herramientas' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Abrir Administración' }).click();

  await expect(page).toHaveURL(/\/admin\/access$/);
});

test('top navigation separates tool selection from workspace selection', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam');

  await expect(page.getByRole('button', { name: /Cambiar herramienta.*CyberArk PAM/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Cambiar workspace.*Métricas/ })).toBeVisible();
  await page.getByRole('button', { name: /Cambiar herramienta/ }).click();

  const tools = page.getByRole('region', { name: 'Herramientas' });
  await expect(tools.getByRole('button', { name: /CyberArk PAM/ })).toBeVisible();
  await expect(tools.getByRole('button', { name: /Netskope DLP/ })).toBeEnabled();
  await expect(tools.getByRole('button', { name: /BigID DSPM/ })).toBeDisabled();
  await tools.getByRole('button', { name: /Administración/ }).click();

  await expect(page).toHaveURL(/\/admin\/access$/);
  await expect(page.getByRole('button', { name: /Cambiar workspace.*Acceso/ })).toBeVisible();
});

test('home marks only Inicio as the current navigation destination', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/');

  await page.getByRole('button', { name: /Cambiar herramienta.*Inicio/ }).click();
  const tools = page.getByRole('region', { name: 'Herramientas' });
  await expect(tools.getByRole('button', { name: /Inicio Resumen general de DS Hub/ })).toHaveAttribute('aria-current', 'page');
  await expect(tools.getByRole('button', { name: /CyberArk PAM Accesos privilegiados/ })).not.toHaveAttribute('aria-current');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /Cambiar workspace.*Inicio/ }).click();
  const workspaces = page.getByRole('region', { name: 'Workspaces' });
  await expect(workspaces.getByRole('button', { name: /Métricas Cobertura y decisiones pendientes/ })).not.toHaveAttribute('aria-current');
});

test('split navigation remains accessible in light theme', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('dshub-theme:v1', 'light'));
  await mockAuthenticatedApp(page);
  await page.goto('/pam/safes');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.getByRole('button', { name: /Cambiar herramienta/ }).click();
  const toolResults = await new AxeBuilder({ page }).include('.tool-menu').analyze();
  expect(toolResults.violations).toEqual([]);
  await page.getByRole('button', { name: /Cambiar herramienta/ }).click();

  await page.getByRole('button', { name: /Cambiar workspace/ }).click();
  const workspaceResults = await new AxeBuilder({ page }).include('.workspace-menu').analyze();
  expect(workspaceResults.violations).toEqual([]);
});

test('access administration exposes a clear role and permission editor', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/admin/access');

  await expect(page.getByRole('tab', { name: /Roles y permisos/ })).toBeVisible();
  await page.getByRole('tab', { name: /Roles y permisos/ }).click();
  await expect(page.getByRole('heading', { name: 'Roles y permisos' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Netskope · Lector/ })).toBeVisible();
  await page.getByRole('button', { name: /Netskope · Lector/ }).click();
  await expect(page.getByText('Preparado', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('read', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: /Nuevo permiso/ }).click();
  const permissionForm = page.locator('.permission-create-form');
  await permissionForm.getByLabel('Recurso').fill('safes');
  await permissionForm.getByLabel('Acción').fill('export');
  await permissionForm.getByLabel('Descripción').fill('Exportar Safes');
  await permissionForm.getByRole('button', { name: 'Crear permiso' }).click();
  await expect(page.getByText('Permiso personalizado creado')).toBeVisible();
});

test('access administration tablist supports arrow-key roving navigation', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/admin/access');

  const peopleTab = page.getByRole('tab', { name: /Personas/ });
  const rolesTab = page.getByRole('tab', { name: /Roles y permisos/ });
  await expect(peopleTab).toHaveAttribute('tabindex', '0');
  await expect(rolesTab).toHaveAttribute('tabindex', '-1');

  await peopleTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(rolesTab).toBeFocused();
  await expect(rolesTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Roles y permisos' })).toBeVisible();

  await page.keyboard.press('ArrowRight');
  await expect(peopleTab).toBeFocused();
  await expect(peopleTab).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('ArrowLeft');
  await expect(rolesTab).toBeFocused();
  await expect(rolesTab).toHaveAttribute('aria-selected', 'true');
});

test('people access keeps rows minimal and edits access in a detail drawer', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/admin/access');

  const detailButton = page.getByRole('button', { name: 'Ver acceso de Carlos Ortiz' });
  await expect(detailButton).toBeVisible();
  await expect(page.getByText('Administrador de plataforma', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('access:manage', { exact: true })).toHaveCount(0);
  await detailButton.click();

  const drawer = page.getByRole('dialog', { name: 'Carlos Ortiz' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('access:manage', { exact: true })).toBeVisible();
  await expect(drawer).toContainText('8 permisos');

  await page.getByRole('button', { name: 'Cambiar rol de Carlos Ortiz' }).click();
  await expect(page.getByPlaceholder('Buscar rol o producto')).toBeVisible();
  await expect(page.getByRole('option', { name: /Lector de plataforma/ })).toBeVisible();
  await expect(page.getByText('Plataforma', { exact: true })).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).include('.user-access-drawer').analyze();
  expect(accessibility.violations).toEqual([]);

  await drawer.getByRole('button', { name: 'Cerrar detalle de acceso' }).click();
  await expect(drawer).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await detailButton.scrollIntoViewIfNeeded();
  await detailButton.click();
  await page.locator('.user-access-drawer').evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  const mobileDrawer = await page.locator('.user-access-drawer').boundingBox();
  expect(mobileDrawer).not.toBeNull();
  expect(mobileDrawer!.x).toBeGreaterThanOrEqual(0);
  expect(mobileDrawer!.x + mobileDrawer!.width).toBeLessThanOrEqual(390);
});

test('AUD-A11Y-001: the user detail drawer traps focus and returns it to the trigger on close', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/admin/access');

  const detailButton = page.getByRole('button', { name: 'Ver acceso de Carlos Ortiz' });
  await detailButton.click();

  const drawer = page.getByRole('dialog', { name: 'Carlos Ortiz' });
  await expect(drawer).toBeVisible();
  const closeButton = drawer.getByRole('button', { name: 'Cerrar detalle de acceso' });
  await expect(closeButton).toBeFocused();

  // Shift+Tab from the first focusable element must cycle to the last one,
  // never leaking focus onto the page behind the drawer.
  await page.keyboard.press('Shift+Tab');
  const lastFocusable = drawer.locator(':focus');
  await expect(lastFocusable).toBeVisible();
  const isInsideDrawer = await lastFocusable.evaluate((element, drawerClass) => Boolean(element.closest(`.${drawerClass}`)), 'user-access-drawer');
  expect(isInsideDrawer).toBe(true);

  // Escape closes the drawer and gives focus back to the button that opened it.
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(detailButton).toBeFocused();
});

test('AUD-A11Y-001/002: the delete-user confirm dialog traps focus via the shared ConfirmDialog', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/admin/access');

  await page.getByRole('button', { name: 'Ver acceso de Carlos Ortiz' }).click();
  const deleteTrigger = page.getByRole('button', { name: 'Eliminar' });
  await deleteTrigger.click();

  const confirmDialog = page.getByRole('alertdialog', { name: 'Eliminar usuario' });
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog.getByRole('button', { name: 'Cerrar' })).toBeFocused();

  // Tab from the last focusable action must cycle back to the first one.
  await confirmDialog.getByRole('button', { name: 'Eliminar usuario' }).focus();
  await page.keyboard.press('Tab');
  await expect(confirmDialog.getByRole('button', { name: 'Cerrar' })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(confirmDialog).toBeHidden();
  // The drawer behind the confirm dialog is a JSX sibling, not an ancestor
  // -- this proves Escape closing the (now-unmounted) ConfirmDialog never
  // bubbles into the still-open parent drawer's own focus trap and closes
  // it too. Regression-tested directly: a leftover document-level Escape
  // listener in user-admin.tsx used to do exactly that before it was
  // removed in favor of the shared hook.
  const drawer = page.getByRole('dialog', { name: 'Carlos Ortiz' });
  await expect(drawer).toBeVisible();
  await expect(deleteTrigger).toBeFocused();
});

test('custom roles compose one dynamic level per domain', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/admin/access');
  await page.getByRole('tab', { name: /Roles y permisos/ }).click();
  await page.getByRole('button', { name: /Nuevo rol/ }).click();
  await page.getByRole('menuitem', { name: /Rol custom/ }).click();

  await expect(page.getByRole('heading', { name: 'Combinar niveles por dominio' })).toBeVisible();
  await expect(page.getByText('Netskope DLP', { exact: true })).toBeVisible();
  await expect(page.getByText('BigID DSPM', { exact: true })).toBeVisible();
  await expect(page.getByText(/La combinación coincide con/)).toContainText('Lectura de seguridad');
  await page.getByLabel('Nombre visible').fill('Responsable de seguridad');
  await page.getByLabel('Código interno').fill('security_lead');
  await page.getByLabel('Descripción').fill('Acceso combinado para el equipo de seguridad');
  await page.getByRole('button', { name: 'Crear rol custom' }).click();
  await expect(page.getByText(/Rol guardado.*Lectura de seguridad/)).toBeVisible();
});

test('session-check failures have a visible retry path', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/auth/status', async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.abort('failed');
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(unauthenticated),
    });
  });
  await page.goto('/pam');

  await expect(page.getByRole('heading', { name: 'No se pudo comprobar la sesión' })).toBeVisible();
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
});

test('top navigation exposes context and keeps its controls accessible', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/assets');

  const topbar = page.locator('.topbar');
  await expect(topbar.getByRole('button', { name: 'Ir al inicio de DS Hub' })).toBeVisible();
  await expect(topbar.locator('.topbar-leading > *')).toHaveCount(5);
  await expect(topbar.locator('.topbar-leading > *').nth(2)).toHaveClass(/brand/);
  await expect(topbar.locator('.topbar-leading > *').nth(3)).toHaveClass(/global-search-trigger/);
  await expect(topbar.locator('.topbar-location')).toContainText('Activos y conexiones');
  await expect(topbar.getByRole('button', { name: /Cambiar herramienta.*CyberArk PAM/ })).toBeVisible();
  await expect(topbar.getByRole('button', { name: /Cambiar workspace.*Activos y conexiones/ })).toBeVisible();
  await expect(topbar.getByRole('button', { name: 'Abrir notificaciones' })).toBeVisible();
  await expect(topbar.getByRole('switch', { name: 'Incluir internos CyberArk' })).toHaveCount(0);

  await topbar.getByRole('button', { name: /Cambiar herramienta/ }).click();
  const toolMenu = page.getByRole('region', { name: 'Herramientas' });
  await expect(toolMenu.getByRole('button', { name: /Inicio Resumen general de DS Hub/ })).toBeVisible();
  await expect(toolMenu.getByRole('button', { name: /CyberArk PAM Accesos privilegiados/ })).toHaveAttribute('aria-current', 'page');
  await topbar.getByRole('button', { name: /Cambiar herramienta/ }).click();

  await topbar.getByRole('button', { name: 'Abrir menú de usuario' }).click();
  const profileMenu = page.getByRole('region', { name: 'Menú de usuario' });
  await expect(profileMenu.getByRole('button', { name: 'Abrir notificaciones' })).toHaveCount(0);
  await expect(profileMenu.getByRole('button', { name: 'Cambiar a modo claro' })).toBeVisible();
  await expect(profileMenu.getByRole('switch', { name: 'Incluir internos CyberArk' })).toBeVisible();

  const profileResults = await new AxeBuilder({ page })
    .include('.profile-menu')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(profileResults.violations).toEqual([]);
  await topbar.getByRole('button', { name: 'Abrir menú de usuario' }).click();

  const topbarResults = await new AxeBuilder({ page })
    .include('.topbar')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(topbarResults.violations).toEqual([]);

  await topbar.getByRole('button', { name: /Cambiar workspace/ }).click();
  const workspaceMenu = page.locator('.workspace-menu');
  await expect(workspaceMenu.locator('.workspace-menu-heading')).toHaveCount(0);
  await expect(workspaceMenu.locator('.workspace-menu-header')).toContainText('Vistas de PAM');

  const menuResults = await new AxeBuilder({ page })
    .include('.workspace-menu')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(menuResults.violations).toEqual([]);

  await page.goto('/pam/sia');
  const siaTopbar = page.locator('.topbar');
  await expect(siaTopbar.locator('.topbar-location')).toContainText('SIA');
  await expect(siaTopbar.getByRole('button', { name: /Sincronizar datos/ })).toBeVisible();
});

async function searchAndSelect(page: Page, group: string, optionName: string) {
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Command center' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Buscar inventario, herramientas y acciones' }).fill('Fin');
  await dialog.locator('.global-search-group').filter({ hasText: group }).getByRole('option', { name: optionName }).click();
  await expect(dialog).toHaveCount(0);
}

test('global inventory search opens with Ctrl+K and seeds selected workspaces', async ({ page }) => {
  let searchRequest = '';
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/search') searchRequest = request.url();
  });
  await mockAuthenticatedApp(page, { includeSafe: true });
  await page.goto('/pam');

  await expect(page.getByRole('button', { name: 'Abrir command center' })).toBeVisible();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Command center' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Buscar inventario, herramientas y acciones' }).fill('Fin');
  await expect.poll(() => searchRequest ? new URL(searchRequest).searchParams.get('q') : null).toBe('Fin');
  await expect.poll(() => searchRequest ? new URL(searchRequest).searchParams.get('include_internal') : null).toBe('true');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await searchAndSelect(page, 'Safes', 'Finance');
  await expect(page).toHaveURL(/\/pam\/safes$/);
  await expect(page.locator('input[placeholder="Buscar por nombre o Safe URL ID"]:visible')).toHaveValue('Finance');

  await searchAndSelect(page, 'Políticas SIA', 'Finance access');
  await expect(page).toHaveURL(/\/pam\/sia$/);
  await expect(page.getByRole('searchbox', { name: 'Buscar políticas SIA por nombre o descripción' })).toHaveValue('Finance access');

  await searchAndSelect(page, 'Usuarios PAM', 'Ada PAM');
  await expect(page).toHaveURL(/\/pam\/graph$/);
  await expect(page.getByRole('searchbox', { name: 'Buscar usuarios PAM por nombre o identificador' })).toHaveValue('Ada PAM');

  await searchAndSelect(page, 'Roles PAM', 'Finance operators');
  await expect(page).toHaveURL(/\/pam\/roles$/);
  await expect(page.getByRole('searchbox', { name: 'Buscar roles cyberark' })).toHaveValue('Finance operators');

  await searchAndSelect(page, 'Usuarios de Identity Administration', 'Ada Lovelace');
  await expect(page).toHaveURL(/\/pam\/identity/);
  await expect(page.getByRole('searchbox', { name: 'Buscar usuarios de Identity Administration' })).toHaveValue('Ada Lovelace');

  await searchAndSelect(page, 'Conexiones', 'db-finance-01');
  await expect(page).toHaveURL(/\/pam\/assets$/);
  await expect(page.getByRole('searchbox', { name: 'Buscar conexiones por IP o instancia' })).toHaveValue('10.0.0.1');
});

test('global inventory search surfaces a failed backend call instead of a fake empty state', async ({ page }) => {
  await mockAuthenticatedApp(page, { includeSafe: true });
  await page.route('**/api/search*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"boom"}' }));
  await page.goto('/pam');

  await expect(page.getByRole('button', { name: 'Abrir command center' })).toBeVisible();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Command center' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Buscar inventario, herramientas y acciones' }).fill('Fin');

  await expect(dialog.getByRole('alert')).toHaveText('No se pudo completar la búsqueda. Probá de nuevo.');
  await expect(dialog.getByText('No se encontraron coincidencias.')).toHaveCount(0);
});

test('command center only exposes authorized tools and actions', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'] });
  await page.goto('/pam');
  await page.getByRole('button', { name: 'Abrir command center' }).click();
  const dialog = page.getByRole('dialog', { name: 'Command center' });
  await expect(dialog.getByRole('option', { name: 'Abrir Safes' })).toBeVisible();
  await expect(dialog.getByRole('option', { name: 'Administrar acceso' })).toHaveCount(0);
  await expect(dialog.getByRole('option', { name: 'Sincronizar datos' })).toHaveCount(0);

  await page.keyboard.press('Escape');
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'ingestion:run'] });
  await page.reload();
  await page.getByRole('button', { name: 'Abrir command center' }).click();
  await expect(page.getByRole('dialog', { name: 'Command center' }).getByRole('option', { name: 'Sincronizar datos' })).toBeVisible();
});

test('quick access allows six PAM entries and removes a retired saved shortcut', async ({ page }) => {
  let savedVisibleWorkspaces: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/workspaces/preferences' && request.method() === 'PUT') {
      savedVisibleWorkspaces = (request.postDataJSON() as { visible_workspaces: string[] }).visible_workspaces;
    }
  });
  await mockAuthenticatedApp(page, { initialVisibleWorkspaces: ['safes', 'users', 'aimApplications'] });
  await page.goto('/pam');
  await page.getByRole('button', { name: /Cambiar workspace/ }).click();
  const menu = page.getByRole('region', { name: 'Workspaces' });
  await expect(menu.locator('[data-section="quick-access"]').getByRole('button', { name: /Postura/ })).toHaveCount(0);
  await expect(menu.locator('[data-section="quick-access"]').getByRole('button', { name: /Cadenas/ })).toHaveCount(0);
  await menu.getByRole('button', { name: 'Personalizar accesos rápidos' }).click();
  const editor = menu.getByRole('dialog', { name: 'Accesos rápidos' });
  await expect(editor).toBeFocused();
  await expect(editor.getByText('1 de 6 disponibles aquí')).toBeVisible();
  await expect(editor.getByText('1 guardados en otra herramienta')).toBeVisible();
  await expect(editor.getByText('Postura', { exact: true })).toBeVisible();
  await editor.getByLabel(/Postura/).check();
  await editor.getByLabel(/Métricas/).check();
  await editor.getByLabel(/Cadenas/).check();
  await editor.getByLabel(/Identidades/).check();
  await editor.getByLabel(/^SIA/).check();
  await expect(editor.getByText('6 de 6 disponibles aquí')).toBeVisible();
  await editor.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect.poll(() => savedVisibleWorkspaces).toEqual(['users', 'safes', 'posture', 'general', 'graph', 'identity', 'sia']);
  await expect(page.getByRole('button', { name: /Cambiar workspace/ })).toBeFocused();
  await expect(menu.locator('[data-section="quick-access"]').getByRole('button', { name: /Postura/ })).toBeVisible();
  await expect(menu.locator('[data-section="quick-access"]').getByRole('button', { name: /SIA/ })).toBeVisible();
  await expect(menu.locator('[data-section="quick-access"]').getByRole('button')).toHaveCount(6);

  await page.reload();
  await page.getByRole('button', { name: /Cambiar workspace/ }).click();
  await expect(page.getByRole('region', { name: 'Workspaces' }).locator('[data-section="quick-access"]').getByRole('button', { name: /Postura/ })).toBeVisible();

  await page.getByRole('region', { name: 'Workspaces' }).locator('[data-section="quick-access"]').getByRole('button', { name: /Cadenas.*Explorador visual/ }).click();
  await expect(page).toHaveURL(/\/pam\/graph$/);

  await page.getByRole('button', { name: 'Abrir command center' }).click();
  const dialog = page.getByRole('dialog', { name: 'Command center' });
  await expect(dialog.getByRole('option', { name: 'Abrir Cadenas' })).toBeVisible();
  await expect(dialog.getByRole('option', { name: 'Abrir Cadenas' }).locator('svg')).toHaveCount(1);
});
