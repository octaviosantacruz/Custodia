import AxeBuilder from '@axe-core/playwright';
import { expect, mockAuthenticatedApp, test } from '../../support/fixtures';

test('logout from a PAM route returns to the neutral home route', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam');

  await page.getByRole('button', { name: 'Abrir menú de usuario' }).click();
  await expect(page.getByRole('button', { name: 'Abrir menú de usuario' })).toHaveAttribute('title', 'Ver cuenta, rol y opciones de sesión');
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Iniciar sesión', level: 1 })).toBeVisible();
});

test('CyberArk node in the home visibility wheel highlights and opens PAM', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/');

  const cyberArkNode = page.locator('.home-visibility-node-cyberark');
  await cyberArkNode.hover();
  await expect(page.locator('.home-visibility')).toHaveAttribute('data-active-domain', 'cyberark');
  await expect(page.locator('.home-visibility-line-cyberark')).toHaveCSS('background-color', 'rgb(53, 196, 119)');
  await cyberArkNode.click();
  await expect(page).toHaveURL(/\/pam$/);
});

test('opening PAM from home does not replay an arrival for the same workspace', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/');

  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1_000));
  await page.getByRole('region', { name: 'Plataformas' }).getByRole('button', { name: /^CyberArk\b/ }).click();

  await expect(page).toHaveURL(/\/pam$/);
  await expect(page.locator('.workspace-content')).not.toHaveClass(/is-arriving-[ab]/);
});

test('readers find PAM views without seeing restricted workspaces', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'] });
  await page.goto('/pam');

  const menu = page.getByRole('navigation', { name: 'Secciones de CyberArk', exact: true });
  await expect(menu.getByRole('link', { name: /^Postura$/ })).toBeVisible();
  await expect(menu.getByRole('link', { name: /^Usuarios y permisos$/ })).toHaveCount(0);
  await expect(menu.getByRole('link', { name: /^Acceso$/ })).toHaveCount(0);
  await expect(menu.getByRole('link', { name: /^Plataformas$/ })).toHaveCount(0);
  await expect(menu.getByRole('link', { name: /^Conectores PSM/ })).toHaveCount(0);
  await expect(menu.getByRole('link', { name: /Salud PAM/ })).toHaveCount(0);
  await expect(menu.getByRole('link', { name: /Activos de Access/ })).toHaveCount(0);
  await expect(menu.getByRole('link', { name: /Conectores SIA/ })).toHaveCount(0);
  await expect(menu.getByRole('link', { name: /Máquinas virtuales SIA/ })).toHaveCount(0);

  const pamMenu = page.getByRole('navigation', { name: 'Secciones de CyberArk', exact: true });
  await expect(pamMenu.getByRole('link', { name: /^SIA$/ })).toBeVisible();
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

test('infrastructure inventory explains Safe and SIA coverage for a migrated connection (UX-AUD2-009)', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam');
  // The migrated-connection inventory is its own CyberArk destination
  // (2026-10-10), no longer a Cobertura tab inside the SIA hub.
  await page.getByRole('navigation', { name: 'Secciones de CyberArk', exact: true }).getByRole('link', { name: 'Cobertura', exact: true }).click();

  await expect(page).toHaveURL(/\/pam\/assets$/);
  await expect(page.getByRole('heading', { name: 'Cobertura', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByText('10.67.9.143', { exact: true })).toBeVisible();
  await expect(page.getByText('Cubierta en Safe + SIA', { exact: true })).toBeVisible();
  await page.getByRole('row', { name: /dev-compute-db-desa/i }).getByRole('button', { name: /Ver cobertura de dev-compute-db-desa/i }).click();
  await expect(page.getByText('Encontrado en Safes', { exact: true })).toBeVisible();
  await expect(page.getByText('Finance', { exact: true })).toBeVisible();
  await expect(page.getByText('Encontrado en SIA', { exact: true })).toBeVisible();
  await expect(page.getByText(/SSH · Linux posible · derivado únicamente del puerto/)).toBeVisible();
  await expect(page.getByText('Platform: Coincide')).toBeVisible();
  await expect(page.getByText('DBA: Falta en SIA')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', test.info().project.name.includes('light') ? 'light' : 'dark');
  await expect(page.locator('.connection-inventory-source time')).toHaveAttribute('datetime', '2026-08-29T00:00:00Z');
  await expect(page.locator('.connection-inventory-source time')).toHaveAttribute('title', /^hace /);
});

test('the legacy /pam/ip-inventory URL redirects to the canonical assets path', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/ip-inventory');

  await expect(page).toHaveURL(/\/pam\/assets$/);
  await expect(page.getByRole('heading', { name: 'Cobertura', exact: true, level: 1 })).toBeVisible();
});

test('Safes and accounts load the next batch without replacing the current context', async ({ page }) => {
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
  await expect(page.locator('html')).toHaveAttribute('data-theme', test.info().project.name.includes('light') ? 'light' : 'dark');

});

test('Cadenas PAM walks the map column by column, swaps a branch and reaches inventory', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/graph');

  await expect(page.getByRole('heading', { name: 'Acceso', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Secciones de CyberArk', exact: true }).getByRole('link', { name: 'Acceso', exact: true })).toHaveAttribute('aria-current', 'page');

  await page.getByRole('searchbox', { name: 'Buscar nodos de la cadena PAM' }).fill('Ada');
  await page.getByRole('option', { name: /^Ada u-8/ }).click();
  await expect(page.getByLabel('Elegido en Identidad: Ada')).toBeVisible();

  // The column right of the root lists what it reaches; choosing draws the link.
  await page.getByRole('group', { name: 'A qué llega en Rol' }).getByRole('button', { name: /Operations/ }).click();
  await expect(page.getByLabel('Elegido en Rol: Operations')).toBeVisible();
  await expect(page.getByLabel(/Por qué se conecta: Verificada: Membresía usuario → rol/)).toBeVisible();

  const safes = page.getByRole('group', { name: 'A qué llega en Safe' });
  await expect(safes.getByRole('button', { name: /Treasury/ })).toBeVisible();
  await safes.getByRole('button', { name: /Finance/ }).click();
  await page.getByRole('group', { name: 'A qué llega en Plataforma' }).getByRole('button', { name: /Unix/ }).click();
  await expect(page.getByLabel('Elegido en Plataforma: Unix')).toBeVisible();
  await expect(page.getByLabel('Elegido en PSM · Asset Access: PSM-01')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'A qué llega en PSM · Asset Access' }).getByRole('button', { name: /PSM-01/ })).toBeVisible();

  // Swapping a Safe drops the platform that hung on the previous one.
  await safes.getByRole('button', { name: /Treasury/ }).click();
  await expect(page.getByLabel('Elegido en Safe: Treasury')).toBeVisible();
  await expect(page.getByLabel('Elegido en Plataforma: Unix')).toHaveCount(0);
  await expect(page).toHaveURL(/trail=user%3A8%3Erole%3A7%3Esafe%3A10/);
  await page.getByRole('button', { name: 'Quitar Treasury del recorrido' }).click();
  await expect(page.getByLabel('Elegido en Safe: Treasury')).toHaveCount(0);
  await expect(page.getByLabel('Elegido en Rol: Operations')).toBeVisible();

  const accessibility = await new AxeBuilder({ page })
    .include('.chain-explorer')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);

  await page.getByRole('button', { name: 'Ver detalle de Ada' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ada' });
  const drawerAccessibility = await new AxeBuilder({ page })
    .include('.chain-node-drawer')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(drawerAccessibility.violations).toEqual([]);
  await dialog.getByRole('button', { name: /Abrir inventario/ }).click();
  await expect(page).toHaveURL(/\/pam\/identity\/users$/);
});

test('Relaciones shows the Identity person and their PAM account as one node', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/graph');

  // One column for the person; found by name, titled with the person, and the
  // PAM account lives inside the card (never a separate Identity node or a UUID).
  await page.getByRole('searchbox', { name: 'Buscar nodos de la cadena PAM' }).fill('Grace');
  await page.getByRole('option', { name: /^Grace Hopper grace@acme.example/ }).click();
  await expect(page.getByLabel('Elegido en Identidad: Grace Hopper')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Columna Identidad' })).toBeVisible();
  await expect(page.getByText('Usuario Identity')).toHaveCount(0);

  await page.getByRole('group', { name: 'A qué llega en Rol' }).getByRole('button', { name: /Operations/ }).click();
  await expect(page.getByLabel('Elegido en Rol: Operations')).toBeVisible();

  await page.getByRole('button', { name: 'Ver detalle de Grace Hopper' }).click();
  const dialog = page.getByRole('dialog', { name: 'Grace Hopper' });
  await expect(dialog.getByText('Cuenta PAM', { exact: true })).toBeVisible();
  await expect(dialog.getByText('grace.hopper')).toBeVisible();
  await expect(dialog.getByText(/correo coincide exactamente 1 a 1/)).toBeVisible();
  await expect(dialog).not.toContainText('UUID');
});

test('Cadenas PAM narrows a wide column with the text filter and walks from a filtered result', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/graph');

  await page.getByRole('searchbox', { name: 'Buscar nodos de la cadena PAM' }).fill('Ada');
  await page.getByRole('option', { name: /^Ada u-8/ }).click();
  await page.getByRole('group', { name: 'A qué llega en Rol' }).getByRole('button', { name: /Operations/ }).click();

  const safeColumn = page.getByRole('region', { name: 'Columna Safe' });
  const safes = page.getByRole('group', { name: 'A qué llega en Safe' });
  await expect(safes.getByRole('button', { name: /Finance/ })).toBeVisible();
  await expect(safes.getByRole('button', { name: /Treasury/ })).toBeVisible();

  // Narrowing by text updates the list and the column total.
  await page.getByRole('searchbox', { name: 'Filtrar en Safe' }).fill('Fin');
  await expect(safes.getByRole('button', { name: /Finance/ })).toBeVisible();
  await expect(safes.getByRole('button', { name: /Treasury/ })).toHaveCount(0);
  await expect(safeColumn.getByText('A qué llega · 1')).toBeVisible();

  // Walking continues from the filtered result and the filter stays put.
  await safes.getByRole('button', { name: /Finance/ }).click();
  await expect(page.getByLabel('Elegido en Safe: Finance')).toBeVisible();
  await expect(page.getByRole('group', { name: 'A qué llega en Plataforma' }).getByRole('button', { name: /Unix/ })).toBeVisible();

  // No matches: explicit empty state, never stale rows.
  await page.getByRole('searchbox', { name: 'Filtrar en Safe' }).fill('nada');
  await expect(safeColumn.getByText('Sin coincidencias con el filtro.')).toBeVisible();
  await expect(safes.getByRole('button', { name: /Finance/ })).toHaveCount(0);
});

test('Cadenas PAM shows the canonical columns before any search', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/graph');

  await expect(page.getByRole('heading', { name: 'Buscá cualquier nodo y seguí el recorrido' })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Buscar nodos de la cadena PAM' })).toBeVisible();
  const map = page.getByRole('region', { name: 'Mapa de la cadena PAM' });
  for (const column of ['Identidad', 'Rol', 'Safe', 'Plataforma', 'PSM · Asset Access']) {
    await expect(map.getByRole('region', { name: `Columna ${column}` })).toBeVisible();
  }
  await expect(map).not.toContainText('Buscá un nodo para empezar el recorrido.');
  await expect(map.locator('.chain-card-placeholder')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Buscá cualquier nodo y seguí el recorrido' })).toHaveCount(1);
});

test('Cadenas PAM restores a shared link from the previous explorer format', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/graph?type=psm&id=5&dir=back&trail=psm%3A5%3Eplatform%3A4');

  await expect(page.getByLabel('Elegido en PSM · Asset Access: PSM-01')).toBeVisible();
  await expect(page.getByLabel('Elegido en Plataforma: Unix')).toBeVisible();
  // Walking back from the platform keeps listing who reaches it.
  await expect(page.getByRole('group', { name: 'Quién llega en Safe' }).getByRole('button', { name: /Finance/ })).toBeVisible();
  await expect(page).toHaveURL(/type=psm&id=5&trail=platform%3A4%3Epsm%3A5/);
});

test('Cadenas PAM keeps the documented Standard seat badge and filter for PAM users', async ({ page }) => {
  let chainSearchRequest = '';
  page.on('request', (request) => {
    if (request.url().includes('/api/chains/pam/search')) chainSearchRequest = request.url();
  });
  await mockAuthenticatedApp(page);
  await page.goto('/pam/graph');
  await page.getByRole('searchbox', { name: 'Buscar nodos de la cadena PAM' }).fill('Ada');
  await expect(page.getByText('Licencia Standard', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Sólo usuarios con evidencia Standard' }).check();
  await expect.poll(() => chainSearchRequest ? new URL(chainSearchRequest).searchParams.get('standard_seat') : null).toBe('reconciled');
});

test('Cadenas PAM presets focus the matching column and search persisted fields', async ({ page }) => {
  let chainSearchRequest = '';
  page.on('request', (request) => {
    if (request.url().includes('/api/chains/pam/search')) chainSearchRequest = request.url();
  });
  await mockAuthenticatedApp(page);
  await page.goto('/pam/graph');

  await expect(page.getByRole('button', { name: '¿Quién llega a este PSM?' })).toBeDisabled();
  await page.getByRole('searchbox', { name: 'Buscar nodos de la cadena PAM' }).fill('PSM');
  await page.getByRole('option', { name: /PSM-01/ }).click();
  await expect(page.getByRole('button', { name: '¿Qué alcanza este rol?' })).toBeDisabled();
  await page.getByRole('button', { name: '¿Quién llega a este PSM?' }).click();
  const platforms = page.getByRole('region', { name: 'Columna Plataforma' });
  await expect(platforms).toBeFocused();
  await expect(platforms.getByRole('group', { name: 'Quién llega en Plataforma' }).getByRole('button', { name: /Unix/ })).toBeVisible();

  await page.getByRole('button', { name: 'Usuarios PAM suspendidos con roles activos' }).click();
  await expect.poll(() => chainSearchRequest ? new URL(chainSearchRequest).searchParams.get('status') : null).toBe('suspended');
  await expect.poll(() => chainSearchRequest ? new URL(chainSearchRequest).searchParams.get('types') : null).toBe('user');
});

test('Cadenas PAM links a role to the consolidated Roles workspace', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/graph');
  await page.getByRole('searchbox', { name: 'Buscar nodos de la cadena PAM' }).fill('Operations');
  await page.getByRole('option', { name: /Operations/ }).click();
  await page.getByRole('button', { name: 'Ver detalle de Operations' }).click();
  const dialog = page.getByRole('dialog', { name: 'Operations' });
  await dialog.getByRole('button', { name: /Abrir inventario/ }).click();
  await expect(page).toHaveURL(/\/pam\/roles$/);
  await expect(page.getByRole('searchbox', { name: 'Buscar roles cyberark' })).toHaveValue('Operations');
});

for (const theme of ['dark', 'light'] as const) {
  test(`PAM platforms are a dedicated workspace separate from connectors and SIA in ${theme}`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('dshub-theme:v1', value), theme);
    await mockAuthenticatedApp(page, { largeInventory: true });
    await page.goto('/pam/platforms');

    await expect(page.getByRole('searchbox', { name: 'Buscar plataformas PAM' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Unix/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Elegir vista de plataformas$/ })).toContainText('Inventario activo');
    await expect(page.getByText('Sólo activas', { exact: true })).toHaveCount(0);
    await expect(page.locator('.pam-platform-pattern')).toHaveText('^Unix-');
    await expect(page.getByRole('button', { name: /1 conector/ })).toBeVisible();
    await expect(page.getByText('PSM-01', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Política por plataforma destino', { exact: true })).toHaveCount(0);

    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.locator('main').evaluate((element) => Promise.all(
      element.getAnimations({ subtree: true }).filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished),
    ));
    await expect(page.locator('.pam-platforms-count strong')).toHaveText('101');
    const countAccessibility = await new AxeBuilder({ page }).include('.pam-platforms-count').analyze();
    expect(countAccessibility.violations).toEqual([]);

    await page.getByRole('button', { name: 'Elegir vista de plataformas' }).click();
    await page.getByRole('option', { name: 'Política CPM' }).click();
    await expect(page.getByText('Política por plataforma destino', { exact: true })).toBeVisible();
  });
}

test('PAM platforms workspace paginates past the first page instead of silently truncating', async ({ page }) => {
  await mockAuthenticatedApp(page, { largeInventory: true });
  await page.goto('/pam/platforms');

  await expect(page.getByText('Mostrando 1 de 101')).toBeVisible();
  await page.getByRole('button', { name: /Cargar \d+ más/ }).click();
  await expect(page.getByRole('button', { name: /Windows/ })).toBeVisible();
  await expect(page.getByText('Mostrando 2 de 101')).toBeVisible();
});

test('UX-COPY-001: Plataformas and Conectores keep their reading notes behind a "?" instead of on the page', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/platforms');
  await expect(page.getByRole('heading', { name: 'Plataformas', exact: true })).toBeVisible();
  await expect(page.getByText('no una garantía de uso')).toBeHidden();
  await page.getByRole('button', { name: 'Ayuda: Cómo leer Plataformas' }).click();
  await expect(page.getByRole('note')).toContainText('no una garantía de uso');

  await page.goto('/pam/connectors');
  await expect(page.getByText('Usá “Actualizar datos” en el menú de usuario')).toBeHidden();
  await page.getByRole('button', { name: 'Ayuda: Cómo leer los conectores PSM' }).click();
  await expect(page.getByRole('note')).toContainText('Usá “Actualizar datos” en el menú de usuario');
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
  await page.getByRole('searchbox', { name: 'Buscar conectores PSM' }).fill('PSM-01');
  await page.getByRole('button', { name: 'Elegir inventario de conectores' }).click();
  await page.getByRole('option', { name: 'SIA' }).click();
  await expect(page.getByText('connector-1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Elegir inventario de conectores' }).click();
  await page.getByRole('option', { name: 'PSM', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Buscar conectores PSM' })).toHaveValue('PSM-01');
});

test('posture workspace exposes evidence and administrative status action', async ({ page }) => {
  let updateMethod = '';
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/findings/1') updateMethod = request.method();
  });
  await mockAuthenticatedApp(page);
  await page.goto('/pam/posture');

  await expect(page.getByRole('table', { name: 'Hallazgos PAM' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Actualizar reglas Custodia' })).toHaveAttribute('title', 'Volver a evaluar las reglas locales con el inventario actual');
  await expect(page.getByRole('cell', { name: 'Calidad de datos' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Completar plataforma en la fuente' })).toBeVisible();
  await page.getByRole('button', { name: /Cuenta sin plataforma informada/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Cuenta sin plataforma informada' });
  await expect(dialog).toContainText('Finance');
  await expect(dialog).toContainText('Qué observamos');
  await expect(dialog).toContainText('Qué podés hacer');
  await dialog.getByText('Evidencia técnica').click();
  await expect(dialog).toContainText('Campos observados en cyberark');
  await dialog.getByRole('button', { name: 'Estado del hallazgo' }).click();
  await page.getByRole('option', { name: 'Reconocido' }).click();
  await dialog.getByRole('button', { name: 'Guardar revisión' }).click();
  await expect.poll(() => updateMethod).toBe('PATCH');
  await expect(page.getByText('Estado del hallazgo actualizado')).toBeVisible();
});

test('internal scope is fixed to included, ignoring a stale stored preference', async ({ page }) => {
  const lastUrlFor = (fragment: string) => {
    let latest = '';
    page.on('request', (request) => {
      if (request.url().includes(fragment)) latest = request.url();
    });
    return () => latest;
  };
  const findingsUrl = lastUrlFor('/api/findings');
  const chainSearchUrl = lastUrlFor('/api/chains/pam/search');

  await page.addInitScript(() => window.localStorage.setItem('dshub.include-internal-metrics', 'false'));
  await mockAuthenticatedApp(page);
  await page.goto('/pam/posture');
  await page.getByRole('button', { name: 'Abrir menú de usuario' }).click();
  await expect(page.getByRole('switch', { name: 'Incluir internos CyberArk' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect.poll(() => findingsUrl() ? new URL(findingsUrl()).searchParams.get('include_internal') : null).toBe('true');

  await page.goto('/pam/graph');
  await expect(page.getByRole('heading', { name: 'Acceso', exact: true, level: 1 })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Buscar nodos de la cadena PAM' }).fill('Ada');
  await expect.poll(() => chainSearchUrl() ? new URL(chainSearchUrl()).searchParams.get('include_internal') : null).toBe('true');
});

test('PAM licenses stay out of their own workspace', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam');
  await expect(page.getByRole('heading', { name: 'Asientos Standard conciliados', exact: true })).toHaveCount(0);

  await page.goto('/pam/licenses');
  await expect(page).toHaveURL(/\/pam$/);
});

test('admins reach Salud and Conectores from the Servicio tabs', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/safes');

  // UX-AUD-013(c): the Safes subnav is the canonical path; the workspace
  // switcher no longer duplicates the technical catalogs.
  await page.goto('/pam/health');
  const service = page.getByRole('tablist', { name: 'Secciones de Servicio' });
  await expect(service.getByRole('tab', { name: 'Salud' })).toHaveAttribute('aria-selected', 'true');
  await service.getByRole('tab', { name: 'Conectores' }).click();
  await expect(page).toHaveURL(/\/pam\/connectors$/);
});

test('PAM system health shows component connectivity without host metrics (UX-AUD2-009)', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/health');

  await expect(page.getByRole('heading', { name: 'Salud de componentes', exact: true })).toBeVisible();
  await expect(page.getByText('PVWA', { exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', test.info().project.name.includes('light') ? 'light' : 'dark');
  const observed = page.locator('time[datetime="2026-09-10T13:00:49.000Z"]');
  await expect(observed).toHaveText('10 sept 2026, 1:00 p. m.');
  await expect(observed).toHaveAttribute('title', /^hace /);
  await expect(page.getByText('1 de 2 conectados', { exact: true })).toBeVisible();
  await expect(page.getByText('14.9.2', { exact: true })).toBeVisible();
  await expect(page.getByText(/Conteos agregados por tipo de componente/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Ayuda: Salud de componentes PAM' }).click();
  await expect(page.getByRole('note')).toContainText('Conteos agregados por tipo de componente');
  await expect(page.getByRole('note')).toContainText('no atribuye IP');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('note')).toHaveCount(0);
  // No per-instance host inventory (IP/username) column or value ever renders here.
  await expect(page.getByRole('columnheader', { name: /dirección|ip|usuario/i })).toHaveCount(0);
  await expect(page.getByText('10.0.0.5', { exact: true })).toHaveCount(0);
});

test('Access assets is no longer a destination and Inventario is its own CyberArk view', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam');

  const menu = page.getByRole('navigation', { name: 'Secciones de CyberArk', exact: true });
  await expect(menu.getByRole('link', { name: /Activos de Access/ })).toHaveCount(0);
  await expect(menu.getByRole('link', { name: /^Cobertura$/ })).toHaveCount(1);
  await expect(menu.getByRole('link', { name: /^SIA$/ })).toHaveCount(1);
});

test('an out-of-order SIA VM search response never clobbers a newer search result', async ({ page }) => {
  // AUD (follow-up on b587818): useSimpleCatalogList backs every "simple
  // catalog" workspace (SIA resources/database accounts,
  // Identity federations and PAM platforms) and only relied
  // on AbortController. This proves the added monotonic requestId guard
  // (matching use-sia.ts et al.) actually protects state updates even if a
  // stale response resolves after a newer request has already started.
  await mockAuthenticatedApp(page);
  await page.route('**/api/cmdb/sia-resources*', async (route) => {
    const requestUrl = new URL(route.request().url());
    const q = requestUrl.searchParams.get('q') || '';
    if (q === 'stale-term') {
      await new Promise((resolve) => setTimeout(resolve, 900));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rows: [{ object_id: 999, display_name: 'STALE VM', source_id: 'stale', attributes: { resource_type: 'virtual_machine', os_type: 'linux', location_type: 'cloud', discovery_engine: 'aws', scanned_on: '' } }], total: 1, limit: 100, offset: 0, search: q }),
      });
      return;
    }
    if (q === 'fresh-term') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rows: [{ object_id: 50, display_name: 'fresh-vm', source_id: 'fresh-vm', attributes: { resource_type: 'virtual_machine', os_type: 'linux', location_type: 'cloud', discovery_engine: 'aws', scanned_on: '' } }], total: 1, limit: 100, offset: 0, search: q }),
      });
      return;
    }
    await route.fallback();
  });
  await page.goto('/pam/sia/resources');
  await expect(page.getByRole('heading', { name: 'Máquinas virtuales SIA', exact: true, level: 1 })).toBeVisible();

  const searchBox = page.getByRole('searchbox', { name: 'Buscar máquinas virtuales SIA' });
  await searchBox.fill('stale-term');
  await page.waitForTimeout(350);
  await searchBox.fill('fresh-term');

  await expect(page.getByText('fresh-vm', { exact: true })).toBeVisible();
  await page.waitForTimeout(700);
  await expect(page.getByText('fresh-vm', { exact: true })).toBeVisible();
  await expect(page.getByText('STALE VM', { exact: true })).toHaveCount(0);
});

test('admins discover the unified connectors workspace from the Safes infrastructure tabs', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/safes');

  // UX-AUD-013(c): the technical catalogs live in the Safes subnav, not in
  // the workspace switcher (no duplicated destinations).
  await page.goto('/pam/connectors');
  await expect(page.getByRole('tablist', { name: 'Secciones de Servicio' }).getByRole('tab', { name: 'Conectores' })).toHaveAttribute('aria-selected', 'true');

  const menu = page.getByRole('navigation', { name: 'Secciones de CyberArk', exact: true });
  await expect(menu.getByRole('link', { name: /^Conectores PSM y SIA$/ })).toHaveCount(0);
  await expect(menu.getByRole('link', { name: /^Plataformas$/ })).toHaveCount(0);
  await expect(menu.getByRole('link', { name: /Salud PAM/ })).toHaveCount(0);
  // IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §3.2 (Fase 2): SIA
  // Resources is no longer a separate switcher destination -- it's the
  // default Recursos section inside the single SIA hub.
  await expect(menu.getByRole('link', { name: /Máquinas virtuales SIA/ })).toHaveCount(0);
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

  await expect(page.getByRole('heading', { name: 'Máquinas virtuales SIA', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByText('web-01', { exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Máquina virtual', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Tipo', exact: true })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: /^dirección$|^ip$|^fqdn$|^red$/i })).toHaveCount(0);
});

test('SIA database accounts is reachable inside the SIA hub, not a separate switcher destination', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam');

  const menu = page.getByRole('navigation', { name: 'Secciones de CyberArk', exact: true });
  // IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §3.1/§3.2: neither
  // Federaciones (Identidades' Fase 1) nor Cuentas de base de datos SIA
  // (SIA's Fase 2) are separate switcher destinations anymore -- both
  // live as tabs inside their single hub.
  await expect(menu.getByRole('link', { name: /Cuentas de base de datos SIA/ })).toHaveCount(0);
  await expect(menu.getByRole('link', { name: /Federaciones/ })).toHaveCount(0);
  await expect(menu.getByRole('link', { name: /^Identidades$/ })).toHaveCount(1);
  await expect(menu.getByRole('link', { name: /^SIA$/ })).toHaveCount(1);
});

test('SIA database accounts workspace shows platform/database without account credentials', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/sia/database-accounts');

  await expect(page.getByRole('heading', { name: 'Cuentas de base de datos SIA', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByText('app-db-account', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'MySQL', exact: true })).toBeVisible();
  await expect(page.locator('.sia-db-target').getByText('app', { exact: true })).toBeVisible();
  await expect(page.locator('.sia-db-target').getByText(':3306', { exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /^dirección$|^usuario$/i })).toHaveCount(0);
});

test('FE-AUD-006: the canvas chart keeps its Spanish accessible name and its data is reachable by keyboard', async ({ page }) => {
  await mockAuthenticatedApp(page, {
    includeSafe: true,
    dashboardWidgets: [{
      widget_id: 'scatter-a11y', title: 'Cuentas vs. miembros', kind: 'chart', measure: 'safes',
      chart: { style: 'scatter', group_by: 'safe_accounts_members' },
      filters: { workflow_status: '', classification_status: '', inventory_scope: '', data_quality_status: '', health_filter: '' },
      target_value: null, target_direction: null, period_label: null, baseline_value: null, position: 0, size: 'md', value: 0,
      chart_data: { points: [{ key: 'Finance', label: 'Finance', x: 12, y: 3, filter_value: 'Finance' }, { key: 'Ops', label: 'Ops', x: 2, y: 1, filter_value: 'Ops' }, ...Array.from({ length: 98 }, (_, index) => ({ key: `s${index}`, label: `Safe ${index}`, x: index, y: 1, filter_value: `Safe ${index}` }))] },
    }],
  });
  await page.goto('/pam');
  const chart = page.getByRole('img', { name: /Cuentas vs\. miembros\. Eje X: cuentas; eje Y: miembros\./ });
  await expect(chart).toBeVisible();
  await expect(chart).not.toHaveAttribute('aria-label', /This is a chart/);
  const summary = page.getByText('Ver datos', { exact: true });
  await summary.focus();
  await page.keyboard.press('Enter');
  const table = page.getByRole('table', { name: 'Cuentas vs. miembros' });
  await expect(table.getByRole('row', { name: /Finance.*12.*3/ })).toBeVisible();
  // Every point is reachable, not just the first 50.
  await expect(table.getByRole('row')).toHaveCount(101);
  const axe = await new AxeBuilder({ page }).include('.advanced-chart-frame').analyze();
  expect(axe.violations).toEqual([]);
  await page.getByRole('button', { name: 'Abrir Finance' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/pam\/safes/);
});

test('FE-AUD-007: a PSM with many platforms shows two and expands the rest by keyboard', async ({ page }) => {
  await mockAuthenticatedApp(page);
  const platforms = ['Unix', 'Windows', 'Oracle', 'MSSQL', 'Cloud'].map((name, index) => ({ object_id: 100 + index, display_name: name, source_id: `p-${index}` }));
  await page.route('**/api/cmdb/pam-connectors*', (route) => route.fulfill({ json: { rows: [{ object_id: 1, display_name: 'PSM-01', source_id: 'psm-01', address: '10.0.0.1', platform_count: 5, platforms }], total: 1, limit: 100, offset: 0, search: '' } }));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/pam/connectors');
  const row = page.getByRole('row', { name: /PSM-01/ });
  await expect(row.locator('.pam-platform-psms button:not(.pam-platform-psms-more)')).toHaveCount(2);
  const more = row.getByRole('button', { name: 'Mostrar 3 plataformas más de PSM-01' });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(row.locator('.pam-platform-psms button:not(.pam-platform-psms-more)')).toHaveCount(5);
  await expect(row.getByRole('button', { name: 'Mostrar menos plataformas de PSM-01' })).toHaveAttribute('aria-expanded', 'true');
  const axe = await new AxeBuilder({ page }).include('.pam-connectors-table').analyze();
  expect(axe.violations).toEqual([]);
});
