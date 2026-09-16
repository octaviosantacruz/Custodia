import AxeBuilder from '@axe-core/playwright';
import { expect, mockAuthenticatedApp, test } from './fixtures';

test('logout from a PAM route returns to the neutral home route', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam');

  await page.getByRole('button', { name: 'Abrir menú de usuario' }).click();
  await expect(page.getByRole('button', { name: 'Abrir menú de usuario' })).toHaveAttribute('title', 'Ver cuenta, rol y opciones de sesión');
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Bienvenido a DS Hub.' })).toBeVisible();
});

test('CyberArk node in the home visibility wheel opens PAM', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/');

  const cyberArkNode = page.locator('.home-visibility-node-cyberark');
  await cyberArkNode.hover();
  await expect(page.locator('.home-visibility')).toHaveAttribute('data-active-domain', 'cyberark');
  await expect(page.locator('.home-visibility-line-one')).toHaveCSS('background-color', 'rgb(53, 196, 119)');
  await cyberArkNode.click();

  await expect(page).toHaveURL(/\/pam$/);
});

test('opening PAM from home enters with a gentle workspace transition', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/');

  await page.locator('.home-domain-button').filter({ hasText: 'CyberArk PAM' }).click();

  await expect(page).toHaveURL(/\/pam$/);
  await expect(page.locator('.workspace-shell')).toHaveCSS('animation-name', 'workspace-arrive');
});

test('readers find PAM views without seeing restricted workspaces', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'] });
  await page.goto('/pam');

  await page.getByRole('button', { name: /Cambiar workspace/ }).click();
  const menu = page.getByRole('region', { name: 'Workspaces' });
  await expect(menu.locator('[data-section="tool-workspaces"]').getByRole('button', { name: /Postura Hallazgos y evidencia accionable/ })).toBeVisible();
  await expect(menu.getByRole('button', { name: /Acceso Usuarios de la plataforma/ })).toHaveCount(0);
  await expect(menu.getByRole('button', { name: /Cadenas Explorador visual de acceso PAM/ })).toHaveCount(0);
  await expect(menu.getByRole('button', { name: /Plataformas Safes y cuentas por plataforma/ })).toHaveCount(0);
  await expect(menu.getByRole('button', { name: /Conectores PSM PSM y plataformas vinculadas/ })).toHaveCount(0);
  await expect(menu.getByRole('button', { name: /Salud PAM/ })).toHaveCount(0);
  await expect(menu.getByRole('button', { name: /Aplicaciones AIM/ })).toHaveCount(0);
  await expect(menu.getByRole('button', { name: /Assets de Access/ })).toHaveCount(0);
  await expect(menu.getByRole('button', { name: /Conectores SIA/ })).toHaveCount(0);
  await expect(menu.getByRole('button', { name: /Recursos SIA/ })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-section="tool-workspaces"]').getByRole('button', { name: /Postura Hallazgos y evidencia accionable/ })).toBeVisible();
  await expect.poll(() => menu.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= window.innerWidth;
  })).toBe(true);

  await page.goto('/pam');
  await page.getByRole('button', { name: /Cambiar workspace/ }).click();
  const pamMenu = page.getByRole('region', { name: 'Workspaces' });
  await expect(pamMenu.locator('[data-section="tool-workspaces"]').getByRole('button', { name: /SIA.*Políticas, recursos y cobertura/ })).toBeVisible();
});

test('readers see metrics without synchronization controls', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'domain:pam'] });
  await page.goto('/pam');

  await expect(page.getByRole('region', { name: 'Mi panel de métricas' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sincronizar datos' })).toHaveCount(0);

  await page.goto('/pam/graph');
  await expect(page).toHaveURL(/\/pam$/);
  await expect(page.getByRole('region', { name: 'Mi panel de métricas' })).toBeVisible();
});

test('PAM role view exposes the verified user to Safe chain', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/roles');

  await expect(page.getByRole('heading', { name: 'Roles CyberArk', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByText('Operations', { exact: true })).toBeVisible();
  await page.getByRole('row', { name: /Operations.*ver conexiones/ }).click();
  await expect(page.getByText('Safes alcanzables', { exact: true })).toBeVisible();
  await expect(page.getByText('Finance', { exact: true })).toBeVisible();
  await expect(page.getByText('Referencia por nombre de rol; no es una relación normalizada', { exact: false })).toBeVisible();
});

test('assets and connections explain Safe and SIA coverage for a migrated connection', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam');
  await page.getByRole('button', { name: /Cambiar workspace/ }).click();
  // IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §3.2 (Fase 2): "Activos
  // y conexiones" is no longer a separate switcher destination -- it's
  // the Cobertura tab inside the single SIA hub.
  await page.getByRole('region', { name: 'Workspaces' }).locator('[data-section="tool-workspaces"]').getByRole('button', { name: /SIA.*Políticas, recursos y cobertura/ }).click();
  await page.getByRole('tablist', { name: 'Secciones de SIA' }).getByRole('tab', { name: /Cobertura.*Activos y conexiones/ }).click();

  await expect(page).toHaveURL(/\/pam\/assets$/);
  await expect(page.getByRole('heading', { name: 'Activos y conexiones', exact: true, level: 2 })).toBeVisible();
  await expect(page.getByText('10.67.9.143', { exact: true })).toBeVisible();
  await expect(page.getByText('Cubierta en Safe + SIA', { exact: true })).toBeVisible();
  await page.getByRole('row', { name: /dev-compute-db-desa.*ver cobertura/i }).click();
  await expect(page.getByText('Encontrado en Safes', { exact: true })).toBeVisible();
  await expect(page.getByText('Finance', { exact: true })).toBeVisible();
  await expect(page.getByText('Encontrado en SIA', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'SSH · Linux posible', exact: true })).toBeVisible();
});

test('the legacy /pam/ip-inventory URL redirects to the canonical assets path', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/ip-inventory');

  await expect(page).toHaveURL(/\/pam\/assets$/);
  await expect(page.getByRole('heading', { name: 'Activos y conexiones', exact: true, level: 2 })).toBeVisible();
});

test('Safes, accounts and PAM roles load the next batch without replacing the current context', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'inventory:write', 'catalogs:write', 'access:manage'], includeSafe: true, largeInventory: true });

  await page.goto('/pam/safes');
  await expect(page.getByRole('heading', { name: 'Safes', exact: true })).toBeVisible();
  await expect(page.getByText('Mostrando 1 de 51')).toBeVisible();
  await page.getByRole('button', { name: 'Cargar 50 más' }).click();
  await expect(page.getByText('Finance', { exact: true })).toBeVisible();
  await expect(page.getByText('Finance 2', { exact: true })).toBeVisible();
  await expect(page.getByText('Mostrando 2 de 51')).toBeVisible();

  await page.getByRole('button', { name: 'Ver cuentas de Finance', exact: true }).click();
  await expect(page.getByText('db-finance', { exact: true })).toBeVisible();

  await page.goto('/pam/roles');
  await expect(page.getByRole('heading', { name: 'Roles CyberArk', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByText('Mostrando 1 de 51')).toBeVisible();
  await page.getByRole('button', { name: 'Cargar 50 más' }).click();
  await expect(page.getByText('Operations', { exact: true })).toBeVisible();
  await expect(page.getByText('Operations 2', { exact: true })).toBeVisible();
  await expect(page.getByText('Mostrando 2 de 51')).toBeVisible();
});

test('PAM chain workspace preserves each end-to-end branch', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/graph');

  await expect(page.getByRole('heading', { name: 'Cadenas', exact: true, level: 1 })).toBeVisible();
  await page.getByRole('button', { name: /Cambiar workspace/ }).click();
  const workspaceMenu = page.getByRole('region', { name: 'Workspaces' });
  await expect(workspaceMenu.locator('[data-section="quick-access"]').getByRole('button', { name: /Cadenas.*Explorador visual/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(workspaceMenu).toHaveCount(0);

  const userButton = page.getByRole('button', { name: /Ada.*9 roles/ });
  await userButton.focus();
  await expect(userButton).toBeFocused();
  await userButton.press('Enter');
  const map = page.getByRole('region', { name: 'Mapa de relaciones PAM' });
  await expect(map).toContainText('Mapa de acceso de Ada');
  await expect(map).toContainText('Operations');
  await expect(map).toContainText('Finance');
  await expect(map).toContainText('Treasury');
  await expect(map).toContainText('Unix');
  await expect(map).toContainText('PSM-01');
  await expect(map).toContainText('13 ramas');
  const operationsGroup = map.locator('.pam-layered-role-group').filter({ hasText: 'Operations' });
  await expect(operationsGroup).toHaveCount(1);
  await expect(operationsGroup.getByRole('button', { name: 'Abrir Safe Finance' })).toHaveCount(1);
  await expect(operationsGroup.getByRole('button', { name: 'Abrir Plataforma Unix' })).toHaveCount(1);
  await expect(operationsGroup.getByRole('button', { name: 'Abrir PSM PSM-01' })).toHaveCount(1);
  const routeCells = operationsGroup.locator('.pam-layered-role-routes > .pam-layered-branch > .pam-layered-cell');
  const [roleCellBox, platformCellBox, psmCellBox] = await Promise.all([
    operationsGroup.locator('.pam-layered-role-cell').boundingBox(),
    routeCells.nth(1).boundingBox(),
    routeCells.nth(2).boundingBox(),
  ]);
  expect(roleCellBox && platformCellBox && Math.abs((roleCellBox.y + roleCellBox.height / 2) - (platformCellBox.y + platformCellBox.height / 2))).toBeLessThan(2);
  expect(roleCellBox && psmCellBox && Math.abs((roleCellBox.y + roleCellBox.height / 2) - (psmCellBox.y + psmCellBox.height / 2))).toBeLessThan(2);
  await expect(map.getByRole('button', { name: 'Abrir Safe Finance' })).toBeVisible();
  await expect(map.getByRole('button', { name: 'Abrir Safe Payroll' })).toBeVisible();
  await expect(map.getByRole('button', { name: 'Abrir Safe Vault' })).not.toBeVisible();
  await map.getByRole('button', { name: '+ 1 más' }).click({ force: true });
  await expect(map.getByRole('button', { name: 'Abrir Safe Vault' })).toBeVisible();
  await map.getByRole('button', { name: 'Mostrar menos' }).click();
  await expect(map.getByRole('button', { name: 'Abrir Safe Vault' })).not.toBeVisible();

  const accessibility = await new AxeBuilder({ page })
    .include('.pam-chain-layout')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);

  await map.getByRole('button', { name: 'Abrir Safe Finance' }).click();
  const safeDialog = page.getByRole('dialog', { name: 'Finance' });
  await expect(safeDialog).toContainText('2');
  const drawerAccessibility = await new AxeBuilder({ page })
    .include('.pam-chain-node-drawer')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(drawerAccessibility.violations).toEqual([]);
  await safeDialog.getByRole('button', { name: /Abrir inventario/ }).click();
  await expect(page).toHaveURL(/\/pam\/safes$/);
});

test('PAM chain is a visual explorer with inventory routes', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/graph');

  await expect(page.getByRole('heading', { name: 'Elegí una identidad y seguí su acceso' })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Buscar usuarios PAM por nombre o identificador' })).toBeVisible();
  const overview = page.getByRole('region', { name: 'Mapa de la cadena PAM' });
  await expect(overview).toContainText('Usuario PAM');
  await expect(overview).toContainText('Rol');
  await expect(overview).toContainText('Safe');
  await expect(overview).toContainText('Plataforma');
  await expect(overview).toContainText('PSM');
});

test('PAM chain links its selected username and roles into the consolidated Identity workspace', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/graph');
  await page.getByRole('button', { name: /Ada.*9 roles/ }).click();
  const map = page.getByRole('region', { name: 'Mapa de relaciones PAM' });

  await map.getByRole('button', { name: 'Abrir Rol CyberArk Operations' }).click();
  await expect(page).toHaveURL(/\/pam\/roles$/);
  await expect(page.getByRole('searchbox', { name: 'Buscar roles cyberark' })).toHaveValue('Operations');

  await page.goto('/pam/graph');
  await page.getByRole('button', { name: /Ada.*9 roles/ }).click();
  await page.getByRole('region', { name: 'Mapa de relaciones PAM' }).getByRole('button', { name: 'Buscar Ada en Identidades' }).click();
  await expect(page).toHaveURL(/\/pam\/identity\/users$/);
  await expect(page.getByRole('searchbox', { name: 'Buscar usuarios de Identity Administration' })).toHaveValue('Ada');
});

test('PAM platforms are a dedicated workspace separate from connectors and SIA', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/platforms');

  await expect(page.getByRole('searchbox', { name: 'Buscar plataformas PAM' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Unix/ })).toBeVisible();
  await expect(page.getByText('Sólo activas', { exact: true })).toBeVisible();
  await expect(page.locator('.pam-platform-pattern')).toHaveText('^Unix-');
  await expect(page.getByRole('button', { name: /1 conector/ })).toBeVisible();
  await expect(page.getByText('PSM-01', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Política por plataforma destino', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Elegir vista de plataformas' }).click();
  await page.getByRole('option', { name: 'Política CPM' }).click();
  await expect(page.getByText('Política por plataforma destino', { exact: true })).toBeVisible();
});

test('PAM platforms workspace paginates past the first page instead of silently truncating', async ({ page }) => {
  await mockAuthenticatedApp(page, { largeInventory: true });
  await page.goto('/pam/platforms');

  await expect(page.getByText('Mostrando 1 de 101')).toBeVisible();
  await page.getByRole('button', { name: /Cargar \d+ más/ }).click();
  await expect(page.getByRole('button', { name: /Windows/ })).toBeVisible();
  await expect(page.getByText('Mostrando 2 de 101')).toBeVisible();
});

test('PAM platforms workspace recovers from a failed load with a retry button', async ({ page }) => {
  let attempts = 0;
  await mockAuthenticatedApp(page);
  await page.route('**/api/cmdb/pam-platforms*', async (route) => {
    attempts += 1;
    if (attempts === 1) { await route.abort('failed'); return; }
    await route.fallback();
  });
  await page.goto('/pam/platforms');

  await expect(page.getByText('No se pudieron cargar las plataformas PAM')).toBeVisible();
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.getByRole('button', { name: /Unix/ })).toBeVisible();
});

test('connectors workspace unifies PSM and SIA inventories without joining their data', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/connectors');

  await expect(page.getByRole('searchbox', { name: 'Buscar conectores PSM' })).toBeVisible();
  await expect(page.getByText('PSM-01', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Unix/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Elegir inventario de conectores' })).toBeVisible();
  await page.getByRole('button', { name: 'Elegir inventario de conectores' }).click();
  await page.getByRole('option', { name: 'SIA' }).click();
  await expect(page.getByText('connector-1', { exact: true })).toBeVisible();
});

test('posture workspace exposes evidence and administrative status action', async ({ page }) => {
  let updateMethod = '';
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/findings/1') updateMethod = request.method();
  });
  await mockAuthenticatedApp(page);
  await page.goto('/pam/posture');

  await expect(page.getByRole('heading', { name: 'Postura', exact: true, level: 2 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Actualizar reglas' })).toHaveAttribute('title', 'Volver a evaluar las reglas con el inventario actual');
  await expect(page.getByRole('cell', { name: 'Calidad de datos' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Completar plataforma en la fuente' })).toBeVisible();
  await page.getByRole('button', { name: /Cuenta sin plataforma informada/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Cuenta sin plataforma informada' });
  await expect(dialog).toContainText('Finance');
  await expect(dialog).toContainText('Qué observamos');
  await expect(dialog).toContainText('Qué podés hacer');
  await dialog.getByText('Evidencia técnica').click();
  await expect(dialog).toContainText('Campos observados en cyberark');
  await dialog.getByRole('combobox', { name: 'Estado del hallazgo' }).selectOption('acknowledged');
  await dialog.getByRole('button', { name: 'Guardar revisión' }).click();
  await expect.poll(() => updateMethod).toBe('PATCH');
  await expect(page.getByText('Estado del hallazgo actualizado')).toBeVisible();
});

test('internal scope follows the user through Posture and PAM chains', async ({ page }) => {
  const lastUrlFor = (fragment: string) => {
    let latest = '';
    page.on('request', (request) => {
      if (request.url().includes(fragment)) latest = request.url();
    });
    return () => latest;
  };
  const findingsUrl = lastUrlFor('/api/findings');
  const pamUsersUrl = lastUrlFor('/api/cmdb/pam-users');
  const pamRolesUrl = lastUrlFor('/api/cmdb/pam-roles');

  await mockAuthenticatedApp(page);
  await page.goto('/pam/posture');
  await page.getByRole('button', { name: 'Abrir menú de usuario' }).click();
  const internalToggle = page.getByRole('switch', { name: 'Incluir internos CyberArk' });
  await internalToggle.uncheck();
  await page.keyboard.press('Escape');
  await expect.poll(() => findingsUrl() ? new URL(findingsUrl()).searchParams.get('include_internal') : null).toBe('false');

  await page.goto('/pam/graph');
  await expect(page.getByRole('heading', { name: 'Cadenas', exact: true, level: 1 })).toBeVisible();
  await expect.poll(() => pamUsersUrl() ? new URL(pamUsersUrl()).searchParams.get('include_internal') : null).toBe('false');
  await page.goto('/pam/roles');
  await expect(page.getByRole('heading', { name: 'Roles CyberArk', exact: true, level: 1 })).toBeVisible();
  await expect.poll(() => pamRolesUrl() ? new URL(pamRolesUrl()).searchParams.get('include_internal') : null).toBe('false');
});

test('PAM users expose Standard seat reconciliation without a separate workspace', async ({ page }) => {
  let pamUsersRequest = '';
  page.on('request', (request) => {
    if (request.url().includes('/api/cmdb/pam-users')) pamUsersRequest = request.url();
  });
  await mockAuthenticatedApp(page);
  await page.goto('/pam');
  await expect(page.getByRole('heading', { name: 'Asientos Standard conciliados', exact: true })).toHaveCount(0);

  await page.goto('/pam/graph');
  await expect(page.getByRole('button', { name: /Ada.*9 roles/ })).toBeVisible();
  await expect(page.getByLabel('Asiento Standard conciliado')).toBeVisible();
  await expect(page.getByText('Licencia Standard', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Asiento Standard conciliado')).toHaveAttribute('title', /evidencia PAM.*no es facturación/);
  await page.getByRole('button', { name: 'Filtrar usuarios PAM por conciliación de asiento Standard' }).click();
  await page.getByRole('option', { name: 'Asiento Standard conciliado', exact: true }).click();
  await expect.poll(() => pamUsersRequest ? new URL(pamUsersRequest).searchParams.get('standard_seat') : null).toBe('reconciled');
  await page.goto('/pam/licenses');
  await expect(page).toHaveURL(/\/pam$/);
});

test('admins discover PAM system health while AIM remains a deep link', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam');

  await page.getByRole('button', { name: /Cambiar workspace/ }).click();
  const menu = page.getByRole('region', { name: 'Workspaces' });
  await expect(menu.locator('[data-section="tool-workspaces"]').getByRole('button', { name: /Salud PAM.*Conectividad/ })).toBeVisible();
  await expect(menu.locator('[data-section="tool-workspaces"]').getByRole('button', { name: /Aplicaciones AIM.*Application Identity Manager/ })).toHaveCount(0);
});

test('PAM system health shows component connectivity without host metrics', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/health');

  await expect(page.getByRole('heading', { name: 'Salud de componentes', exact: true })).toBeVisible();
  await expect(page.getByText('PVWA', { exact: true })).toBeVisible();
  await expect(page.getByText('1/2')).toBeVisible();
  await expect(page.getByText('14.9.2', { exact: true })).toBeVisible();
  // No per-instance host inventory (IP/username) column or value ever renders here.
  await expect(page.getByRole('columnheader', { name: /dirección|ip|usuario/i })).toHaveCount(0);
  await expect(page.getByText('10.0.0.5', { exact: true })).toHaveCount(0);
});

test('AIM applications workspace lists the catalog without owner data', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/aim-applications');

  await expect(page.getByRole('heading', { name: 'Aplicaciones AIM', exact: true, level: 3 })).toBeVisible();
  await expect(page.getByText('Finance batch job', { exact: true })).toBeVisible();
  await expect(page.getByText('Habilitada', { exact: true })).toBeVisible();
});

test('Access assets is reachable as a Recursos section inside SIA, not a separate switcher destination', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam');

  await page.getByRole('button', { name: /Cambiar workspace/ }).click();
  const menu = page.getByRole('region', { name: 'Workspaces' });
  await expect(menu.locator('[data-section="tool-workspaces"]').getByRole('button', { name: /Assets de Access/ })).toHaveCount(0);
  await expect(menu.getByRole('button', { name: /SIA.*Políticas, recursos y cobertura/ })).toHaveCount(1);
});

test('Access assets workspace shows the confirmed PAM platform link without host data', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/access-assets');

  await expect(page.getByRole('heading', { name: 'Assets de Access', exact: true, level: 3 })).toBeVisible();
  await expect(page.getByText('509_3', { exact: true })).toBeVisible();
  await expect(page.getByText('Unix', { exact: true })).toBeVisible();
  await expect(page.getByText('rdp', { exact: true })).toBeVisible();
  // Never shows the excluded host/account fields.
  await expect(page.getByRole('columnheader', { name: /^dirección$|^ip$|^usuario$/i })).toHaveCount(0);
});

test('Access assets workspace paginates past the first page and lets the operator copy a source_id', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await mockAuthenticatedApp(page, { largeInventory: true });
  await page.goto('/pam/access-assets');

  await expect(page.getByText('Mostrando 1 de 101')).toBeVisible();
  await page.getByRole('button', { name: /Cargar \d+ más/ }).click();
  await expect(page.getByText('509_3', { exact: true })).toBeVisible();
  await expect(page.getByText('509_4', { exact: true })).toBeVisible();
  await expect(page.getByText('Mostrando 2 de 101')).toBeVisible();

  await page.getByRole('button', { name: 'Copiar identificador' }).first().click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe('509_3');
});

test('an out-of-order Access assets search response never clobbers a newer search result', async ({ page }) => {
  // AUD (follow-up on b587818): useSimpleCatalogList backs every "simple
  // catalog" workspace (Access assets, SIA resources/database accounts,
  // Identity federations, AIM applications, PAM platforms) and only relied
  // on AbortController. This proves the added monotonic requestId guard
  // (matching use-sia.ts et al.) actually protects state updates even if a
  // stale response resolves after a newer request has already started.
  await mockAuthenticatedApp(page);
  await page.route('**/api/cmdb/access-assets*', async (route) => {
    const requestUrl = new URL(route.request().url());
    const q = requestUrl.searchParams.get('q') || '';
    if (q === 'stale-term') {
      await new Promise((resolve) => setTimeout(resolve, 900));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rows: [{ object_id: 999, display_name: 'STALE ASSET', source_id: 'stale', attributes: { access_method: 'RDP', asset_category: 'server', asset_type: 'windows', platform_type: 'Windows', platform_subtype: 'Domain', protocol: 'rdp', workflow_status: 'active', is_favorite: false, connection_components: [], port: 0, platform_id: '0' }, platform_name: null }], total: 1, limit: 100, offset: 0, search: q }),
      });
      return;
    }
    if (q === 'fresh-term') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rows: [{ object_id: 50, display_name: '509_3', source_id: '509_3', attributes: { access_method: 'RDP', asset_category: 'server', asset_type: 'windows', platform_type: 'Windows', platform_subtype: 'Domain', protocol: 'rdp', workflow_status: 'active', is_favorite: true, connection_components: ['PSM-RDP'], port: 3389, platform_id: '10' }, platform_name: 'Unix' }], total: 1, limit: 100, offset: 0, search: q }),
      });
      return;
    }
    await route.fallback();
  });
  await page.goto('/pam/access-assets');
  await expect(page.getByRole('heading', { name: 'Assets de Access', exact: true, level: 3 })).toBeVisible();

  const searchBox = page.getByRole('searchbox', { name: 'Buscar assets de Access' });
  await searchBox.fill('stale-term');
  await page.waitForTimeout(350);
  await searchBox.fill('fresh-term');

  await expect(page.getByText('509_3', { exact: true })).toBeVisible();
  await page.waitForTimeout(700);
  await expect(page.getByText('509_3', { exact: true })).toBeVisible();
  await expect(page.getByText('STALE ASSET', { exact: true })).toHaveCount(0);
});

test('admins discover the unified connectors workspace from the workspace switcher', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam');

  await page.getByRole('button', { name: /Cambiar workspace/ }).click();
  const menu = page.getByRole('region', { name: 'Workspaces' });
  await expect(menu.locator('[data-section="tool-workspaces"]').getByRole('button', { name: /Conectores PSM y SIA.*Inventarios PSM y SIA/ })).toBeVisible();
  // IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §3.2 (Fase 2): SIA
  // Resources is no longer a separate switcher destination -- it's the
  // default Recursos section inside the single SIA hub.
  await expect(menu.locator('[data-section="tool-workspaces"]').getByRole('button', { name: /Recursos SIA/ })).toHaveCount(0);
});

test('legacy SIA connectors URL lands on the unified workspace and shows status without host data', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/sia/connectors');

  await expect(page).toHaveURL(/\/pam\/connectors$/);
  await page.getByRole('button', { name: 'Elegir inventario de conectores' }).click();
  await page.getByRole('option', { name: 'SIA' }).click();
  await expect(page.getByText('connector-1', { exact: true })).toBeVisible();
  await expect(page.getByText('connected', { exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /^dirección$|^ip$|^host$|^red$/i })).toHaveCount(0);
});

test('SIA resources workspace shows VM infrastructure without host data', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/sia/resources');

  await expect(page.getByRole('heading', { name: 'Recursos SIA', exact: true, level: 3 })).toBeVisible();
  await expect(page.getByText('web-01', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'virtual_machine', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /^dirección$|^ip$|^fqdn$|^red$/i })).toHaveCount(0);
});

test('SIA database accounts is reachable inside the SIA hub, not a separate switcher destination', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam');

  await page.getByRole('button', { name: /Cambiar workspace/ }).click();
  const menu = page.getByRole('region', { name: 'Workspaces' });
  // IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §3.1/§3.2: neither
  // Federaciones (Identidades' Fase 1) nor Cuentas fuertes de BD SIA
  // (SIA's Fase 2) are separate switcher destinations anymore -- both
  // live as tabs inside their single hub.
  await expect(menu.locator('[data-section="tool-workspaces"]').getByRole('button', { name: /Cuentas fuertes de BD SIA/ })).toHaveCount(0);
  await expect(menu.locator('[data-section="tool-workspaces"]').getByRole('button', { name: /Federaciones/ })).toHaveCount(0);
  await expect(menu.getByRole('button', { name: /Identidades.*Directorio SCIM/ })).toHaveCount(1);
  await expect(menu.getByRole('button', { name: /SIA.*Políticas, recursos y cobertura/ })).toHaveCount(1);
});

test('SIA database accounts workspace shows platform/database without account credentials', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/sia/database-accounts');

  await expect(page.getByRole('heading', { name: 'Cuentas fuertes de base de datos', exact: true, level: 3 })).toBeVisible();
  await expect(page.getByText('app-db-account', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'MySQL', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'app', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /^dirección$|^usuario$/i })).toHaveCount(0);
});

test('Identity federations workspace shows core fields without SAML/SSO certificates', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/identity/federations');

  await expect(page.getByRole('heading', { name: 'Federaciones', exact: true, level: 3 })).toBeVisible();
  await expect(page.getByText('Okta-ITTI', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'SAML', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /^config$|^dominios$|^apps$|^certificado/i })).toHaveCount(0);
});
