import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type { CyberarkRiskOverview } from '../../../../src/cyberark/risk_management/lib/cyberark-risk-api';
import { expect, mockAuthenticatedApp, test } from '../../support/fixtures';

const overview: CyberarkRiskOverview = {
  source: 'cyberark_risk_management', fetched_at: '2026-10-01T12:00:00Z',
  summary: { total_findings_by_severity: { high: 1 }, entity_types: [] },
  risk_types: [{ risk_type_id: 'risk-1', name: 'Privilegio permanente', description: 'Acceso persistente observado.', severity: 'high', entity_type: 'identity', open_findings: null, status_counts: {}, updated_at: null, recommendation_types: ['reduce-access'] }],
  remediations: [
    { remediation_id: 'option-1', remediation_type: 'reduce-access', entity_type: 'identity', name: 'Revisar privilegios', text: 'Validar el acceso necesario.' },
    { remediation_id: 'option-2', remediation_type: 'unrelated', entity_type: 'identity', name: 'Opción no relacionada', text: null },
  ],
  progress: { total_onboarded_current: null, total_onboarded_through_discovery_current: 0, points: [{ date_at: '2026-10-01T00:00:00Z', total_discovered: null, total_onboarded: 0 }] },
  recommendations_status: 'catalog_options_only',
};

async function openCyberark(page: Page, isLastPage = true, options: { includeEntityNames?: boolean; entityName?: string | null; legacyResponse?: boolean; catalog?: CyberarkRiskOverview; grouped?: boolean } = {}) {
  const includeEntityNames = options.includeEntityNames === true;
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'pam:risk_read', 'findings:manage', ...(includeEntityNames ? ['pam:risk_entities_read'] : [])] });
  await page.route('**/api/cyberark-risk/**', async (route) => {
    const url = new URL(route.request().url());
    const entityName = options.entityName === null ? null : options.entityName ?? 'Privileged identity';
    // Default: the bounded full read is over its limit, so the paged fallback is what these tests cover.
    if (url.pathname.endsWith('/findings/all') && !options.grouped) return route.fulfill({ status: 422, json: { detail: 'CyberArk informó más de 2000 hallazgos; usá la lectura paginada.' } });
    await route.fulfill({ json: url.pathname.endsWith('/overview') ? options.catalog ?? overview : {
      source: overview.source, fetched_at: '2026-10-01T12:05:00Z', limit: 50, offset: Number(url.searchParams.get('offset')), is_last_page: isLastPage,
      ...(options.legacyResponse ? {} : { entity_names_visible: includeEntityNames }),
      rows: [{ finding_id: '1', risk_type_id: 'risk-1', entity_id: 'opaque-entity-1', ...(!options.legacyResponse ? { entity_name: includeEntityNames ? entityName : null } : {}), entity_type: 'identity', severity: 'high', status: 'open', first_detected_at: null, last_detected_at: null }],
    } });
  });
  await page.goto('/pam/posture');
  await page.getByRole('button', { name: 'Hallazgos', exact: true }).click();
  if (!options.grouped) await expect(page.getByRole('button', { name: options.catalog ? 'Usuario sin política de acceso asignada' : 'Privilegio permanente' })).toBeVisible();
}

test('CyberArk tables connect only matching catalog guidance and preserve unknown counts (UX-AUD2-009)', async ({ page }) => {
  const riskMethods: string[] = [];
  page.on('request', (request) => { if (request.url().includes('/api/cyberark-risk/')) riskMethods.push(request.method()); });
  await openCyberark(page);
  await page.getByRole('button', { name: 'Privilegio permanente' }).focus();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: 'Privilegio permanente' });
  await expect(drawer).toContainText('opaque-entity-1');
  await expect(drawer).toContainText('Validar el acceso necesario.');
  await expect(drawer).not.toContainText('Opción no relacionada');
  await expect(drawer.getByRole('button', { name: 'Guardar revisión' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Tipos de riesgo (1)' }).click();
  const overviewFreshness = page.getByRole('region', { name: 'Fuente y frescura del catálogo y progreso CyberArk' });
  await expect(overviewFreshness).toBeVisible();
  await expect(overviewFreshness).toContainText('Fuente: CyberArk · Risk Management');
  await expect(overviewFreshness).toContainText('Lectura en vivo');
  await expect(overviewFreshness.locator('time')).toHaveAttribute('datetime', overview.fetched_at);
  await expect(page.locator('html')).toHaveAttribute('data-theme', test.info().project.name.includes('light') ? 'light' : 'dark');
  await expect(overviewFreshness.locator('time')).toHaveAttribute("title", /^hace /);
  const table = page.getByRole('table');
  await expect(table.getByRole('columnheader', { name: 'Hallazgos abiertos' })).toBeVisible();
  // Open findings and last update are both unknown for this type; neither becomes a zero.
  await expect(table.getByRole('row', { name: /Privilegio permanente/ }).getByRole('cell', { name: 'Sin dato', exact: true })).toHaveCount(2);
  await table.getByRole('button', { name: 'Ayuda: Opciones de remediación sugeridas', exact: true }).click();
  await expect(table).toContainText('Validar el acceso necesario.');
  await expect(table).not.toContainText('Opción no relacionada');
  await page.getByRole('button', { name: 'Resumen', exact: true }).click();
  await page.getByText('Ver valores', { exact: true }).click();
  const values = page.locator('.risk-trend-values table');
  await expect(values.getByRole('cell', { name: 'Sin dato', exact: true })).toBeVisible();
  await expect(values.getByRole('cell', { name: '0', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Actualizar lectura' }).click();
  await expect.poll(() => riskMethods.length).toBeGreaterThanOrEqual(4);
  expect(riskMethods.every((method) => method === 'GET')).toBe(true);
});

test('missing CyberArk severity aggregates render Sin datos rather than a fabricated zero', async ({ page }) => {
  const withoutCounts = { ...overview, summary: { total_findings_by_severity: {}, entity_types: [] } };
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'pam:risk_read', 'findings:manage'] });
  await page.route('**/api/cyberark-risk/**', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({ json: url.pathname.endsWith('/overview') ? withoutCounts : {
      source: overview.source, fetched_at: overview.fetched_at, limit: 50, offset: 0, is_last_page: true,
      entity_names_visible: false, rows: [],
    } });
  });
  await page.goto('/pam/posture');
  const hero = page.getByRole('region', { name: 'Resumen de riesgo CyberArk' });
  await expect(hero.locator('.risk-hero-title')).toContainText('Sin datos');
  await expect(hero).toContainText('CyberArk no informó conteos por severidad.');
  await expect(hero).toContainText('Sin tipos de entidad informados.');
  await expect(hero.locator('.risk-hero-title')).not.toContainText('0');
});

test('posture retains local detail and hides every CyberArk request without permission', async ({ page }) => {
  const reads: string[] = [];
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'], onRequest: (path) => { if (path.includes('cyberark-risk')) reads.push(path); } });
  await page.goto('/pam/posture');
  await expect(page.getByRole('columnheader', { name: 'Objeto relacionado' })).toBeVisible();
  await expect(page.getByRole('cell').filter({ hasText: 'DS Hub · Calidad de datos' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /svc-finance/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: /^Finance/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Fuente de postura' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cuenta sin plataforma informada' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Abrir Safe relacionado' })).toBeVisible();
  expect(reads).toEqual([]);
});

test('legacy findings fall back to the opaque ID and explain the missing role permission once', async ({ page }) => {
  await openCyberark(page, true, { legacyResponse: true });
  const table = page.getByRole('table', { name: 'Hallazgos PAM' });
  const riskRow = table.getByRole('row').filter({ has: page.getByRole('button', { name: 'Privilegio permanente' }) });
  await expect(riskRow.getByRole('cell').nth(1)).toContainText('opaque-entity-1');
  await expect(page.getByText('Tu rol no incluye el nombre de la entidad', { exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Privilegio permanente' }).click();
  const drawer = page.getByRole('dialog', { name: 'Privilegio permanente' });
  await expect(drawer).toContainText('opaque-entity-1');
  await expect(drawer).toContainText('Tu rol no incluye el nombre de la entidad');
});

test('authorized missing entity names are clearly distinguished from the opaque ID', async ({ page }) => {
  await openCyberark(page, true, { includeEntityNames: true, entityName: null });
  const table = page.getByRole('table', { name: 'Hallazgos PAM' });
  const riskRow = table.getByRole('row').filter({ has: page.getByRole('button', { name: 'Privilegio permanente' }) });
  await expect(riskRow.getByRole('cell').nth(1)).toContainText('Sin nombre informado');
  await expect(riskRow.getByRole('cell').nth(1)).toContainText('opaque-entity-1');
  await expect(page.getByText('Tu rol no incluye el nombre de la entidad', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Privilegio permanente' }).click();
  await expect(page.getByRole('dialog', { name: 'Privilegio permanente' })).toContainText('Sin nombre informado');
});

test('CyberArk pagination prevents skipping a pending page and handles an empty last page', async ({ page }) => {
  await openCyberark(page, false);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/cyberark-risk/findings?**', async (route) => {
    expect(new URL(route.request().url()).searchParams.get('offset')).toBe('50');
    await pending;
    await route.fulfill({ json: { source: overview.source, fetched_at: overview.fetched_at, limit: 50, offset: 50, is_last_page: true, rows: [] } });
  });
  const next = page.getByRole('button', { name: 'Página siguiente de riesgos CyberArk' });
  const previous = page.getByRole('button', { name: 'Página anterior de riesgos CyberArk' });
  await next.click();
  await expect(next).toBeDisabled();
  await expect(previous).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cuenta sin plataforma informada' })).toBeVisible();
  await expect(page.getByText('Consultando hallazgos de CyberArk…')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Privilegio permanente' })).toHaveCount(0);
  release();
  await expect(page.getByText('CyberArk no reportó hallazgos en esta página')).toBeVisible();
  await expect(previous).toBeEnabled();
  await expect(next).toBeDisabled();
});

test('one findings table preserves source semantics and applies filters and review only to DS Hub (UX-AUD2-009)', async ({ page }) => {
  const riskRequests: URL[] = [];
  let updatePath = '';
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/cyberark-risk/')) riskRequests.push(url);
    if (request.method() === 'PATCH') updatePath = url.pathname;
  });
  await openCyberark(page);
  const table = page.getByRole('table', { name: 'Hallazgos PAM' });
  await expect(page.getByRole('table')).toHaveCount(1);
  const localRow = table.getByRole('row').filter({ has: page.getByRole('button', { name: 'Cuenta sin plataforma informada' }) });
  const riskRow = table.getByRole('row').filter({ has: page.getByRole('button', { name: 'Privilegio permanente' }) });
  await expect(localRow.getByRole('cell', { name: 'Media', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', test.info().project.name.includes('light') ? 'light' : 'dark');
  await expect(localRow.locator('time[datetime="2026-08-29T00:00:00Z"]')).toHaveAttribute("title", /^hace /);
  await expect(localRow.getByRole('cell', { name: 'Abierto', exact: true })).toBeVisible();
  await expect(riskRow.getByRole('cell', { name: 'Alta', exact: true })).toBeVisible();
  await expect(riskRow.getByRole('cell', { name: 'Abierto', exact: true })).toBeVisible();
  await expect(page.getByText('Filtros DS Hub', { exact: true })).toBeVisible();
  await expect(page.getByText('Aplican sólo a DS Hub.', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Cobertura y frescura por fuente')).toContainText('Inventario local');
  await page.getByRole('button', { name: 'Ayuda: Acerca de Postura PAM' }).click();
  await expect(page.getByRole('note')).toContainText('La severidad y el estado corresponden a cada fuente');
  await page.keyboard.press('Escape');
  const filters: URL[] = [];
  await page.route('**/api/findings?**', async (route) => {
    filters.push(new URL(route.request().url()));
    await route.fulfill({ json: { rows: [], total: 0, limit: 50, offset: 0 } });
  });
  await page.getByRole('button', { name: 'Filtrar hallazgos por severidad' }).click();
  await page.getByRole('option', { name: 'Crítica', exact: true }).click();
  await expect(page.getByText('DS Hub: no hay hallazgos para estos filtros')).toBeVisible();
  await expect(riskRow).toBeVisible();
  expect(filters.at(-1)?.searchParams.get('severity')).toBe('critical');
  expect(riskRequests.every((url) => !url.searchParams.has('severity') && !url.searchParams.has('status') && !url.searchParams.has('rule_id'))).toBe(true);
  await page.unroute('**/api/findings?**');
  await page.getByRole('button', { name: 'Limpiar filtros DS Hub' }).click();
  await page.getByRole('button', { name: 'Cuenta sin plataforma informada' }).click();
  const localDrawer = page.getByRole('dialog');
  await localDrawer.getByRole('button', { name: 'Estado del hallazgo' }).click();
  await page.getByRole('option', { name: 'Reconocido' }).click();
  await localDrawer.getByRole('button', { name: 'Guardar revisión' }).click();
  await expect.poll(() => updatePath).toBe('/api/findings/1');
  await page.getByRole('button', { name: 'Privilegio permanente' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Guardar revisión' })).toHaveCount(0);
});

for (const failing of ['local', 'risk', 'catalog'] as const) {
  test(`a ${failing} error preserves findings from the other source`, async ({ page }) => {
    await openCyberark(page);
    const path = failing === 'local' ? '**/api/findings?**' : failing === 'risk' ? '**/api/cyberark-risk/findings?**' : '**/api/cyberark-risk/overview';
    await page.route(path, async (route) => {
      await route.fulfill({ status: 403, json: { detail: 'Lectura no disponible' } });
    });
    if (failing === 'local') {
      await page.getByRole('button', { name: 'Filtrar hallazgos por estado' }).click();
      await page.getByRole('option', { name: 'Reconocido' }).click();
      await expect(page.getByText('No se pudieron cargar los hallazgos DS Hub')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Privilegio permanente' })).toBeVisible();
    } else {
      await page.getByRole('button', { name: 'Actualizar lectura' }).click();
      await expect(page.getByRole('button', { name: 'Cuenta sin plataforma informada' })).toBeVisible();
      if (failing === 'risk') {
        await expect(page.getByText('No se pudieron cargar los hallazgos de CyberArk')).toBeVisible();
      } else {
        await expect(page.getByText('Catálogo y recomendaciones CyberArk no disponibles.', { exact: false })).toBeVisible();
        await page.getByRole('button', { name: 'Privilegio permanente' }).click();
        await expect(page.getByRole('dialog')).toContainText('Catálogo de recomendaciones no disponible');
      }
    }
  });
}

test('pending local findings leave CyberArk findings readable', async ({ page }) => {
  await openCyberark(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/findings?**', async (route) => {
    await pending;
    await route.fulfill({ json: { rows: [], total: 0, limit: 50, offset: 0 } });
  });
  await page.getByRole('button', { name: 'Filtrar hallazgos por estado' }).click();
  await page.getByRole('option', { name: 'Reconocido' }).click();
  await expect(page.getByText('Cargando hallazgos DS Hub…')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Privilegio permanente' })).toBeVisible();
  release();
  await expect(page.getByText('DS Hub: no hay hallazgos para estos filtros')).toBeVisible();
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
  for (const theme of ['dark', 'light']) {
    for (const includeEntityNames of [true, false]) {
      test(`posture desktop keyboard and accessibility ${viewport.width}x${viewport.height} ${theme} entity names ${includeEntityNames ? 'allowed' : 'restricted'}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await openCyberark(page, true, { includeEntityNames, entityName: 'Privileged identity' });
        await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
        const table = page.getByRole('table', { name: 'Hallazgos PAM' });
        await expect(table.getByRole('columnheader', { name: 'Hallazgo', exact: true })).toBeVisible();
        await expect(table.getByRole('columnheader', { name: 'Fuente', exact: true })).toHaveCount(0);
        await expect(page.getByRole('table')).toHaveCount(1);
        await expect(table.getByRole('cell').filter({ hasText: 'DS Hub' })).toBeVisible();
        await expect(table.getByRole('cell').filter({ hasText: 'CyberArk Risk Management' })).toBeVisible();
        if (includeEntityNames) {
          await expect(table.getByRole('cell').filter({ hasText: 'Privileged identity' })).toBeVisible();
          await expect(page.getByText('Tu rol no incluye el nombre de la entidad', { exact: true })).toHaveCount(0);
        } else {
          await expect(table.getByRole('cell').filter({ hasText: 'opaque-entity-1' })).toBeVisible();
          await expect(page.getByText('Tu rol no incluye el nombre de la entidad', { exact: true })).toHaveCount(1);
        }
        const results = await new AxeBuilder({ page }).include('.posture-surface').include('.posture-section-switch').withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(results.violations).toEqual([]);
        const fits = await table.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return bounds.left >= 0 && bounds.right <= window.innerWidth;
        });
        expect(fits).toBe(true);
        const trigger = page.getByRole('button', { name: 'Privilegio permanente' });
        await trigger.focus();
        await page.keyboard.press('Enter');
        const drawer = page.getByRole('dialog');
        await expect(drawer).toBeVisible();
        await expect(drawer).toContainText(includeEntityNames ? 'Privileged identity' : 'opaque-entity-1');
        if (!includeEntityNames) await expect(drawer).toContainText('Tu rol no incluye el nombre de la entidad');
        for (let index = 0; index < 6; index++) {
          await page.keyboard.press('Tab');
          expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
        }
        const drawerResults = await new AxeBuilder({ page }).include('.posture-finding-drawer').withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(drawerResults.violations).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(trigger).toBeFocused();
        await page.getByRole('button', { name: 'Tipos de riesgo (1)' }).click();
        const catalogResults = await new AxeBuilder({ page }).include('.posture-section-switch').include('.cyberark-risk-section').withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(catalogResults.violations).toEqual([]);
        await page.screenshot({ path: `/tmp/dshub-posture-${viewport.width}-${theme}-names-${includeEntityNames}.png`, fullPage: true });
      });
    }
  }
}


test('observed CyberArk catalog is translated and unfamiliar source text remains intact', async ({ page }) => {
  const catalog: CyberarkRiskOverview = { ...overview, risk_types: [
    { ...overview.risk_types[0], name: 'User without assigned access policy', description: 'The user does not have any active access policy assigned. This may result in unmanaged or overly broad access.', entity_type: 'USER', severity: 'CRITICAL', open_findings: 13 },
    { ...overview.risk_types[0], risk_type_id: 'risk-2', name: 'User with aged password', description: 'Provider revised this description.', entity_type: 'USER', severity: 'HIGH', open_findings: 74 },
    { ...overview.risk_types[0], risk_type_id: 'risk-3', name: 'Disabled SAML Encryption', description: null, entity_type: 'WEBAPP', severity: 'MEDIUM', open_findings: 0 },
    { ...overview.risk_types[0], risk_type_id: 'risk-new', name: 'New provider risk', description: 'New provider description.', entity_type: 'NEW_ENTITY', severity: 'NEW_SEVERITY' },
  ] };
  await openCyberark(page, true, { catalog });
  await page.getByRole('button', { name: 'Usuario sin política de acceso asignada' }).click();
  const drawer = page.getByRole('dialog', { name: 'Usuario sin política de acceso asignada' });
  await expect(drawer).toContainText('El usuario no tiene ninguna política de acceso activa asignada.');
  await drawer.getByText('Texto original de CyberArk', { exact: true }).click();
  await expect(drawer).toContainText('User without assigned access policy');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Tipos de riesgo (4)' }).click();
  const table = page.getByRole('table');
  const first = table.getByRole('row').filter({ hasText: 'Usuario sin política de acceso asignada' });
  await expect(first.getByRole('cell', { name: 'Usuario', exact: true })).toBeVisible();
  await expect(first.getByRole('cell', { name: 'Crítica', exact: true })).toBeVisible();
  await expect(first.getByRole('cell', { name: '13', exact: true })).toBeVisible();
  await first.getByRole('button', { name: 'Ayuda: Descripción y referencia', exact: true }).click();
  await expect(first).toContainText('Esto puede dar lugar a accesos sin gestionar o demasiado amplios.');
  await first.getByText('Texto original de CyberArk', { exact: true }).click();
  await expect(first).toContainText(catalog.risk_types[0].description!);
  await page.keyboard.press('Escape');
  await expect(first.getByRole('button', { name: 'Ayuda: Descripción y referencia', exact: true })).toHaveAttribute('aria-expanded', 'false');
  const revised = table.getByRole('row').filter({ hasText: 'Usuario con contraseña sin actualizar' });
  await revised.getByRole('button', { name: 'Ayuda: Descripción y referencia', exact: true }).click();
  await expect(revised).toContainText('Provider revised this description.');
  await page.keyboard.press('Escape');
  await expect(revised.getByRole('button', { name: 'Ayuda: Descripción y referencia', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(table.getByRole('cell', { name: 'Aplicación web', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: 'Media', exact: true })).toBeVisible();
  const unknown = table.getByRole('row').filter({ hasText: 'New provider risk' });
  await unknown.getByRole('button', { name: 'Ayuda: Descripción y referencia', exact: true }).click();
  await expect(unknown).toContainText('New provider description.');
  await expect(unknown).toContainText('NEW_ENTITY');
  await expect(unknown).toContainText('NEW_SEVERITY');
});

test('UX-AUD2-019: mixed finding origins and types remain readable in the finding identity', async ({ page }, testInfo) => {
  await openCyberark(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', testInfo.project.use.colorScheme === 'light' ? 'light' : 'dark');
  const table = page.getByRole('table', { name: 'Hallazgos PAM' });
  await expect(table.getByRole('columnheader', { name: /^(Fuente|Categoría \/ tipo)$/ })).toHaveCount(0);
  const local = table.getByRole('row', { name: /Cuenta sin plataforma informada/ }).getByRole('cell').first();
  await expect(local).toContainText('DS Hub');
  await expect(local).toContainText('Calidad de datos');
  const external = table.getByRole('row', { name: /Privilegio permanente/ }).getByRole('cell').first();
  await expect(external).toContainText('CyberArk');
  await expect(external).toContainText('Risk Management');
});

test('Resumen frames CyberArk totals, onboarding trend and the top risk types without inventing counts', async ({ page }) => {
  const catalog: CyberarkRiskOverview = {
    ...overview,
    summary: { total_findings_by_severity: { critical: 3, high: 7 }, entity_types: [
      { entity_type: 'user', categories: [{ category: 'Access', severity_counts: { critical: 3, high: 5 } }] },
      { entity_type: 'webapp', categories: [{ category: 'Config', severity_counts: { high: 2 } }] },
    ] },
    risk_types: [
      { ...overview.risk_types[0], risk_type_id: 'a', name: 'Dormant user account', severity: 'medium', open_findings: 40 },
      { ...overview.risk_types[0], risk_type_id: 'b', name: 'Compromised user password', severity: 'critical', open_findings: 3 },
      { ...overview.risk_types[0], risk_type_id: 'c', name: 'Enable token rotation', severity: 'high', open_findings: 0 },
      { ...overview.risk_types[0], risk_type_id: 'd', name: 'Unused App access', severity: 'high', open_findings: null },
    ],
    progress: { total_onboarded_current: 5, total_onboarded_through_discovery_current: null, points: [
      { date_at: '2026-09-30T00:00:00Z', total_discovered: 20, total_onboarded: 4 },
      { date_at: '2026-10-01T00:00:00Z', total_discovered: null, total_onboarded: 5 },
      { date_at: '2026-10-02T00:00:00Z', total_discovered: 25, total_onboarded: 5 },
    ] },
  };
  await openCyberark(page, true, { catalog, grouped: true });
  await page.getByRole('button', { name: 'Resumen', exact: true }).click();
  const hero = page.getByRole('region', { name: 'Resumen de riesgo CyberArk' });
  await expect(hero.locator('.risk-hero-title')).toContainText('10');
  await expect(hero.getByRole('list', { name: 'Hallazgos por severidad' }).getByRole('listitem')).toHaveText(['3 Crítica', '7 Alta']);
  await expect(hero.locator('.risk-entity-card').first()).toContainText('Usuarios');
  await expect(hero.locator('.risk-entity-card').first()).toContainText('Crítica · 38% (3)');
  await expect(hero.locator('.risk-entity-card').nth(1)).toContainText('Crítica · 0% (0)');
  // Unknown stays unknown; the share uses the last reported point only.
  const kpis = page.getByRole('definition').filter({ hasText: 'Sin dato' });
  await expect(kpis).toHaveCount(1);
  await expect(page.locator('.risk-hero-kpis')).toContainText('20%');
  await expect(page.getByRole('img', { name: /Cuentas descubiertas e incorporadas por fecha\. Último punto: Descubiertas: 25; Incorporadas: 5/ })).toBeVisible();
  const top = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Última actualización' }) });
  // Most severe first; a type with zero open findings is left out, an unknown count is kept.
  await expect(top.locator('tbody tr td:first-child')).toHaveText(['Contraseña de usuario comprometida', 'Acceso a aplicación sin uso', 'Cuenta de usuario inactiva']);
  await expect(top.getByRole('row', { name: /Acceso a aplicación sin uso/ })).toContainText('Sin dato');
  const results = await new AxeBuilder({ page }).include('.risk-overview').include('.posture-section-switch').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations).toEqual([]);
  await page.getByRole('button', { name: /Ver todos \(4\)/ }).click();
  await expect(page.getByRole('heading', { name: 'Tipos de riesgo evaluados' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tipos de riesgo (4)' })).toHaveAttribute('aria-pressed', 'true');
});

test('Hallazgos groups every CyberArk finding by risk type and expands each group on demand', async ({ page }) => {
  const reads: string[] = [];
  page.on('request', (request) => { const url = new URL(request.url()); if (url.pathname.startsWith('/api/cyberark-risk/')) reads.push(`${request.method()} ${url.pathname}`); });
  const catalog: CyberarkRiskOverview = { ...overview, risk_types: [
    { ...overview.risk_types[0], risk_type_id: 'risk-1', name: 'User with aged password', severity: 'high', open_findings: 99 },
    { ...overview.risk_types[0], risk_type_id: 'risk-2', name: 'Compromised user password', severity: 'critical', open_findings: 1 },
  ] };
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'pam:risk_read'] });
  const finding = (id: string, risk: string, status = 'open') => ({ finding_id: id, risk_type_id: risk, entity_id: `entity-${id}`, entity_name: null, entity_type: 'user', severity: 'high', status, first_detected_at: null, last_detected_at: `2026-10-0${id.length}T00:00:00Z` });
  await page.route('**/api/cyberark-risk/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/overview')) return route.fulfill({ json: catalog });
    if (url.pathname.endsWith('/findings/all')) return route.fulfill({ json: { source: overview.source, fetched_at: overview.fetched_at, complete: true, entity_names_visible: false,
      rows: [finding('1', 'risk-1'), finding('22', 'risk-1', 'closed'), ...Array.from({ length: 11 }, (_, index) => finding(`3${index}`, 'risk-1')), finding('4', 'risk-2')] } });
    return route.fulfill({ json: { source: overview.source, fetched_at: overview.fetched_at, limit: 50, offset: 0, is_last_page: true, entity_names_visible: false, rows: [] } });
  });
  await page.goto('/pam/posture');
  await page.getByRole('button', { name: 'Hallazgos', exact: true }).click();
  const table = page.getByRole('table', { name: 'Hallazgos PAM' });
  const groups = table.locator('.risk-group-row');
  // Critical first; counts are the findings returned, not the catalog's 99.
  await expect(groups).toHaveCount(2);
  await expect(groups.first()).toContainText('Contraseña de usuario comprometida');
  await expect(groups.nth(1)).toContainText('13 hallazgos');
  await expect(groups.nth(1)).toContainText('12 de 13 abiertos');
  await expect(page.getByLabel('Cobertura y frescura por fuente')).toContainText('14 hallazgos agrupados por tipo de riesgo');
  await expect(page.getByRole('button', { name: 'Página siguiente de riesgos CyberArk' })).toHaveCount(0);
  const toggle = groups.nth(1).getByRole('button', { name: /Usuario con contraseña sin actualizar/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(table.locator('.risk-group-child')).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(table.locator('.risk-group-child')).toHaveCount(10);
  await table.getByRole('button', { name: /Mostrar los 3 restantes/ }).click();
  await expect(table.locator('.risk-group-child')).toHaveCount(13);
  await table.getByRole('button', { name: 'Ver hallazgo 22 de Usuario con contraseña sin actualizar' }).click();
  const drawer = page.getByRole('dialog', { name: 'Usuario con contraseña sin actualizar' });
  await expect(drawer).toContainText('entity-22');
  await expect(drawer).toContainText('Tu rol no incluye el nombre de la entidad');
  await page.keyboard.press('Escape');
  const results = await new AxeBuilder({ page }).include('.posture-surface').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations).toEqual([]);
  expect(reads.every((read) => read.startsWith('GET '))).toBe(true);
  expect(reads).toContain('GET /api/cyberark-risk/findings/all');
  const view = page.getByRole('group', { name: 'Presentación de hallazgos CyberArk' });
  await view.getByRole('button', { name: 'Todos los hallazgos' }).click();
  await expect(view.getByRole('button', { name: 'Todos los hallazgos' })).toHaveAttribute('aria-pressed', 'true');
  await expect(table.locator('.risk-group-row')).toHaveCount(0);
  await expect(page.getByText('CyberArk no reportó hallazgos en esta página')).toBeVisible();
  await view.getByRole('button', { name: 'Por tipo de riesgo' }).click();
  await expect(table.locator('.risk-group-row')).toHaveCount(2);
});

test('a grouped read over its bound keeps the paged CyberArk reading and says why', async ({ page }) => {
  await openCyberark(page, false);
  await expect(page.getByLabel('Cobertura y frescura por fuente')).toContainText('La vista agrupada no está disponible para este volumen.');
  await expect(page.locator('.risk-group-row')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Página siguiente de riesgos CyberArk' })).toBeEnabled();
});

test('CA-IA-001 Postura has Riesgos and Depuración tabs and /pam/cleanup opens the second', async ({ page }) => {
  await mockAuthenticatedApp(page);
  const signal = { count: 0, denominator: 0, items: [], computed_at: '2026-10-11T00:00:00Z', inventory_runs: [] };
  await page.route('**/api/cmdb/pam-cleanup-signals', (route) => route.fulfill({ json: {
    empty_groups: signal, identical_member_groups: signal, redundant_groups_with_access_peer: signal,
    orphan_psm: signal, platforms_without_accounts: signal, safes_without_active_users: signal,
  } }));
  await page.goto('/pam/posture');
  const tabs = page.getByRole('tablist', { name: 'Secciones de Postura' });
  await expect(tabs.getByRole('tab', { name: 'Riesgos' })).toHaveAttribute('aria-selected', 'true');
  await tabs.getByRole('tab', { name: 'Depuración' }).click();
  await expect(page).toHaveURL(/\/pam\/cleanup$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Depuración', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Señales de limpieza PAM' })).toBeVisible();
  await expect(tabs.getByRole('tab', { name: 'Depuración' })).toHaveAttribute('aria-selected', 'true');
});
