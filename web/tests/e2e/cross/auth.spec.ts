import { expectSystemSearch } from '../support/search-control';
import AxeBuilder from '@axe-core/playwright';
import { expect, mockAuthenticatedApp, test, unauthenticated } from '../support/fixtures';
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
  await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
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

test('AUTH-AGENT-001 hybrid main login offers only Okta', async ({ page }) => {
  await page.route('**/api/auth/status', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ...unauthenticated, mode: 'hybrid' }),
  }));
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Iniciar sesión', level: 1 })).toBeVisible();
  await expect(page.locator('.auth-backdrop')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByRole('textbox', { name: 'Email corporativo', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar con Okta' })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toHaveCount(0);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
});

test('AUTH-AGENT-001 hybrid local login lives on its own path and returns to the app root', async ({ page }) => {
  await mockAuthenticatedApp(page, { authMode: 'hybrid' });
  let signedIn = false;
  const logins: unknown[] = [];
  await page.route('**/api/auth/login', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    logins.push(route.request().postDataJSON());
    signedIn = true;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: true }) });
  });
  await page.route('**/api/auth/status', (route) => signedIn ? route.fallback() : route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ...unauthenticated, mode: 'hybrid' }),
  }));
  await page.goto('/login/local');

  await expect(page.getByRole('button', { name: 'Continuar con Okta' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Entrar con Okta' })).toHaveAttribute('href', '/');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('agent@example.com');
  await page.locator('input[type="password"]').fill('a-long-agent-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await expect(page.getByRole('button', { name: 'Abrir menú de usuario' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
  expect(logins).toEqual([{ email: 'agent@example.com', password: 'a-long-agent-password' }]);
});

test('AUTH-LOGIN-UI-001 the login is one card: one mark, short scope, and an informational inactivity notice above the Okta form', async ({ page }) => {
  await page.clock.install();
  await mockAuthenticatedApp(page, { authMode: 'hybrid' });
  await page.goto('/pam');
  await expect(page.getByRole('button', { name: 'Abrir menú de usuario' })).toBeVisible();
  await page.route('**/api/auth/status', (route) => route.fulfill({ json: { ...unauthenticated, mode: 'hybrid' } }));
  await page.clock.fastForward('15:01');

  const notice = page.locator('.auth-notice');
  await expect(notice).toHaveText('Tu sesión venció por inactividad. Volvé a entrar.');
  await expect(notice).toHaveAttribute('role', 'status');
  await expect(page.locator('.auth-error')).toHaveCount(0);
  const okta = page.getByRole('button', { name: 'Continuar con Okta' });
  expect((await notice.boundingBox())!.y).toBeLessThan((await okta.boundingBox())!.y);
  await expect(page.locator('.auth-logo')).toHaveCount(1);
  await expect(page.locator('.auth-card')).toHaveCount(1);
  await expect(page.getByText('Portal de métricas y relaciones entre herramientas de seguridad', { exact: true })).toBeVisible();
  await expect(page.getByText(/identidades privilegiadas|Te vamos a llevar a Okta/)).toHaveCount(0);
  // The optional email hint for Okta stays until that change is decided.
  await expect(page.getByRole('textbox', { name: 'Email corporativo', exact: true })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
});

test('login removes decorative motion when reduced motion is requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/auth/status', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ...unauthenticated, mode: 'hybrid' }),
  }));
  await page.goto('/');

  await expect(page.locator('.auth-card')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.auth-form-stage')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.auth-backdrop')).toHaveCSS('animation-name', 'none');
  expect(await page.locator('.auth-logo .custodia-mark').evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
});

test('Mi cuenta lets a local account manage name and password in hybrid mode', async ({ page }) => {
  await mockAuthenticatedApp(page, {
    authMode: 'hybrid',
    sessionUser: { actor_id: 'local-1', name: 'Local Uno', email: 'local@example.com', roles: ['admin'], role_names: ['Administrador de plataforma'], auth_source: 'local' },
  });
  await page.goto('/pam');
  await page.getByRole('button', { name: 'Abrir menú de usuario' }).click();
  await page.getByRole('button', { name: 'Mi cuenta' }).click();

  const dialog = page.getByRole('dialog', { name: 'Datos personales' });
  await expect(dialog.getByRole('button', { name: 'Guardar nombre' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cambiar contraseña' })).toBeVisible();
  await expect(dialog.getByText('Cuenta administrada por tu identidad corporativa')).toHaveCount(0);
});

test('Mi cuenta keeps OIDC accounts provider-managed in hybrid mode', async ({ page }) => {
  await mockAuthenticatedApp(page, {
    authMode: 'hybrid',
    sessionUser: { actor_id: 'okta-1', name: 'Okta Uno', email: 'okta@example.com', roles: ['admin'], role_names: ['Administrador de plataforma'], auth_source: 'oidc' },
  });
  await page.goto('/pam');
  await page.getByRole('button', { name: 'Abrir menú de usuario' }).click();
  await page.getByRole('button', { name: 'Mi cuenta' }).click();

  const dialog = page.getByRole('dialog', { name: 'Datos personales' });
  await expect(dialog.getByText('Cuenta administrada por tu identidad corporativa')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cambiar contraseña' })).toHaveCount(0);
});

test('hovering CyberArk syncs the left action and visibility wheel states', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/');

  const cyberArkAction = page.locator('.home-domain-button').filter({ hasText: 'CyberArk' });
  const cyberArkNode = page.locator('.home-visibility-node-cyberark');
  await cyberArkAction.hover();

  await expect(cyberArkAction).toHaveAttribute('title', 'Abrir el tablero, inventario y accesos de CyberArk');
  await expect(page.locator('.home-visibility')).toHaveAttribute('data-active-domain', 'cyberark');
  await expect(page.locator('.home-visibility-node-cyberark')).toHaveCSS('border-color', 'rgb(53, 196, 119)');
  await expect(cyberArkAction).toHaveClass(/is-active/);
  await expect(page.locator('.home-visibility-satellite, .home-visibility-line-identity, .home-visibility-line-sia')).toHaveCount(0);

  await cyberArkNode.hover();
  await expect(cyberArkAction).toHaveClass(/is-active/);
});

test('Netskope is reachable from home and the visibility wheel follows the card', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/');

  const netskopeAction = page.locator('.home-domain-button-netskope');
  const netskopeNode = page.locator('.home-visibility-node-netskope');
  const netskopeEdge = page.locator('.home-visibility-line-netskope');

  await expect(netskopeAction).not.toHaveAttribute('aria-disabled', 'true');
  await expect(netskopeAction).not.toHaveText(/Próximamente/);

  await netskopeAction.hover();
  await expect(page.locator('.home-visibility')).toHaveAttribute('data-active-domain', 'netskope');
  await expect(netskopeAction).toHaveClass(/is-active/);
  await expect(netskopeNode).toHaveClass(/is-active/);
  await expect(netskopeNode).toHaveCSS('border-color', 'rgb(53, 196, 119)');
  await expect(netskopeEdge).toHaveClass(/is-active/);
  await expect(netskopeEdge).toHaveCSS('background-color', 'rgb(53, 196, 119)');

  await expect(page.getByRole('button', { name: 'Abrir Netskope' })).toBeVisible();
  await netskopeNode.click();
  await expect(page).toHaveURL(/\/netskope$/);
  await expect(page.getByRole('heading', { name: 'Datos clave', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Datos clave' })).toBeVisible();
});

test('BigID DSPM stays disabled and unclickable from home', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/');

  const bigIdAction = page.locator('.home-domain-button').filter({ hasText: 'BigID DSPM' });
  await expect(bigIdAction).toHaveAttribute('aria-disabled', 'true');
  await expect(bigIdAction).toHaveText(/Próximamente/);
});

test('Administration is reached from the profile menu and the tool menu, not from the home wheel', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/');

  await expect(page.locator('.home-admin-button')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Abrir Administración' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Abrir Custodia' })).toHaveCount(0);
  await expect(page.locator('.home-visibility-core')).toHaveText('Conexiones');
  await page.getByRole('button', { name: /Cambiar herramienta/ }).click();
  const toolMenu = page.getByRole('region', { name: 'Herramientas' });
  await expect(toolMenu.getByRole('button', { name: /Inicio Resumen general de Custodia/ })).toBeVisible();
  await expect(toolMenu.getByRole('button', { name: /Inicio Resumen general de Custodia/ })).toHaveAttribute('aria-current', 'page');
  // Conexiones and Administración are separate tools; the person view lives in the first.
  await expect(toolMenu.getByRole('button', { name: /^Administración / })).toBeVisible();
  await toolMenu.getByRole('button', { name: /^Conexiones / }).click();

  // UX-IA-001: Conexiones lands on its first accessible workspace (Personas).
  await expect(page).toHaveURL(/\/chains\/person$/);
  await expect(page.getByRole('searchbox', { name: 'Buscar persona por correo o nombre' })).toBeVisible();
});

test('top navigation separates tool selection from workspace selection', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam');

  await expect(page.getByRole('button', { name: /Cambiar herramienta. Actual: CyberArk$/ })).toBeVisible();
  await expect(page.getByRole('banner').getByRole('button', { name: /Cambiar workspace/ })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Secciones de CyberArk', exact: true }).getByRole('link', { name: 'Métricas', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: /Cambiar herramienta/ }).locator('.tool-logo img:visible')).toHaveAttribute('src', '/cyberark-logo-white.png');
  await page.getByRole('button', { name: /Cambiar herramienta/ }).click();

  const tools = page.getByRole('region', { name: 'Herramientas' });
  await expect(tools.getByRole('button', { name: /^CyberArk PAM, Identity Administration/ })).toBeVisible();
  await expect(tools.getByRole('button', { name: /Netskope/ })).toBeEnabled();
  await expect(tools.getByRole('button', { name: /BigID DSPM/ })).toBeDisabled();
  await tools.getByRole('button', { name: /^Conexiones / }).click();

  await expect(page).toHaveURL(/\/chains\/person$/);
  await expect(page.getByRole('button', { name: /Cambiar workspace.*Personas/ })).toBeVisible();
  const trigger = page.getByRole('button', { name: /Cambiar herramienta/ });
  await expect(trigger.locator('svg')).toHaveClass(/lucide-waypoints/);
  await trigger.click();
  await tools.getByRole('button', { name: /Netskope/ }).click();
  await expect(trigger).toHaveAttribute('aria-label', 'Cambiar herramienta. Actual: Netskope');
  await expect(trigger.locator('.tool-logo img:visible')).toHaveAttribute('src', '/netskope-full-white.png');
  await trigger.click();
  await tools.getByRole('button', { name: /Inicio Resumen general/ }).click();
  await expect(trigger).toHaveAttribute('aria-label', 'Cambiar herramienta. Actual: Inicio');
  await expect(trigger.locator('svg')).toHaveClass(/lucide-house/);
});

test('home marks only Inicio as the current navigation destination', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/');

  await page.getByRole('button', { name: /Cambiar herramienta.*Inicio/ }).click();
  const tools = page.getByRole('region', { name: 'Herramientas' });
  await expect(tools.getByRole('button', { name: /Inicio Resumen general de Custodia/ })).toHaveAttribute('aria-current', 'page');
  await expect(tools.getByRole('button', { name: /CyberArk PAM, Identity Administration, SIA y Access/ })).not.toHaveAttribute('aria-current');
  await page.keyboard.press('Escape');

  await expect(page.getByRole('banner').getByRole('button', { name: /Cambiar workspace/ })).toHaveCount(0);
  await expect(page.getByRole('banner').getByRole('button', { name: /Cambiar herramienta.*Inicio/ })).toHaveCount(1);
});

test('split navigation remains accessible in light theme', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('dshub-theme:v1', 'light'));
  await mockAuthenticatedApp(page);
  await page.goto('/chains/person');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.getByRole('button', { name: /Cambiar herramienta/ }).click();
  const toolResults = await new AxeBuilder({ page }).include('.tool-menu').analyze();
  expect(toolResults.violations).toEqual([]);
  await page.getByRole('button', { name: /Cambiar herramienta/ }).click();

  await page.getByRole('button', { name: /Cambiar workspace/ }).click();
  const workspaceResults = await new AxeBuilder({ page }).include('.workspace-menu').analyze();
  expect(workspaceResults.violations).toEqual([]);
});

test('ACCESS-REVIEW-001: the review lists assignments with their signals, filters and honest gaps', async ({ page }) => {
  await mockAuthenticatedApp(page);
  const base = { total: 3, limit: 25, offset: 0, days: 90, summary: { assignments: 3, attention: 2, inactive_account: 0, manual_old: 1, stale_login: 1 } };
  const rows = [
    { actor_id: 'ana@acme.example', email: 'ana@acme.example', display_name: 'Ana Pérez', is_active: true, auth_source: 'local', last_login_at: null, role_code: 'reader', role_name: 'Lector de plataforma', source: 'manual', granted_at: '2026-05-01T12:00:00Z', granted_by: 'Admin Uno', flags: ['manual_old'] },
    { actor_id: 'beto@acme.example', email: 'beto@acme.example', display_name: 'Beto Gómez', is_active: true, auth_source: 'oidc', last_login_at: '2026-03-01T12:00:00Z', role_code: 'reader', role_name: 'Lector de plataforma', source: 'oidc', granted_at: null, granted_by: null, flags: ['stale_login'] },
    { actor_id: 'carla@acme.example', email: 'carla@acme.example', display_name: 'Carla Ruiz', is_active: true, auth_source: 'local', last_login_at: null, role_code: 'operator', role_name: 'Operador', source: 'manual', granted_at: '2026-10-10T12:00:00Z', granted_by: null, flags: [] },
  ];
  const requests: URLSearchParams[] = [];
  await page.route('**/api/auth/access-review?*', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    requests.push(params);
    const flag = params.get('flag');
    const shown = flag === 'attention' ? rows.filter((row) => row.flags.length) : flag === 'stale_login' ? rows.filter((row) => row.flags.includes('stale_login')) : rows;
    return route.fulfill({ json: { ...base, total: shown.length, rows: shown, days: Number(params.get('days')) } });
  });
  await page.goto('/admin/access');
  await page.getByRole('tab', { name: /Revisión de accesos/ }).click();

  // Opens on what needs attention, with the counts of the whole review on the filters.
  await expect(page.getByRole('heading', { name: 'Revisión de accesos' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Requieren atención/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /Requieren atención/ })).toContainText('2');
  await expect(page.getByRole('button', { name: /^3\s*Todas/ })).toBeVisible();
  expect(requests.at(-1)?.get('flag')).toBe('attention');
  await expect(page.getByRole('row', { name: /Carla Ruiz/ })).toHaveCount(0);

  // Dates only where they mean something: a manual grant has date and author, Okta shows its source and last login.
  const manual = page.getByRole('row', { name: /Ana Pérez/ });
  await expect(manual).toContainText('por Admin Uno');
  await expect(manual).toContainText('Asignación manual antigua');
  await expect(manual).toContainText('Sin dato');
  const okta = page.getByRole('row', { name: /Beto Gómez/ });
  await expect(okta).toContainText('Según grupos de Okta');
  await expect(okta).toContainText('Okta sin ingreso');

  // Filter, threshold and search reach the query.
  await page.getByRole('button', { name: /^3\s*Todas/ }).click();
  await expect(page.getByRole('row', { name: /Carla Ruiz/ })).toContainText('Autor sin dato');
  await expect(page.getByRole('row', { name: /Carla Ruiz/ })).toContainText('Sin señales');
  await page.getByRole('button', { name: 'Antigüedad para marcar' }).click();
  await page.getByRole('option', { name: '30 días' }).click();
  await expect.poll(() => requests.at(-1)?.get('days')).toBe('30');
  await page.getByRole('searchbox', { name: 'Buscar en la revisión' }).fill('Ana');
  await expect.poll(() => requests.at(-1)?.get('q')).toBe('Ana');
  expect((await new AxeBuilder({ page }).include('.access-review').analyze()).violations.map(({ id }) => id)).toEqual([]);
});

test('access administration exposes a clear role and permission editor', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/admin/access');

  await expect(page.getByRole('tab', { name: /Roles y permisos/ })).toBeVisible();
  await page.getByRole('tab', { name: /Roles y permisos/ }).click();
  await expect(page.getByRole('heading', { name: 'Roles y permisos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Netskope · Lector Sistema', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Netskope · Lector Sistema', exact: true }).click();
  await expect(page.getByLabel('Accesos de Netskope · Lector')).toContainText('Inventario, postura y métricas');
  await expect(page.getByText('netskope:read', { exact: true }).first()).toBeHidden();
  await page.getByRole('button', { name: 'Todos los roles', exact: true }).click();
  await page.getByText('Administrar catálogo de permisos (avanzado)', { exact: true }).click();
  await page.getByRole('button', { name: /Nuevo permiso/ }).click();
  const permissionForm = page.locator('.permission-create-form');
  await permissionForm.getByLabel('Recurso').fill('safes');
  await permissionForm.getByLabel('Acción').fill('export');
  await permissionForm.getByLabel('Descripción').fill('Exportar Safes');
  await permissionForm.getByRole('button', { name: 'Crear permiso' }).click();
  await expect(page.getByText('Permiso personalizado creado')).toBeVisible();
});

test('UX-AUD2-024: a system role is read only and shows its real capabilities, members and authorized group mappings', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/admin/access');
  await page.getByRole('tab', { name: /Roles y permisos/ }).click();
  await page.getByRole('button', { name: 'Administrador de plataforma Sistema', exact: true }).click();

  await expectSystemSearch(page.getByRole('searchbox', { name: 'Buscar capacidades', exact: true }));
  await expect(page.getByText('sg_ds-hub_admins')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Miembros \(/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Editar rol', exact: true })).toHaveCount(0);
  await expect(page.locator('.role-capability-table input[type="checkbox"]')).toHaveCount(0);
  await page.getByText(/^Códigos técnicos/).click();
  await expect(page.locator('.role-technical')).toContainText('access:manage');
});

test('access administration tablist supports arrow-key roving navigation', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/admin/access');

  const peopleTab = page.getByRole('tab', { name: /Usuarios de Custodia/ });
  const rolesTab = page.getByRole('tab', { name: /Roles y permisos/ });
  await expect(peopleTab).toHaveAttribute('tabindex', '0');
  await expect(rolesTab).toHaveAttribute('tabindex', '-1');

  const reviewTab = page.getByRole('tab', { name: /Revisión de accesos/ });
  await peopleTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(reviewTab).toBeFocused();
  await expect(reviewTab).toHaveAttribute('aria-selected', 'true');

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

  const detailButton = page.getByRole('button', { name: 'Gestionar acceso de Carlos Ortiz' });
  await expect(detailButton).toBeVisible();
  await expect(page.getByText('Administrador de plataforma', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('access:manage', { exact: true })).toHaveCount(0);
  await detailButton.click();

  const drawer = page.getByRole('dialog', { name: 'Carlos Ortiz' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByLabel('Accesos de Carlos Ortiz')).toContainText('Acceso total (superadmin)');
  await expect(drawer.locator('.access-areas [title="access:manage"]')).toBeVisible();
  await expect(drawer).toContainText('8 permisos');

  await page.getByRole('button', { name: 'Agregar rol a Carlos Ortiz' }).click();
  await expect(page.getByPlaceholder('Buscar rol o producto')).toBeVisible();
  await expect(page.getByRole('option', { name: /Lector de plataforma/ })).toBeVisible();
  await expect(page.getByRole('listbox').getByText('Plataforma', { exact: true })).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).include('.user-access-drawer').analyze();
  expect(accessibility.violations).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(page.getByPlaceholder('Buscar rol o producto')).toBeHidden();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Agregar rol a Carlos Ortiz' })).toBeFocused();
  await drawer.getByRole('button', { name: 'Cerrar detalle de acceso' }).click();
  await expect(drawer).toBeHidden();

});

test('Okta and local identities share a person row without sharing access controls', async ({ page }) => {
  await mockAuthenticatedApp(page, {
    authMode: 'oidc',
    sessionUser: { actor_id: 'okta-sub-1', name: 'Carlos Okta', email: 'carlos@example.com', roles: ['admin'], role_names: ['Administrador de plataforma'] },
    userRows: [
      { actor_id: 'carlos@example.com', email: 'carlos@example.com', display_name: 'Carlos Local', is_active: true, must_change_password: false, roles: ['admin'], auth_source: 'local', last_login_at: null },
      { actor_id: 'okta-sub-1', email: 'carlos@example.com', display_name: 'Carlos Okta', is_active: true, must_change_password: false, roles: ['admin'], auth_source: 'oidc', last_login_at: '2026-09-17T12:00:00Z' },
    ],
  });
  await page.goto('/admin/access');

  await expect(page.getByRole('button', { name: 'Crear usuario local' })).toHaveCount(0);
  await expect(page.locator('.person-row')).toHaveCount(1);
  await expect(page.locator('.person-row')).toContainText('2 identidades');
  const manage = page.getByRole('button', { name: 'Gestionar acceso de Carlos Okta' });
  await expect(manage).toHaveCount(1);
  await manage.click();
  await page.getByRole('button', { name: 'Cuenta que administrás' }).click();
  await page.getByRole('option', { name: 'Carlos Okta · Okta' }).click();
  const drawer = page.getByRole('dialog', { name: 'Carlos Okta' });
  await expect(drawer.getByRole('list', { name: 'Roles de Carlos Okta' })).toContainText('Administrador de plataforma');
  await expect(drawer.getByText('Cuenta de Okta', { exact: true })).toBeVisible();
  await expect(drawer.getByText('Tus propios roles no se cambian desde tu cuenta.')).toBeVisible();
  await expect(drawer.getByRole('button', { name: /Agregar rol|Quitar|Eliminar|Regenerar acceso|Desactivar/ })).toHaveCount(0);
  await drawer.getByRole('button', { name: 'Cuenta que administrás' }).click();
  await page.getByRole('option', { name: 'Carlos Local · Local' }).click();
  await expect(page.getByRole('dialog', { name: 'Carlos Local' }).getByRole('button', { name: 'Eliminar' })).toBeVisible();
});

test('ACCESS-UI-001 an admin adds and removes Custodia roles on an Okta person; Okta roles have no remove button', async ({ page }) => {
  const theme = test.info().project.use.colorScheme === 'light' ? 'light' : 'dark';
  await page.addInitScript((value) => localStorage.setItem('dshub-theme:v1', value), theme);
  const calls: string[] = [];
  await mockAuthenticatedApp(page, {
    authMode: 'hybrid',
    userRows: [
      { actor_id: 'okta-sub-2', email: 'ana@example.com', display_name: 'Ana Okta', is_active: true, must_change_password: false, roles: ['reader', 'netskope_reader'], role_assignments: [{ role_code: 'reader', source: 'oidc' }, { role_code: 'netskope_reader', source: 'manual' }], auth_source: 'oidc', last_login_at: '2026-10-10T12:00:00Z' },
    ],
  });
  await page.route('**/api/auth/users/okta-sub-2/roles**', async (route) => {
    const request = route.request();
    calls.push(`${request.method()} ${new URL(request.url()).pathname} ${request.postData() ?? ''}`.trim());
    await route.fulfill({ status: request.method() === 'POST' ? 201 : 200, json: request.method() === 'POST' ? { granted: true, actor_id: 'okta-sub-2', role_code: 'security_reader' } : { revoked: true, actor_id: 'okta-sub-2', role_code: 'netskope_reader' } });
  });
  await page.goto('/admin/access');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.getByRole('row', { name: /Ana Okta/ })).toBeVisible();
  await page.locator('.user-admin').evaluate((element) => Promise.all(
    element.getAnimations({ subtree: true }).map((animation) => animation.finished),
  ));
  const tableAccessibility = await new AxeBuilder({ page }).include('.user-directory-table').analyze();
  expect(tableAccessibility.violations).toEqual([]);
  await page.getByRole('row', { name: /Ana Okta/ }).hover();
  await page.locator('.user-admin').evaluate((element) => Promise.all(
    element.getAnimations({ subtree: true }).map((animation) => animation.finished),
  ));
  const hoveredTableAccessibility = await new AxeBuilder({ page }).include('.user-directory-table').analyze();
  expect(hoveredTableAccessibility.violations).toEqual([]);
  await page.getByRole('button', { name: 'Gestionar acceso de Ana Okta' }).click();
  const drawer = page.getByRole('dialog', { name: 'Ana Okta' });
  const chips = drawer.getByRole('list', { name: 'Roles de Ana Okta' });
  await expect(chips.getByRole('listitem')).toHaveCount(2);
  await expect(chips.getByRole('listitem').filter({ hasText: 'Lector de plataforma' })).toContainText('Okta');
  await expect(drawer.getByRole('button', { name: /Quitar Lector de plataforma/ })).toHaveCount(0);

  await drawer.getByRole('button', { name: /Quitar .* de Ana Okta/ }).click();
  const removalViews = page.getByRole('alertdialog', { name: 'Quitar rol' }).getByRole('region', { name: 'Vistas después del cambio' });
  await expect(removalViews).not.toContainText('Netskope');
  await expect(removalViews).toContainText('CyberArk');
  await page.getByRole('alertdialog', { name: 'Quitar rol' }).getByRole('button', { name: 'Quitar rol' }).click();
  await expect.poll(() => calls.at(-1)).toBe('DELETE /api/auth/users/okta-sub-2/roles/netskope_reader');
  await drawer.getByRole('button', { name: 'Agregar rol a Ana Okta' }).click();
  await expect(page.getByRole('option', { name: /Lector de plataforma/ })).toHaveCount(0);
  await page.getByRole('option', { name: /Lectura de seguridad/ }).click();
  await expect(page.getByRole('alertdialog', { name: 'Asignar rol' }).getByRole('region', { name: 'Vistas después del cambio' })).toContainText('Netskope');
  await page.getByRole('alertdialog', { name: 'Asignar rol' }).getByRole('button', { name: 'Asignar rol' }).click();
  await expect.poll(() => calls.at(-1)).toBe('POST /api/auth/users/okta-sub-2/roles {"role_code":"security_reader"}');
  const accessibility = await new AxeBuilder({ page }).include('.user-access-drawer').analyze();
  expect(accessibility.violations).toEqual([]);
});

test('AUD-A11Y-001: the user detail drawer traps focus and returns it to the trigger on close', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/admin/access');

  const detailButton = page.getByRole('button', { name: 'Gestionar acceso de Carlos Ortiz' });
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

  await page.getByRole('button', { name: 'Gestionar acceso de Carlos Ortiz' }).click();
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

test('custom roles can select only Netskope without implicit Platform, PAM or planned domains', async ({ page }) => {
  await mockAuthenticatedApp(page);
  let saved: unknown;
  await page.route('**/api/access/roles/composite', async (route) => {
    saved = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { created: true, role_code: 'netskope_team' } });
  });
  await page.goto('/admin/access');
  await page.getByRole('tab', { name: /Roles y permisos/ }).click();
  await page.getByRole('button', { name: /Nuevo rol/ }).click();
  await page.getByRole('radio', { name: /Niveles vinculados/ }).check();
  await expect(page.getByRole('heading', { name: 'Niveles vinculados' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear rol', exact: true })).toBeDisabled();
  await expect(page.getByText('BigID DSPM', { exact: true })).toHaveCount(0);
  await page.getByLabel('Nombre visible').fill('Equipo Netskope');
  await page.getByLabel('Código interno').fill('netskope_team');
  await page.getByLabel('Propósito', { exact: true }).fill('Consulta de Netskope para el equipo');
  await page.getByRole('button', { name: 'Nivel para Netskope DLP' }).click();
  await page.getByRole('option', { name: 'Lector', exact: true }).click();
  await expect(page.locator('.role-access-summary')).toContainText('Inventario, postura y métricas');
  await expect(page.locator('.role-access-summary')).not.toContainText('Inventario PAM');
  await page.getByRole('button', { name: 'Crear rol', exact: true }).click();
  await expect.poll(() => saved).toEqual({ role_code: 'netskope_team', display_name: 'Equipo Netskope', description: 'Consulta de Netskope para el equipo', level_refs: [{ domain_code: 'dlp', level_code: 'reader' }] });
  await expect(page.getByText('Rol personalizado creado.', { exact: true })).toBeVisible();
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
  await expect(page.getByRole('alert')).toContainText('No se pudo conectar con el servidor');
  await page.getByRole('button', { name: 'Ver detalle técnico' }).click();
  const details = page.getByRole('dialog', { name: 'Detalle del error' });
  await expect(details).toContainText('Error de red o del cliente');
  await expect(details).toContainText('/auth/status');
  await details.getByRole('button', { name: 'Cerrar' }).first().click();
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
});

test('top navigation exposes context and keeps its controls accessible', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/assets');

  const topbar = page.locator('.topbar');
  await expect(topbar.getByRole('button', { name: 'Ir al inicio de Custodia' })).toBeVisible();
  await expect(topbar.locator('.topbar-leading > *')).toHaveCount(5);
  await expect(topbar.locator('.topbar-leading > *').nth(2)).toHaveClass(/brand/);
  await expect(topbar.locator('.topbar-leading > *').nth(3)).toHaveClass(/global-search-trigger/);
  await expect(topbar.locator('.topbar-location')).toContainText('Cobertura');
  await expect(topbar.getByRole('button', { name: 'Cambiar herramienta. Actual: CyberArk', exact: true })).toBeVisible();
  await expect(topbar.getByRole('button', { name: /Cambiar workspace/ })).toHaveCount(0);
  await expect(topbar.getByRole('button', { name: 'Abrir accesos rápidos', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Secciones de CyberArk', exact: true }).getByRole('link', { name: 'Cobertura', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(topbar.getByRole('button', { name: 'Abrir notificaciones' })).toBeVisible();
  await expect(topbar.getByRole('switch', { name: 'Incluir internos CyberArk' })).toHaveCount(0);

  await topbar.getByRole('button', { name: /Cambiar herramienta/ }).click();
  const toolMenu = page.getByRole('region', { name: 'Herramientas' });
  await expect(toolMenu.getByRole('button', { name: /Inicio Resumen general de Custodia/ })).toBeVisible();
  await expect(toolMenu.getByRole('button', { name: /CyberArk PAM, Identity Administration, SIA y Access/ })).toHaveAttribute('aria-current', 'page');
  await topbar.getByRole('button', { name: /Cambiar herramienta/ }).click();

  const topbarResults = await new AxeBuilder({ page })
    .include('.topbar')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(topbarResults.violations).toEqual([]);

});

test('profile and workspace menus retain their controls and accessibility', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/assets');
  const topbar = page.locator('.topbar');
  await topbar.getByRole('button', { name: 'Abrir menú de usuario' }).click();
  const profileMenu = page.getByRole('region', { name: 'Menú de usuario' });
  await expect(profileMenu.getByRole('button', { name: 'Abrir notificaciones' })).toHaveCount(0);
  await expect(profileMenu.getByRole('button', { name: 'Cambiar a modo claro' })).toBeVisible();
  await expect(profileMenu.getByRole('switch', { name: 'Incluir internos CyberArk' })).toHaveCount(0);

  const profileResults = await new AxeBuilder({ page })
    .include('.profile-menu')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(profileResults.violations).toEqual([]);
  await topbar.getByRole('button', { name: 'Abrir menú de usuario' }).click();

  await page.goto('/chains/person');
  await topbar.getByRole('button', { name: /Cambiar workspace/ }).click();
  const workspaceMenu = page.locator('.workspace-menu');
  await expect(workspaceMenu.locator('.workspace-menu-heading')).toHaveCount(0);
  await expect(workspaceMenu.locator('.workspace-menu-header')).toContainText('Vistas de Conexiones');

  const menuResults = await new AxeBuilder({ page })
    .include('.workspace-menu')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(menuResults.violations).toEqual([]);

});

test('SIA navigation exposes its context and the manual refresh action', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/sia');
  const siaTopbar = page.locator('.topbar');
  await expect(siaTopbar.locator('.topbar-location')).toContainText('SIA');
  await siaTopbar.getByRole('button', { name: 'Abrir menú de usuario' }).click();
  await expect(page.getByRole('region', { name: 'Menú de usuario' }).getByRole('button', { name: /Actualizar datos/ })).toBeVisible();
});

async function searchAndSelect(page: Page, group: string, optionName: string, searchTerm = 'Fin') {
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Command center' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Buscar inventario, herramientas y acciones' }).fill(searchTerm);
  await dialog.locator('.global-search-group').filter({ hasText: group }).getByRole('option', { name: optionName }).click();
  await expect(dialog).toHaveCount(0);
}

test('global inventory search opens with Ctrl+K and seeds selected workspaces', async ({ page }) => {
  let searchRequest = '';
  const catalogRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/search') searchRequest = request.url();
    if (/^\/api\/cmdb\/(pam-roles|identity-roles)/.test(url.pathname)) catalogRequests.push(url.pathname);
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
  await expect(page.getByRole('searchbox', { name: 'Buscar nodos de la cadena PAM' })).toHaveValue('Ada PAM');

  const catalogRequestsBeforePamRole = catalogRequests.length;
  await searchAndSelect(page, 'Roles PAM', 'Finance operators');
  await expect(page).toHaveURL(/\/pam\/roles$/);
  await expect(page.getByRole('searchbox', { name: 'Buscar roles cyberark' })).toHaveValue('Finance operators');
  await expect.poll(() => catalogRequests.slice(catalogRequestsBeforePamRole)).toContain('/api/cmdb/pam-roles');
  expect(catalogRequests.slice(catalogRequestsBeforePamRole)).not.toContain('/api/cmdb/identity-roles');

  await searchAndSelect(page, 'Usuarios de Identity Administration', 'Ada Lovelace');
  await expect(page).toHaveURL(/\/pam\/identity/);
  await expect(page.getByRole('searchbox', { name: 'Buscar usuarios de Identity Administration' })).toHaveValue('Ada Lovelace');

  await searchAndSelect(page, 'Conexiones', 'db-finance-01', 'db-finance-01');
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
  await expect(dialog.getByRole('option', { name: /^Safes\b/ })).toBeVisible();
  await expect(dialog.getByRole('option', { name: /^Usuarios y permisos\b/ })).toHaveCount(0);
  await expect(dialog.getByRole('option', { name: 'Actualizar datos' })).toHaveCount(0);
  await expect(dialog.getByRole('option', { name: /^Métricas Netskope/ })).toHaveCount(0);

  await page.keyboard.press('Escape');
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'ingestion:run'] });
  await page.reload();
  await page.getByRole('button', { name: 'Abrir command center' }).click();
  await expect(page.getByRole('dialog', { name: 'Command center' }).getByRole('option', { name: 'Actualizar datos' })).toBeVisible();

  await page.keyboard.press('Escape');
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.reload();
  await page.getByRole('button', { name: 'Abrir command center' }).click();
  const netskopeDialog = page.getByRole('dialog', { name: 'Command center' });
  await expect(netskopeDialog.getByRole('group', { name: 'Netskope', exact: true }).getByRole('option', { name: /^Métricas/ })).toBeVisible();
  await expect(netskopeDialog.getByRole('option', { name: /^Equipos\b/ })).toBeVisible();
  await expect(netskopeDialog.getByRole('option', { name: /^Inventario\b/ })).toBeVisible();
});

test('notifications never claim there are no syncs while showing activity', async ({ page }) => {
  let eventRequests = 0;
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'] });
  await page.route('**/api/events**', async (route) => {
    eventRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows: eventRequests === 1 ? [] : [
        { event_id: 91, kind: 'sync', actor_id: 'system:scheduler', actor_name: 'Scheduler', run_id: 'run-notif-1', source_system: 'netskope', created_at: '2026-09-25T03:00:00Z' },
      ] }),
    });
  });
  await page.goto('/pam');
  await expect.poll(() => eventRequests).toBe(1);
  // Let the initial poll release its in-flight guard before forcing a second one.
  await page.waitForTimeout(250);
  await page.bringToFront();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => eventRequests).toBe(2);

  await page.getByRole('button', { name: 'Abrir notificaciones' }).click();
  const panel = page.getByRole('region', { name: 'Notificaciones' });
  await expect(panel.getByText('Actividad de sincronización')).toBeVisible();
  await expect(panel.getByText('1 actividad')).toBeVisible();
  await expect(panel.getByText('Sin actividad')).toHaveCount(0);
  await expect(panel.getByText('Todavía no hay sincronizaciones registradas.')).toHaveCount(0);
});

test('unauthorized Admin and Netskope deep links return to an authorized workspace', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'] });

  await page.goto('/admin/access');
  await expect(page).toHaveURL(/\/pam$/);
  await expect(page.getByRole('region', { name: 'Mi panel de métricas' })).toBeVisible();

  await page.goto('/netskope/devices');
  await expect(page).toHaveURL(/\/pam$/);
  await expect(page.getByRole('region', { name: 'Mi panel de métricas' })).toBeVisible();
});

test('Netskope device row opens a short card without unnecessary technical identifiers', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.goto('/netskope/devices');

  await expect(page.getByRole('cell', { name: /LAPTOP-QA-01/ })).toBeVisible();
  await page.getByRole('row', { name: /LAPTOP-QA-01/ }).click();

  const card = page.locator('.netskope-device-detail');
  await expect(card).toBeVisible();
  await expect(card.getByText('Dell Latitude 5420')).toBeVisible();
  await expect(card.getByText('guid-501-abc')).toHaveCount(0);
  await expect(card).toContainText('qa.user@example.com');
  await expect(card).toContainText('Netskope: managed');
  await expect(card).toContainText('cliente 110.0.1');
  await expect(card.getByText('GUID')).toHaveCount(0);
  await expect(card.getByText('Clave de usuario')).toHaveCount(0);
  await expect(card).not.toContainText('device-501');
  const signal = card.getByRole('region', { name: 'Señal' });
  await expect(signal).toContainText('Sin evidencia vigente');
  await expect(signal).toContainText('connect');
});

test('UX-NAV-001 quick access is edited from the remaining view picker and covers every tool', async ({ page }) => {
  let savedVisibleWorkspaces: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/workspaces/preferences' && request.method() === 'PUT') {
      savedVisibleWorkspaces = (request.postDataJSON() as { visible_workspaces: string[] }).visible_workspaces;
    }
  });
  await mockAuthenticatedApp(page, { initialVisibleWorkspaces: ['safes', 'users'] });
  // CyberArk and Netskope show their views as a bar; their header menu keeps
  // pinned and recent views of every tool instead of repeating the bar.
  await page.goto('/pam');
  await expect(page.getByRole('banner').getByRole('button', { name: /Cambiar workspace/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Abrir accesos rápidos', exact: true }).click();
  const quick = page.getByRole('region', { name: 'Workspaces' });
  await expect(quick.locator('.workspace-menu-header')).toContainText('Accesos rápidos');
  await expect(quick.locator('[data-section="tool-workspaces"]')).toHaveCount(0);
  await expect(quick.locator('[data-section="quick-access"]').getByRole('link', { name: /^CyberArk · Safes/ })).toBeVisible();
  await quick.locator('[data-section="quick-access"]').getByRole('link', { name: /^CyberArk · Safes/ }).click();
  await expect(page).toHaveURL(/\/pam\/safes$/);
  await page.goto('/netskope');
  await page.getByRole('button', { name: 'Abrir accesos rápidos', exact: true }).click();
  await expect(quick.locator('[data-section="quick-access"]').getByRole('link', { name: /^CyberArk · Safes/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto('/chains/person');
  await page.getByRole('button', { name: /Cambiar workspace/ }).click();
  const menu = page.getByRole('region', { name: 'Workspaces' });
  await expect(menu.locator('.workspace-menu-header')).toContainText('Vistas de Conexiones');
  await menu.getByRole('button', { name: /Fijar vistas rápidas/ }).click();
  const editor = menu.getByRole('dialog', { name: 'Accesos rápidos' });
  await expect(editor).toBeFocused();
  await expect(editor.getByText('2 seleccionados')).toBeVisible();
  // One total (three per active platform: six today), spread freely across tools.
  await expect(editor.getByText('Hasta 6', { exact: true })).toBeVisible();
  // Tool labels name the platform only, never the internal CyberArk tool.
  await expect(editor.getByText('CyberArk PAM', { exact: true })).toHaveCount(0);
  await expect(editor.getByText('CyberArk Identity Administration', { exact: true })).toHaveCount(0);
  await editor.getByRole('checkbox', { name: /^CyberArk Postura/ }).check();
  await editor.getByRole('checkbox', { name: /^CyberArk Acceso ¿Quién llega a qué Safe y por qué\?$/ }).check();
  await editor.getByRole('checkbox', { name: /^CyberArk Identidades/ }).check();
  await editor.getByRole('checkbox', { name: /^Netskope Inventario/ }).check();
  await expect(editor.getByText('6 seleccionados')).toBeVisible();
  await expect(editor.getByRole('checkbox', { name: /^CyberArk SIA ¿Qué cubre SIA/ })).toBeDisabled();
  await editor.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect.poll(() => savedVisibleWorkspaces).toEqual(['safes', 'users', 'posture', 'graph', 'identity', 'netskopeInventory']);
  await expect(editor).not.toBeVisible();
  await expect(page.getByRole('button', { name: /Cambiar workspace/ })).toBeFocused();
});

/* UX-SEARCH-001: Command-K v2. Navigation commands come from the workspace
   catalog, results carry explicit kind/platform badges and the empty state is
   grouped by platform in CyberArk → Netskope → Custodia order. */

test('UX-SEARCH-001: the empty command center groups quick access by platform in order', async ({ page }) => {
  await mockAuthenticatedApp(page, { initialVisibleWorkspaces: ['safes', 'netskope', 'person'] });
  await page.goto('/pam');

  await page.getByRole('button', { name: 'Abrir command center' }).click();
  const dialog = page.getByRole('dialog', { name: 'Command center' });
  const quick = dialog.locator('.global-search-group').filter({ hasText: 'Accesos rápidos' });
  await expect(quick.locator('.global-search-subgroup')).toHaveText(['CyberArk', 'Netskope', 'Custodia']);
  await expect(quick.getByRole('option', { name: /^Safes\b/ })).toBeVisible();
  await expect(quick.getByRole('group', { name: 'Netskope', exact: true }).getByRole('option', { name: /^Métricas/ })).toBeVisible();
  const person = quick.getByRole('option', { name: /^Personas\b/ });
  await expect(person).toBeVisible();
  await expect(person.locator('.global-search-badge')).toHaveCount(0);
});

test('UX-SEARCH-001: persona, safe, identidad and netskope rank first and open on Enter', async ({ page }) => {
  await mockAuthenticatedApp(page);
  const openSearch = async () => {
    await expect(page.getByRole('button', { name: 'Abrir command center' })).toBeVisible();
    await page.keyboard.press('Control+k');
  };
  await page.goto('/pam');
  await openSearch();
  const dialog = page.getByRole('dialog', { name: 'Command center' });
  const combo = dialog.getByRole('combobox');

  await combo.fill('persona');
  await expect(dialog.getByRole('option', { name: /^Personas Custodia/ }).first().locator('.global-search-badge')).toHaveText(['Custodia']);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/chains\/person$/);
  await expect(page.getByRole('searchbox', { name: 'Buscar persona por correo o nombre' })).toBeVisible();

  await page.goto('/pam');
  await openSearch();
  await dialog.getByRole('combobox').fill('safe');
  await expect(dialog.getByRole('option', { name: /^Safes CyberArk/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/pam\/safes$/);

  await page.goto('/pam');
  await openSearch();
  await dialog.getByRole('combobox').fill('identidad');
  await expect(dialog.getByRole('option', { name: /^Identidades CyberArk/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/pam\/identity/);

  await page.goto('/pam');
  await openSearch();
  await dialog.getByRole('combobox').fill('netskope');
  await expect(dialog.getByRole('option', { name: /^Métricas Netskope/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/netskope$/);
});

test('UX-SEARCH-001: widget results only navigate to their dashboard and never persist preferences', async ({ page }) => {
  const dashboardWrites: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() !== 'GET' && url.pathname.startsWith('/api/dashboard')) {
      dashboardWrites.push(`${request.method()} ${url.pathname}`);
    }
  });
  await mockAuthenticatedApp(page);
  await page.goto('/pam');
  await page.getByRole('button', { name: 'Abrir command center' }).click();
  const dialog = page.getByRole('dialog', { name: 'Command center' });
  await dialog.getByRole('combobox').fill('safes por empresa');
  const widget = dialog.getByRole('option', { name: /^Safes por empresa\b/ });
  await expect(widget.locator('.global-search-badge')).toHaveText(['Widget', 'CyberArk']);
  await widget.click();
  await expect(page).toHaveURL(/\/pam$/);
  await expect(page.getByRole('region', { name: 'Mi panel de métricas' })).toBeVisible();
  expect(dashboardWrites).toEqual([]);
});

test('UX-SEARCH-001: platform chips filter by mouse and keyboard', async ({ page }) => {
  await mockAuthenticatedApp(page, { initialVisibleWorkspaces: ['safes', 'netskope', 'person'] });
  await page.goto('/pam');
  await page.getByRole('button', { name: 'Abrir command center' }).click();
  const dialog = page.getByRole('dialog', { name: 'Command center' });
  const combo = dialog.getByRole('combobox');

  await combo.fill('por');
  await expect(dialog.getByRole('group', { name: 'Filtrar por tipo' })).toHaveCount(0);
  await expect(dialog.getByText('Cargando widgets…')).toHaveCount(0);

  const netskopeChip = dialog.getByRole('button', { name: 'Netskope', exact: true });
  await netskopeChip.focus();
  await page.keyboard.press('Enter');
  await expect(netskopeChip).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('option').first()).toBeVisible();
  const platformBadges = await dialog.locator('.global-search-group .global-search-badge').allTextContents();
  expect(platformBadges.length).toBeGreaterThan(0);
  expect(platformBadges).toContain('Netskope');
  expect(platformBadges).not.toContain('CyberArk');
  expect(platformBadges).not.toContain('Custodia');

  // A query with no results drops every group and keeps a valid (or no) active index.
  await combo.fill('zzzzqq');
  await expect(dialog.getByText('No se encontraron coincidencias.')).toBeVisible();
  await expect(dialog.locator('.global-search-group')).toHaveCount(0);
  const activeDescendant = await combo.getAttribute('aria-activedescendant');
  if (activeDescendant) await expect(dialog.locator(`#${activeDescendant}`)).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
});

test('UX-SEARCH-001: an actor without permissions never sees restricted destinations', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'] });
  await page.goto('/pam');
  await page.getByRole('button', { name: 'Abrir command center' }).click();
  const dialog = page.getByRole('dialog', { name: 'Command center' });
  const combo = dialog.getByRole('combobox');

  await combo.fill('persona');
  // The guide's "Personas" section is open to every actor; only the view is
  // restricted, so anchor on the view's own detail text.
  await expect(dialog.getByRole('option', { name: /^Personas Custodia Registros relacionados/ })).toHaveCount(0);
  await combo.fill('netskope');
  await expect(dialog.getByRole('option', { name: /^Métricas Netskope/ })).toHaveCount(0);
  await expect(dialog.getByRole('option', { name: /^Acceso\b/ })).toHaveCount(0);
  await combo.fill('actividad');
  await expect(dialog.getByRole('option', { name: /^Actividad\b/ })).toHaveCount(0);
  await combo.fill('usuarios ds hub');
  await expect(dialog.getByRole('option', { name: /^Usuarios y permisos\b/ })).toHaveCount(0);
});

test('UX-SEARCH-001: the command center has no axe violations', async ({ page }) => {
  // FE-AUD-009: browser colorScheme alone does not change Custodia's stored theme.
  const theme = test.info().project.use.colorScheme === 'light' ? 'light' : 'dark';
  await page.addInitScript((value) => localStorage.setItem('dshub-theme:v1', value), theme);
  await mockAuthenticatedApp(page);
  await page.goto('/pam');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.getByRole('button', { name: 'Abrir command center' }).click();
  const dialog = page.getByRole('dialog', { name: 'Command center' });
  await dialog.getByRole('combobox').fill('persona');
  await expect(dialog.getByRole('option', { name: /^Personas\b/ }).first()).toBeVisible();

  const results = await new AxeBuilder({ page })
    .include('.global-search-panel')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

for (const authMode of ['local', 'hybrid', 'oidc'] as const) {
  test(`access in ${authMode} keeps OIDC diagnostics out of the user interface`, async ({ page }) => {
    const requests: string[] = [];
    await mockAuthenticatedApp(page, { authMode, onRequest: (path) => requests.push(path) });
    await page.goto('/admin/access');
    const tabs = page.getByRole('tablist', { name: 'Administración de acceso' });
    await expect(tabs.getByRole('tab')).toHaveCount(2);
    await expect(tabs.getByRole('tab', { name: /Diagnóstico OIDC/ })).toHaveCount(0);
    await tabs.getByRole('tab', { name: /Roles y permisos/ }).click();
    await expect(page.getByRole('heading', { name: 'Roles y permisos' })).toBeVisible();
    await tabs.getByRole('tab', { name: /Usuarios de Custodia/ }).click();
    await expect(page.getByRole('heading', { name: 'Acceso a la plataforma' })).toBeVisible();
    expect(requests.filter((path) => path === '/api/access/oidc-health')).toEqual([]);
  });
}

test('ACCESS-UI-001 legacy Okta accounts never infer role sources from observed groups', async ({ page }) => {
  await mockAuthenticatedApp(page, { authMode: 'hybrid', userRows: [
    { actor_id: 'observed-1', email: 'observed@example.com', display_name: 'Miembro observado', auth_source: 'oidc', is_active: true, must_change_password: false, roles: ['reader'], last_login_at: null, observed_groups: ['sg_ds-hub_lectores'], groups_observed_at: '2026-10-03T03:00:00Z' },
  ] });
  await page.goto('/admin/access');
  const row = page.locator('.person-row').filter({ hasText: 'Miembro observado' });
  await expect(row.getByText('Okta', { exact: true })).toBeVisible();
  await expect(page.getByText('sg_ds-hub_lectores')).toHaveCount(0);
  await row.getByRole('button', { name: 'Gestionar acceso de Miembro observado' }).click();
  const drawer = page.getByRole('dialog', { name: 'Miembro observado' });
  await expect(drawer.getByText('sg_ds-hub_lectores')).toHaveCount(0);
  await expect(drawer.getByRole('region', { name: 'Origen de roles de Okta' })).toContainText('Sin detalle del grupo');
  await expect(drawer.locator('.access-areas [title="inventory:read"]')).toContainText('Inventario PAM');
  expect((await new AxeBuilder({ page }).include('.user-admin').analyze()).violations).toEqual([]);
});

for (const canReadMappings of [true, false]) {
  test(`ACCESS-UI-001 role provenance is specific to the last login and mapping access ${canReadMappings}`, async ({ page }) => {
    await page.addInitScript((theme) => localStorage.setItem('dshub-theme:v1', theme), test.info().project.use.colorScheme || 'dark');
    await mockAuthenticatedApp(page, { permissions: canReadMappings ? ['access:manage'] : ['access:directory_read', 'access:roles_read'], userRows: [{
      actor_id: 'provenance', email: 'sources@example.com', display_name: 'Origen de acceso', auth_source: 'oidc', is_active: true,
      must_change_password: false, roles: ['reader', 'admin', 'netskope_reader'], last_login_at: '2026-10-19T12:00:00Z',
      role_assignments: [{ role_code: 'reader', source: 'oidc' }, { role_code: 'admin', source: 'manual' }, { role_code: 'netskope_reader', source: 'oidc' }],
      role_group_sources: { reader: ['team-old', 'team-shared'], admin: ['never-attribute-manual'], netskope_reader: [] },
    }] });
    await page.goto('/admin/access');
    await page.getByRole('button', { name: 'Gestionar acceso de Origen de acceso' }).click();
    const drawer = page.getByRole('dialog', { name: 'Origen de acceso' });
    const source = drawer.getByRole('region', { name: 'Origen de roles de Okta' });
    if (canReadMappings) {
      await expect(source.locator('dl > div').filter({ hasText: 'Lector de plataforma' })).toContainText('team-old · team-shared');
      await expect(source).toContainText('Rol predeterminado de inicio de sesión');
      await expect(source).toContainText('No confirma pertenencia actual');
      await expect(source).not.toContainText('never-attribute-manual');
      await expect(drawer.getByRole('list', { name: 'Roles de Origen de acceso' }).getByRole('button', { name: /Quitar Lector/ })).toHaveCount(0);
    } else {
      await expect(source).toHaveCount(0);
      await expect(drawer).not.toContainText('team-old');
    }
    await expect(drawer.getByRole('region', { name: 'Vistas del menú' })).toContainText('Netskope');
    expect((await new AxeBuilder({ page }).include('.user-access-drawer').analyze()).violations).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Gestionar acceso de Origen de acceso' })).toBeFocused();
  });
}

test('ACCESS-UI-001 draft views follow direct permissions and linked levels without granting access', async ({ page }) => {
  const writes: string[] = [];
  await page.addInitScript((theme) => localStorage.setItem('dshub-theme:v1', theme), test.info().project.use.colorScheme || 'dark');
  await mockAuthenticatedApp(page, { onRequest: (path) => writes.push(path) });
  await page.goto('/admin/access');
  await page.getByRole('tab', { name: /Roles y permisos/ }).click();
  await page.getByRole('button', { name: 'Nuevo rol', exact: true }).click();
  const preview = page.getByRole('region', { name: 'Vistas del menú', exact: true });
  await expect(preview).not.toContainText('Netskope');
  await page.getByRole('checkbox', { name: 'Habilitar Ingresar a Netskope DLP', exact: true }).check();
  await expect(preview).not.toContainText('Netskope');
  await page.getByRole('checkbox', { name: 'Habilitar Inventario, postura y métricas', exact: true }).check();
  await expect(preview).toContainText('Netskope');
  await expect(preview).toContainText('Equipos');
  await expect(preview).not.toContainText('Administradores');
  await expect(preview).not.toContainText('CyberArk');
  await page.getByRole('checkbox', { name: 'Habilitar Inventario, postura y métricas', exact: true }).uncheck();
  await expect(preview).not.toContainText('Netskope');
  await page.getByRole('checkbox', { name: 'Habilitar Acceso total (superadmin)', exact: true }).check();
  await expect(preview).toContainText('Netskope');
  await expect(preview).not.toContainText('Administradores');
  await page.getByRole('checkbox', { name: 'Habilitar Acceso total (superadmin)', exact: true }).uncheck();
  await page.getByRole('radio', { name: /Niveles vinculados/ }).check();
  await page.getByRole('button', { name: 'Nivel para Netskope DLP' }).click();
  await page.getByRole('option', { name: 'Lector', exact: true }).click();
  await expect(preview).toContainText('Equipos');
  expect(writes).not.toContain('/api/access/roles/composite');
  expect((await new AxeBuilder({ page }).include('.role-admin').analyze()).violations).toEqual([]);
});

test('ACCESS-UI-001 a role lists its members and adds or removes them from the role itself', async ({ page }) => {
  const calls: string[] = [];
  await mockAuthenticatedApp(page, { authMode: 'hybrid' });
  const roles = [
    { role_code: 'admin', display_name: 'Administrador de plataforma', description: 'Administración completa', domain_code: 'platform', role_kind: 'direct', lifecycle_status: 'active', system_managed: true, permission_codes: ['inventory:read', 'domain:pam', 'catalogs:read', 'safes:manage', 'netskope:dlp_read'], level_refs: [], user_count: 2, oidc_groups: ['sg_ds-hub_admins'] },
    { role_code: 'reader', display_name: 'Lector de plataforma', description: 'Consulta básica', domain_code: 'platform', role_kind: 'direct', lifecycle_status: 'active', system_managed: true, permission_codes: ['inventory:read'], level_refs: [], user_count: 0, oidc_groups: [] },
  ];
  const ana = { actor_id: 'okta-ana', email: 'ana@example.com', display_name: 'Ana Okta', auth_source: 'oidc', is_active: true, must_change_password: false, last_login_at: null, roles: ['admin'], role_assignments: [{ role_code: 'admin', source: 'oidc' }] };
  const beto = { actor_id: 'beto@example.com', email: 'beto@example.com', display_name: 'Beto Local', auth_source: 'local', is_active: true, must_change_password: false, last_login_at: null, roles: ['admin'], role_assignments: [{ role_code: 'admin', source: 'manual' }] };
  const caro = { actor_id: 'okta-caro', email: 'caro@example.com', display_name: 'Caro Okta', auth_source: 'oidc', is_active: true, must_change_password: false, last_login_at: null, roles: [], role_assignments: [] };
  const person = (user: typeof ana) => ({ key: user.email, email: user.email, display_name: user.display_name, identities: [user] });
  await page.route('**/api/access/roles', (route) => route.fulfill({ json: { rows: roles } }));
  await page.route('**/api/auth/people?**', (route) => {
    const url = new URL(route.request().url());
    const role = url.searchParams.get('role');
    const q = url.searchParams.get('q') || '';
    const rows = role ? [ana, beto].filter((user) => user.roles.includes(role)) : [ana, beto, caro].filter((user) => user.display_name.toLowerCase().includes(q.toLowerCase()));
    return route.fulfill({ json: { rows: rows.map(person), total: rows.length, limit: 20, offset: 0 } });
  });
  await page.route('**/api/auth/users/*/roles**', async (route) => {
    calls.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    await route.fulfill({ status: route.request().method() === 'POST' ? 201 : 200, json: {} });
  });
  await page.goto('/admin/access');
  await page.getByRole('tab', { name: /Roles y permisos/ }).click();
  const map = page.getByRole('region', { name: 'Mapa de accesos por rol' });
  await expect(map.getByRole('row').filter({ hasText: 'Administrador de plataforma' })).toContainText('Miembros (2)');
  await expect(map.getByRole('row').filter({ hasText: 'Lector de plataforma' })).toContainText('Miembros (0)');
  await map.getByRole('button', { name: 'Administrador de plataforma Sistema', exact: true }).click();

  await page.getByRole('button', { name: 'Miembros (2)' }).click();
  const panel = page.getByRole('dialog', { name: 'Miembros de Administrador de plataforma' });
  const members = panel.getByRole('list', { name: 'Miembros de Administrador de plataforma' });
  await expect(members.getByRole('listitem').filter({ hasText: 'Ana Okta' })).toContainText('por Okta');
  await expect(members.getByRole('listitem').filter({ hasText: 'Beto Local' })).toContainText('Local');
  await expect(page.getByRole('region', { name: 'Mapa de accesos por rol' })).toHaveCount(0);
  // Okta-assigned members change in Okta: only the Custodia assignment has a remove button.
  await expect(members.getByRole('button', { name: 'Quitar Administrador de plataforma a Ana Okta' })).toHaveCount(0);
  await members.getByRole('button', { name: 'Quitar Administrador de plataforma a Beto Local' }).click();
  await expect.poll(() => calls.at(-1)).toBe('DELETE /api/auth/users/beto%40example.com/roles/admin');

  await panel.getByLabel('Agregar miembro a Administrador de plataforma').fill('caro');
  await panel.getByRole('button', { name: 'Agregar Caro Okta (Okta)' }).click();
  await expect.poll(() => calls.at(-1)).toBe('POST /api/auth/users/okta-caro/roles');
  expect((await new AxeBuilder({ page }).include('.role-members-panel').analyze()).violations).toEqual([]);
  await panel.getByRole('button', { name: 'Cerrar miembros' }).click();

  const scope = page.getByLabel('Accesos de Administrador de plataforma');
  await expect(scope).toContainText('Clasificar Safes');
  await expect(scope).toContainText('Alertas DLP');
  // Navigation is explicitly separate from data permissions; mappings live in the role summary.
  await expect(scope).toContainText('Navegación');
  await expect(page.getByText('sg_ds-hub_admins')).toBeVisible();
  expect((await new AxeBuilder({ page }).include('.role-admin').analyze()).violations).toEqual([]);
});

test('directory readers without mapping permission do not request Okta memberships', async ({ page }) => {
  const requests: string[] = [];
  await mockAuthenticatedApp(page, { authMode: 'hybrid', permissions: ['access:directory_read'], onRequest: (path) => requests.push(path) });
  await page.goto('/admin/access');
  await expect(page.getByRole('heading', { name: 'Acceso a la plataforma' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Grupos de Okta' })).toHaveCount(0);
  expect(requests).not.toContain('/api/auth/oidc-groups');
});


for (const mode of ['local', 'hybrid', 'oidc'] as const) {
  test(`UX-AUD2-024: account creation hints respect ${mode} authentication`, async ({ page }, testInfo) => {
    await mockAuthenticatedApp(page, { authMode: mode });
    await page.goto('/admin/access');
    await expect(page.locator('html')).toHaveAttribute('data-theme', testInfo.project.name.includes('light') ? 'light' : 'dark');
    const form = page.locator('.user-create-form');
    if (mode === 'oidc') {
      await expect(form).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Crear usuario local' })).toHaveCount(0);
    } else {
      await page.getByRole('button', { name: 'Crear usuario local', exact: true }).click();
      await expect(form.getByLabel('Email', { exact: true })).toHaveAttribute('placeholder', 'nombre@empresa.com');
      await expect(form.getByLabel('Nombre', { exact: true })).toHaveAttribute('placeholder', 'Nombre y apellido');
      await expect(form.getByRole('button', { name: 'Rol inicial del nuevo usuario local' })).toBeVisible();
    }
  });
}

test('FE-AUD-005: an expired session in Administración → Actividad opens the shared sign-in, while a 503 keeps its retry', async ({ page }) => {
  await mockAuthenticatedApp(page, { initialVisibleWorkspaces: ['safes', 'activity'] });
  let mode: 'unavailable' | 'expired' = 'unavailable';
  await page.route('**/api/activity?*', (route) => mode === 'unavailable'
    ? route.fulfill({ status: 503, json: { detail: 'Unavailable' } })
    : route.fulfill({ status: 401, json: { detail: 'No autenticado' } }));
  await page.goto('/admin/activity');
  // A recoverable error keeps the retry...
  await expect(page.getByRole('button', { name: 'Reintentar' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toHaveCount(0);
  // ...and an expired session never leaves the operator retrying: it goes to the sign-in flow.
  mode = 'expired';
  await page.getByRole('button', { name: 'Reintentar' }).first().click();
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
});

test('duplicating a protected role submits a new direct role with exactly the original capabilities', async ({ page }) => {
  await mockAuthenticatedApp(page);
  let saved: Record<string, unknown> | undefined;
  await page.route('**/api/access/roles', async (route) => {
    if (route.request().method() !== 'POST') { await route.fallback(); return; }
    saved = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { created: true, role_code: 'admin_copy' } });
  });
  await page.goto('/admin/access');
  await page.getByRole('tab', { name: /Roles y permisos/ }).click();
  await page.getByRole('button', { name: 'Administrador de plataforma Sistema', exact: true }).click();
  await page.getByRole('button', { name: 'Duplicar como personalizado' }).click();
  await page.getByLabel('Código interno').fill('admin_copy');
  await page.getByRole('button', { name: 'Crear rol', exact: true }).click();
  await expect.poll(() => saved?.role_code).toBe('admin_copy');
  expect(saved?.display_name).toBe('Administrador de plataforma (copia)');
  expect(saved?.permission_codes).toEqual(['inventory:read', 'inventory:write', 'inventory:export', 'catalogs:read', 'catalogs:write', 'access:manage', 'domain:pam', 'domain:admin']);
  await expect(page.getByText('Rol personalizado creado')).toBeVisible();
});

test('role removal preview accounts for overlapping grants and keeps a rejected change reviewable', async ({ page }) => {
  await mockAuthenticatedApp(page, { userRows: [{ actor_id: 'okta-overlap', email: 'overlap@example.com', display_name: 'Acceso superpuesto', is_active: true, must_change_password: false, roles: ['admin', 'reader'], role_assignments: [{ role_code: 'admin', source: 'oidc' }, { role_code: 'reader', source: 'manual' }], auth_source: 'oidc', last_login_at: null }] });
  let writes = 0;
  await page.route('**/api/auth/users/okta-overlap/roles/reader', async (route) => {
    writes++;
    await route.fulfill({ status: 403, json: { detail: 'Cambio fuera del techo de delegación' } });
  });
  await page.goto('/admin/access');
  await page.getByRole('button', { name: 'Gestionar acceso de Acceso superpuesto' }).click();
  await page.getByRole('button', { name: 'Quitar Lector de plataforma de Acceso superpuesto' }).click();
  const confirmation = page.getByRole('alertdialog', { name: 'Quitar rol' });
  await expect(confirmation).toContainText('El acceso efectivo no cambia.');
  expect(writes).toBe(0);
  await confirmation.getByRole('button', { name: 'Quitar rol' }).click();
  await expect(page.getByText('Cambio fuera del techo de delegación')).toBeVisible();
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('list', { name: 'Roles de Acceso superpuesto' })).toContainText('Lector de plataforma');
});

test('members load through the existing role filter and list only the matching accounts of each person', async ({ page }) => {
  await mockAuthenticatedApp(page);
  const queries: URL[] = [];
  await page.route('**/api/auth/people?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('role')) queries.push(url);
    await route.fulfill({ json: { rows: [{ key: 'two@example.com', email: 'two@example.com', display_name: 'Dos cuentas', identities: [
      { actor_id: 'two-local', email: 'two@example.com', display_name: 'Dos cuentas local', auth_source: 'local', is_active: true, must_change_password: false, roles: ['admin'], last_login_at: null },
      { actor_id: 'two-okta', email: 'two@example.com', display_name: 'Dos cuentas Okta', auth_source: 'oidc', is_active: true, must_change_password: false, roles: ['reader'], last_login_at: null },
    ] }], total: 21 } });
  });
  await page.goto('/admin/access');
  await page.getByRole('tab', { name: /Roles y permisos/ }).click();
  await page.getByRole('button', { name: 'Administrador de plataforma Sistema', exact: true }).click();
  await page.getByRole('button', { name: /^Miembros \(/ }).click();
  const members = page.getByRole('list', { name: 'Miembros de Administrador de plataforma' });
  await expect(members.getByRole('listitem').filter({ hasText: 'Dos cuentas local' })).toContainText('Local');
  await expect(members.getByText('Dos cuentas Okta')).toHaveCount(0);
  await expect.poll(() => queries.at(-1)?.searchParams.get('role')).toBe('admin');
  expect(queries.at(-1)?.searchParams.get('limit')).toBe('20');
  await page.locator('.role-members-panel').getByRole('button', { name: /siguiente/ }).click();
  await expect.poll(() => queries.at(-1)?.searchParams.get('offset')).toBe('20');
});

test('editing a saved composition retains its levels until an area is explicitly removed', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.route('**/api/access/roles', (route) => route.fulfill({ json: { rows: [{ role_code: 'security_reader', display_name: 'Lectura de seguridad', description: 'Lectura transversal', domain_code: null, role_kind: 'composite', lifecycle_status: 'planned', system_managed: false, permission_codes: ['inventory:read', 'domain:dlp', 'netskope:read', 'domain:dspm', 'bigid:read'], level_refs: [{ domain_code: 'platform', level_code: 'reader' }, { domain_code: 'dlp', level_code: 'reader' }, { domain_code: 'dspm', level_code: 'reader' }], user_count: 0, oidc_groups: ['legacy_group'] }] } }));
  let saved: unknown;
  await page.route('**/api/access/roles/security_reader/composite', async (route) => {
    saved = route.request().postDataJSON();
    await route.fulfill({ json: { updated: true, role_code: 'security_reader' } });
  });
  await page.goto('/admin/access');
  await page.getByRole('tab', { name: /Roles y permisos/ }).click();
  await page.getByRole('button', { name: 'Filtrar roles' }).click();
  await page.getByRole('option', { name: 'Preparados', exact: true }).click();
  await page.getByRole('button', { name: /Lectura de seguridad Niveles vinculados/ }).click();
  await expect(page.getByRole('region', { name: 'Vistas del menú' })).toHaveText(/Rol preparado: sin acceso efectivo/);
  await expect(page.getByText('legacy_group')).toBeVisible();
  await page.getByRole('button', { name: 'Editar rol', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nivel para Plataforma' })).toContainText('Lector');
  await expect(page.getByRole('button', { name: 'Nivel para Netskope DLP' })).toContainText('Lector');
  await expect(page.getByRole('button', { name: 'Nivel para BigID DSPM' })).toContainText('Lector');
  await page.getByRole('button', { name: 'Nivel para BigID DSPM' }).click();
  await page.getByRole('option', { name: 'Sin participación', exact: true }).click();
  await page.getByRole('button', { name: 'Nivel para Plataforma' }).click();
  await page.getByRole('option', { name: 'Sin participación', exact: true }).click();
  await expect(page.locator('.role-review-changes')).toContainText('Inventario PAM');
  await expect(page.getByRole('region', { name: 'Vistas del menú' })).toContainText('Netskope');
  await expect(page.locator('.role-impact')).toContainText('El cambio alcanza a todas las identidades con este rol.');
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await page.getByRole('alertdialog', { name: 'Revisar cambios del rol' }).getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect.poll(() => saved).toEqual({ display_name: 'Lectura de seguridad', description: 'Lectura transversal', level_refs: [{ domain_code: 'dlp', level_code: 'reader' }] });
});

test('role map compares each role once across areas and opens a cell in its area', async ({ page }) => {
  await page.addInitScript((theme) => localStorage.setItem('dshub-theme:v1', theme), test.info().project.use.colorScheme || 'dark');
  await mockAuthenticatedApp(page);
  await page.goto('/admin/access');
  await page.getByRole('tab', { name: /Roles y permisos/ }).click();
  const map = page.getByRole('region', { name: 'Mapa de accesos por rol' });
  await expect(map.locator('.role-map tbody > tr')).toHaveCount(4);
  await expectSystemSearch(page.getByRole('searchbox', { name: 'Buscar roles', exact: true }));
  const size = await map.evaluate((node) => ({ width: node.getBoundingClientRect().width, parent: node.closest('.role-admin')!.getBoundingClientRect().width }));
  expect(size.width / size.parent).toBeGreaterThan(.95);
  const netskopeTable = map.getByRole('table', { name: 'Netskope: roles y permisos' });
  const compartment = map.locator('details').filter({ has: page.getByRole('table', { name: 'Netskope: roles y permisos', includeHidden: true }) });
  const logo = compartment.locator('summary img:visible');
  await expect(logo).toHaveAttribute('src', test.info().project.use.colorScheme === 'light' ? '/netskope-full-black.png' : '/netskope-full-white.png');
  await expect.poll(() => logo.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await compartment.locator('summary').click();
  await expect(netskopeTable).toBeHidden();
  await compartment.locator('summary').click();
  await expect(netskopeTable).toBeVisible();
  const netskope = map.getByRole('row').filter({ hasText: 'Netskope · Lector' });
  await expect(netskope.getByRole('button', { name: 'Ver Netskope DLP de Netskope · Lector' })).toContainText('1 capacidad');
  await netskope.getByRole('button', { name: 'Ver Netskope DLP de Netskope · Lector' }).click();
  await expect(map).toHaveCount(0);
  const areaFilter = page.getByRole('navigation', { name: 'Filtrar capacidades por área' });
  await expect(areaFilter.getByRole('button', { name: 'Netskope DLP', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('table', { name: 'Permisos por capacidad' })).toContainText('Inventario, postura y métricas');
  await page.getByRole('button', { name: 'Todos los roles', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Buscar roles', exact: true }).fill('Inventario, postura');
  await expect(map.locator('.role-map tbody > tr')).toHaveCount(2);
  expect((await new AxeBuilder({ page }).include('.role-admin').analyze()).violations).toEqual([]);
});

test('a new capability role submits only explicit grants and keeps a denied save editable', async ({ page }) => {
  await mockAuthenticatedApp(page);
  const writes: Record<string, unknown>[] = [];
  await page.route('**/api/access/roles', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    writes.push(route.request().postDataJSON());
    await route.fulfill({ status: writes.length === 1 ? 403 : 201, json: writes.length === 1 ? { detail: 'Cambio fuera del techo de delegación' } : { created: true, role_code: 'netskope_exact' } });
  });
  await page.goto('/admin/access');
  await page.getByRole('tab', { name: /Roles y permisos/ }).click();
  await page.getByRole('button', { name: 'Nuevo rol', exact: true }).click();
  await expect(page.getByRole('radio', { name: /Capacidades concretas/ })).toBeChecked();
  await page.getByLabel('Nombre visible').fill('Lectura Netskope exacta');
  await page.getByLabel('Código interno').fill('netskope_exact');
  await page.getByLabel('Propósito', { exact: true }).fill('Consultar la flota');
  await page.getByRole('checkbox', { name: 'Habilitar Inventario, postura y métricas', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Habilitar Ingresar a Netskope DLP', exact: true }).check();
  await expect(page.locator('.role-impact')).not.toContainText('Inventario PAM');
  await page.getByRole('button', { name: 'Crear rol', exact: true }).click();
  await expect(page.getByText('Cambio fuera del techo de delegación')).toBeVisible();
  await expect(page.getByLabel('Nombre visible')).toHaveValue('Lectura Netskope exacta');
  await expect(page.getByRole('checkbox', { name: 'Habilitar Inventario, postura y métricas', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Crear rol', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toEqual({ role_code: 'netskope_exact', display_name: 'Lectura Netskope exacta', description: 'Consultar la flota', domain_code: 'platform', permission_codes: ['netskope:read', 'domain:dlp'] });
  await expect(page.getByRole('region', { name: 'Mapa de accesos por rol' })).toBeVisible();
});

test('role editor protects unsaved changes and returns to the map by keyboard', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/admin/access');
  await page.getByRole('tab', { name: /Roles y permisos/ }).click();
  await page.getByRole('button', { name: 'Nuevo rol', exact: true }).click();
  await page.getByLabel('Nombre visible').fill('Borrador');
  await page.getByRole('button', { name: 'Todos los roles', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Descartar cambios' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('Nombre visible')).toHaveValue('Borrador');
  await expect(page.getByRole('button', { name: 'Todos los roles', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await dialog.getByRole('button', { name: 'Descartar', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Mapa de accesos por rol' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nuevo rol', exact: true })).toBeFocused();
});

test('role mappings are authorized read-only references and never editable without a provider directory', async ({ page }) => {
  const writes: string[] = [];
  await mockAuthenticatedApp(page);
  await page.route('**/api/access/oidc-group-roles', (route) => { writes.push(route.request().method()); return route.fulfill({ json: {} }); });
  await page.goto('/admin/access');
  await page.getByRole('tab', { name: /Roles y permisos/ }).click();
  await page.getByRole('button', { name: 'Administrador de plataforma Sistema', exact: true }).click();
  const groups = page.getByRole('region', { name: 'Grupos de Okta que otorgan este rol' });
  await expect(groups).toContainText('sg_ds-hub_admins');
  await expect(groups.getByRole('textbox')).toHaveCount(0);
  await expect(groups.getByRole('button')).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('delegated role editors cannot select capabilities above their delegation ceiling or see group mappings', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['access:roles_manage', 'netskope:read', 'domain:dlp'] });
  await page.goto('/admin/access');
  await page.getByRole('button', { name: 'Nuevo rol', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Habilitar Acceso total (superadmin)', exact: true })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Habilitar Inventario, postura y métricas', exact: true })).toBeEnabled();
  await page.getByRole('radio', { name: /Niveles vinculados/ }).check();
  await page.getByRole('button', { name: 'Nivel para Plataforma' }).click();
  await expect(page.getByRole('option', { name: 'Administrador', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('alertdialog', { name: 'Descartar cambios' }).getByRole('button', { name: 'Descartar', exact: true }).click();
  await page.getByRole('button', { name: 'Administrador de plataforma Sistema', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Grupos de Okta que otorgan este rol' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Miembros/ })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).include('.role-admin').analyze()).violations).toEqual([]);
});

test('tool compartments group CyberArk areas, keep transversal roles unique, and accept new catalog tools', async ({ page }) => {
  await page.addInitScript((theme) => localStorage.setItem('dshub-theme:v1', theme), test.info().project.use.colorScheme || 'dark');
  await mockAuthenticatedApp(page);
  const areas = [
    { domain_code: 'platform', display_name: 'Plataforma', sort_order: 1 },
    { domain_code: 'pam', display_name: 'CyberArk PAM', sort_order: 2 },
    { domain_code: 'identity', display_name: 'Identity Administration', sort_order: 3 },
    { domain_code: 'sandbox', display_name: 'Herramienta de prueba', sort_order: 4 },
  ].map((area) => ({ ...area, lifecycle_status: 'active', levels: [] }));
  const perms = [
    { permission_code: 'inventory:read', domain_code: 'pam', description: 'Consultar inventario PAM' },
    { permission_code: 'identity:catalogs_read', domain_code: 'identity', description: 'Consultar Identity' },
    { permission_code: 'sandbox:read', domain_code: 'sandbox', description: 'Consultar herramienta de prueba' },
  ].map((permission) => ({ ...permission, resource_code: 'workspace', action_code: 'read', lifecycle_status: 'active', system_managed: true }));
  const roles = [
    { role_code: 'pam_read', display_name: 'Lectura PAM', domain_code: 'pam', permission_codes: ['inventory:read'], system_managed: true },
    { role_code: 'identity_read', display_name: 'Lectura Identity', domain_code: 'identity', permission_codes: ['identity:catalogs_read'], system_managed: true },
    { role_code: 'test_read', display_name: 'Lectura herramienta de prueba', domain_code: 'sandbox', permission_codes: ['sandbox:read'], system_managed: true },
    { role_code: 'mixed_read', display_name: 'Lectura transversal', domain_code: 'platform', permission_codes: ['inventory:read', 'sandbox:read'], system_managed: false },
  ].map((role) => ({ ...role, description: 'Perfil de consulta', role_kind: 'direct', lifecycle_status: 'active', level_refs: [], user_count: 0 }));
  await page.route('**/api/access/domains', (route) => route.fulfill({ json: { rows: areas } }));
  await page.route('**/api/access/permissions', (route) => route.fulfill({ json: { rows: perms } }));
  await page.route('**/api/access/roles', (route) => route.fulfill({ json: { rows: roles } }));
  await page.goto('/admin/access');
  await page.getByRole('tab', { name: /Roles y permisos/ }).click();
  const map = page.getByRole('region', { name: 'Mapa de accesos por rol' });
  const cyberark = map.getByRole('table', { name: 'CyberArk: roles y permisos' });
  await expect(cyberark.getByRole('row')).toHaveCount(3);
  await expect(cyberark).toContainText('Lectura PAM');
  await expect(cyberark).toContainText('Lectura Identity');
  await expect(map.getByRole('table', { name: 'Herramienta de prueba: roles y permisos' })).toContainText('Lectura herramienta de prueba');
  await expect(map.getByRole('button', { name: 'Lectura transversal Personalizado', exact: true })).toHaveCount(1);
  const expected = test.info().project.use.colorScheme === 'light' ? '/cyberark-logo-dark.png' : '/cyberark-logo-white.png';
  await expect(map.locator('details').filter({ has: page.getByRole('table', { name: 'CyberArk: roles y permisos', includeHidden: true }) }).locator('summary img:visible')).toHaveAttribute('src', expected);
  await cyberark.getByRole('button', { name: 'Lectura Identity Sistema', exact: true }).click();
  const table = page.getByRole('table', { name: 'Permisos por capacidad' });
  await expect(table).toContainText('CyberArk');
  await expect(table).toContainText('Identity Administration');
  await expect(table.locator('.role-area-band img:visible')).toHaveAttribute('src', expected);
  expect((await new AxeBuilder({ page }).include('.role-admin').analyze()).violations).toEqual([]);
});

test('a prepared role allows revoking an existing manual member without offering new grants', async ({ page }) => {
  await mockAuthenticatedApp(page);
  let revoked = false;
  await page.route('**/api/access/roles', (route) => route.fulfill({ json: { rows: [{ role_code: 'prepared_team', display_name: 'Equipo preparado', description: 'Perfil preparado', domain_code: 'dlp', role_kind: 'direct', lifecycle_status: 'planned', system_managed: false, permission_codes: ['netskope:read'], level_refs: [], user_count: 1 }] } }));
  await page.route('**/api/auth/people?**', (route) => route.fulfill({ json: { rows: [{ key: 'member@example.com', email: 'member@example.com', display_name: 'Miembro anterior', identities: [{ actor_id: 'member', email: 'member@example.com', display_name: 'Miembro anterior', auth_source: 'local', roles: ['prepared_team'], role_assignments: [{ role_code: 'prepared_team', source: 'manual' }], is_active: true }] }], total: 1 } }));
  await page.route('**/api/auth/users/member/roles/prepared_team', async (route) => { revoked = route.request().method() === 'DELETE'; await route.fulfill({ json: {} }); });
  await page.goto('/admin/access');
  await page.getByRole('tab', { name: /Roles y permisos/ }).click();
  await page.getByRole('button', { name: 'Filtrar roles' }).click();
  await page.getByRole('option', { name: 'Preparados', exact: true }).click();
  await page.getByRole('button', { name: 'Miembros (1)', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Miembros de Equipo preparado' });
  await expect(panel.getByLabel('Agregar miembro a Equipo preparado')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Quitar Equipo preparado a Miembro anterior' }).click();
  await expect.poll(() => revoked).toBe(true);
});
