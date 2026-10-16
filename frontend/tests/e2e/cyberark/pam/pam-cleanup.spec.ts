import { expectSystemSearch } from '../../support/search-control';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type { PamCleanupInventoryRun, PamCleanupSignal, PamCleanupSignalItem, PamCleanupSignalsResponse } from '../../../../src/cyberark/pam/types/pam';
import { expect, mockAuthenticatedApp, test } from '../../support/fixtures';

const ENDPOINT = '**/api/cmdb/pam-cleanup-signals';
const SEARCH = 'Buscar objeto o par en la categoría';
const CATEGORY = 'Categoría de limpieza PAM';
const COMPUTED_AT = '2026-10-01T10:11:12Z';
const INGESTED_AT = '2026-08-01T10:00:00Z';
const completedRun: PamCleanupInventoryRun = {
  run_id: 'old-pam-run', source_system: 'cyberark', source_file: 'cyberark-api', status: 'completed',
  enqueued_at: INGESTED_AT, started_at: INGESTED_AT, completed_at: INGESTED_AT, inventory_refreshed: true,
};

function item(overrides: Partial<PamCleanupSignalItem>): PamCleanupSignalItem {
  return {
    object_id: 1, display_name: 'Grupo vacío', source_id: 'group-empty',
    reason: 'Sin miembros activos observados', is_factory: false, factory_label: null,
    member_count: 0, safe_count: 0, peer_groups: [], inventory_scope: null,
    account_type_classification: null, classification_status: null, ...overrides,
  };
}

function signal(items: PamCleanupSignalItem[], denominator: number): PamCleanupSignal {
  return { count: items.length, denominator, computed_at: COMPUTED_AT, items,
    inventory_runs: [{ family: 'pam_inventory', latest_attempt: completedRun, last_completed_inventory: completedRun }] };
}

function signals(): PamCleanupSignalsResponse {
  const psmRun: PamCleanupInventoryRun = {
    ...completedRun, run_id: 'psm-catalog-run', source_file: 'cyberark-psm-api',
    enqueued_at: '2026-09-30T10:00:00Z', started_at: '2026-09-30T10:01:00Z',
    completed_at: '2026-09-30T10:02:00Z',
  };
  return {
    empty_groups: signal([
      item({ is_factory: true, factory_label: 'Grupo de fábrica' }),
      item({ object_id: 2, display_name: 'Operaciones sin miembros', source_id: 'group-ops' }),
    ], 12),
    identical_member_groups: signal([
      item({ object_id: 3, display_name: 'Grupo réplica', source_id: 'group-copy', member_count: 4, safe_count: 0,
        reason: 'Mismos miembros activos que el par observado',
        peer_groups: [{ object_id: 4, display_name: 'Operaciones principal', source_id: 'peer-access-4', safe_count: 7 }] }),
    ], 10),
    redundant_groups_with_access_peer: signal([
      item({ object_id: 3, display_name: 'Grupo réplica', source_id: 'group-copy', member_count: 4,
        reason: 'Par con acceso a Safes y mismos miembros',
        peer_groups: [{ object_id: 4, display_name: 'Operaciones principal', source_id: 'peer-access-4', safe_count: 7 }] }),
    ], 10),
    orphan_psm: { ...signal([], 0), inventory_runs: [
      { family: 'pam_inventory', latest_attempt: completedRun, last_completed_inventory: completedRun },
      { family: 'psm_catalog', latest_attempt: psmRun, last_completed_inventory: psmRun },
    ] },
    platforms_without_accounts: signal([
      item({ object_id: 5, display_name: 'Plataforma sin cuentas', source_id: 'platform-empty', member_count: null, safe_count: null,
        reason: 'Sin cuentas activas en el inventario' }),
    ], 9),
    safes_without_active_users: signal([
      item({ object_id: 6, display_name: 'Safe interno', source_id: 'safe-internal', member_count: null, safe_count: null,
        reason: 'Sin usuarios activos observados para el Safe', inventory_scope: 'internal',
        account_type_classification: 'internal', classification_status: 'review' }),
    ], 8),
  };
}

async function openCleanup(page: Page, data = signals()) {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'pam:catalogs_read', 'domain:pam'] });
  await page.route(ENDPOINT, (route) => route.fulfill({ json: data }));
  await page.goto('/pam/cleanup');
  await expect(page.getByRole('group', { name: 'Resumen de las seis categorías' })).toBeVisible();
}

async function selectCategory(page: Page, title: string) {
  await page.getByRole('button', { name: CATEGORY }).click();
  await page.getByRole('option', { name: title, exact: true }).click();
}

test('cleanup keeps six global summaries while one category and object/peer search narrow the detail locally (UX-AUD2-024 UX-AUD2-009)', async ({ page }) => {
  const requests: Array<{ method: string; path: string }> = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/')) requests.push({ method: request.method(), path });
  });
  await openCleanup(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', test.info().project.name.includes('light') ? 'light' : 'dark');
  await expect(page.locator(`time[datetime="${COMPUTED_AT}"]`).first()).toHaveAttribute("title", /^hace /);
  await expect(page.locator(`time[datetime="${INGESTED_AT}"]`).first()).toHaveAttribute("title", /^hace /);
  expect(await page.locator('main').innerText()).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
  const summary = page.getByRole('group', { name: 'Resumen de las seis categorías' });
  const expectedCounts = [
    '2 / 12 grupos activos', '1 / 10 grupos activos con miembros', '1 / 10 grupos activos con miembros',
    '0 / 0 PSM activos', '1 / 9 plataformas activas', '1 / 8 Safes activos',
  ];
  for (const [index, count] of expectedCounts.entries()) {
    await expect(summary.locator('.pam-cleanup-summary-item').nth(index)).toContainText(count);
  }
  await expect(summary.getByText(/^Cálculo:/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Ayuda: Señales de limpieza' }).click();
  await expect(page.getByRole('note')).toContainText('no suman objetos únicos');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('table')).toHaveCount(1);
  await expect(page.getByRole('table', { name: 'Grupos sin miembros: detalle y motivo' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Grupo vacío/ })).toContainText('Grupo de fábrica · no se sugiere baja automática');
  await expect(page.getByRole('row', { name: /Grupo vacío/ })).toContainText('Sin miembros activos observados');
  const initialSummary = await summary.innerText();
  const initialCleanupReads = requests.filter(({ path }) => path === '/api/cmdb/pam-cleanup-signals').length;
  const search = page.getByRole('searchbox', { name: SEARCH });
  await expectSystemSearch(search);
  await search.fill('group-ops');
  await expect(page.getByRole('row', { name: /Operaciones sin miembros/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Grupo vacío/ })).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Mostrando 1 de 2 objetos');
  await search.fill('no existe');
  await expect(page.getByText('Sin coincidencias para esta búsqueda')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Mostrando 0 de 2 objetos');
  await page.getByRole('button', { name: 'Limpiar búsqueda' }).click();
  await selectCategory(page, 'Grupos con miembros idénticos');
  const table = page.getByRole('table', { name: 'Grupos con miembros idénticos: detalle y motivo' });
  await expect(page.getByRole('table')).toHaveCount(1);
  for (const query of ['Grupo réplica', 'group-copy', 'Operaciones principal', 'peer-access-4']) {
    await search.fill(query);
    await expect(table.getByRole('row', { name: /Grupo réplica/ })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Mostrando 1 de 1 objetos');
  }
  await expect(table).toContainText('4 miembros activos');
  await expect(table).toContainText('0 Safes con acceso');
  await expect(table).toContainText('Operaciones principal · peer-access-4 · 7 Safes con acceso');
  await expect(table).toContainText('Mismos miembros activos que el par observado');
  await page.getByRole('button', { name: 'Limpiar búsqueda' }).click();
  await selectCategory(page, 'Safes sin usuarios activos');
  await expect(page.getByRole('table')).toContainText('Alcance: Interno · tipo de cuenta: internal · estado: review');
  await expect(page.getByRole('table')).toContainText('Sin usuarios activos observados para el Safe');
  await selectCategory(page, 'Plataformas sin cuentas activas');
  await expect(page.getByRole('table')).toContainText('Sin cuentas activas en el inventario');
  await selectCategory(page, 'Grupos redundantes frente a un par con acceso');
  await expect(page.getByRole('table')).toContainText('Par con acceso a Safes y mismos miembros');
  await selectCategory(page, 'PSM activos sin plataforma');
  const psmEvidence = page.getByLabel('Evidencia de ingesta de la categoría');
  await expect(psmEvidence).toContainText('Catálogo PSM · no actualiza relaciones de plataformas');
  const families = psmEvidence.locator('.pam-cleanup-ingestion');
  await expect(families).toHaveCount(2);
  await expect(families.nth(0)).toContainText('Inventario PAM y relaciones');
  await expect(families.nth(0)).toContainText('Último intento · cyberark-api: Completada');
  await expect(families.nth(1)).toContainText('Último intento · cyberark-psm-api: Completada');
  await expect(page.getByText('Sin inventario activo en esta categoría')).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Mostrando 0 de 0 objetos');
  expect(await summary.innerText()).toBe(initialSummary);
  expect(requests.filter(({ path }) => path === '/api/cmdb/pam-cleanup-signals')).toHaveLength(initialCleanupReads);
  expect(requests.filter(({ path }) => path === '/api/cmdb/pam-cleanup-signals').every(({ method }) => method === 'GET')).toBe(true);
  // Shell workspace preferences may be persisted; cleanup controls never mutate inventory or start ingestion.
  expect(requests.filter(({ method, path }) => method !== 'GET' && method !== 'HEAD' &&
    /^\/api\/(cmdb|safes|accounts|catalogs|ingestion)(\/|$)/.test(path))).toEqual([]);
});

for (const inventoryEmpty of [false, true]) {
  test(`zero cleanup signals retain all denominators and selectable categories; inventory empty ${inventoryEmpty}`, async ({ page }) => {
    const data = signals();
    for (const entry of Object.values(data)) {
      entry.count = 0;
      entry.items = [];
      if (inventoryEmpty) entry.denominator = 0;
    }
    await openCleanup(page, data);
    await expect(page.getByText(inventoryEmpty
      ? 'Sin inventario activo disponible para calcular señales'
      : 'No se encontraron señales con los datos activos disponibles')).toBeVisible();
    const summary = page.getByRole('group', { name: 'Resumen de las seis categorías' });
    await expect(summary.getByText(/^Cálculo:/)).toHaveCount(0);
    await expect(summary).toContainText(inventoryEmpty ? '0 / 0 grupos activos' : '0 / 12 grupos activos');
    await selectCategory(page, 'Plataformas sin cuentas activas');
    await expect(page.getByText(inventoryEmpty ? 'Sin inventario activo en esta categoría' : 'Sin señales para esta categoría')).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Mostrando 0 de 0 objetos');
  });
}

test('calculation date stays separate from old ingestion and a later failed attempt', async ({ page }) => {
  const data = signals();
  data.empty_groups.inventory_runs[0].latest_attempt = {
    ...completedRun, run_id: 'failed-run', status: 'failed', inventory_refreshed: false,
    started_at: '2026-09-30T10:00:00Z', completed_at: '2026-09-30T10:01:00Z',
  };
  await openCleanup(page, data);
  const evidence = page.getByLabel('Evidencia de ingesta de la categoría');
  await expect(evidence).toContainText('Último intento · cyberark-api: Fallida');
  await expect(evidence).toContainText('Última ingesta completada:');
  await expect(evidence).toContainText('1 ago 2026');
  await expect(page.locator('.pam-cleanup-signal-heading')).toContainText('1 oct 2026');
  await expect(evidence).toContainText('Recalcular no actualiza la ingesta');
});

test('zero signals without ingestion evidence disclose unavailable freshness and no inventory', async ({ page }) => {
  const data = signals();
  for (const entry of Object.values(data)) {
    entry.items = []; entry.count = 0; entry.denominator = 0;
    entry.inventory_runs = [{ family: 'pam_inventory', latest_attempt: null, last_completed_inventory: null }];
  }
  await openCleanup(page, data);
  await expect(page.getByText('Sin inventario activo disponible para calcular señales')).toBeVisible();
  await expect(page.getByLabel('Evidencia de ingesta de la categoría')).toContainText('Frescura no disponible');
  await expect(page.getByText('Sin corrida pertinente registrada')).toBeVisible();
  await expect(page.getByText('Sin inventario activo en esta categoría')).toBeVisible();
});

test('pending cleanup read and failed read retain their explicit states', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'pam:catalogs_read', 'domain:pam'] });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route(ENDPOINT, async (route) => {
    await pending;
    await route.fulfill({ status: 503, json: { detail: 'Lectura PAM no disponible' } });
  });
  await page.goto('/pam/cleanup');
  await expect(page.getByText('Calculando señales de limpieza PAM…')).toBeVisible();
  await expect(page.getByRole('searchbox', { name: SEARCH })).toHaveCount(0);
  release();
  await expect(page.getByText('No se pudieron cargar las señales de limpieza PAM')).toBeVisible();
  await expect(page.getByText('Lectura PAM no disponible')).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
  for (const theme of ['dark', 'light']) {
    test(`cleanup desktop keyboard, geometry and accessibility ${viewport.width}x${viewport.height} ${theme}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const data = signals();
      // FE-AUD-011: a populated category must overflow its actual scroll container.
      data.empty_groups = signal(Array.from({ length: 24 }, (_, index) => item({
        object_id: 100 + index, display_name: `Grupo sin miembros ${index + 1}`, source_id: `empty-group-${index + 1}`,
      })), 24);
      data.identical_member_groups.items[0].reason = 'Mismos miembros activos que el par observado. '.repeat(12);
      data.identical_member_groups.items[0].display_name = `Grupo réplica ${'x'.repeat(160)}`;
      await openCleanup(page, data);
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      const category = page.getByRole('button', { name: CATEGORY });
      await category.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('listbox', { name: CATEGORY })).toBeVisible();
      await expect(page.getByRole('option')).toHaveCount(6);
      const menuResults = await new AxeBuilder({ page }).include('.compact-select-menu')
        .withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(menuResults.violations).toEqual([]);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('table', { name: 'Grupos con miembros idénticos: detalle y motivo' })).toBeVisible();
      await expect(category).toBeFocused();
      await page.keyboard.press('Tab');
      const search = page.getByRole('searchbox', { name: SEARCH });
      await expect(search).toBeFocused();
      await page.keyboard.type('peer-access-4');
      await expect(page.getByRole('status')).toContainText('Mostrando 1 de 1 objetos');
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Limpiar búsqueda' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(search).toHaveValue('');
      const panel = page.getByRole('region', { name: 'Señales de limpieza PAM' });
      for (const element of [panel, category, search, page.getByRole('table'), page.getByRole('group', { name: 'Resumen de las seis categorías' })]) {
        expect(await element.evaluate((node) => {
          const bounds = node.getBoundingClientRect();
          return bounds.left >= 0 && bounds.right <= window.innerWidth && node.scrollWidth <= node.clientWidth;
        })).toBe(true);
      }
      await selectCategory(page, 'Grupos sin miembros');
      const scrollContainer = page.locator('.pam-cleanup-signal .compact-table-wrap');
      expect(await scrollContainer.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
      const region = page.getByRole('region', { name: 'Grupos sin miembros: detalle y motivo', exact: true });
      await search.focus();
      await page.keyboard.press('Tab');
      await expect(region).toBeFocused();
      expect(await region.evaluate((node) => {
        const style = getComputedStyle(node);
        return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
      })).toBe(true);
      const pageScroll = await page.evaluate(() => window.scrollY);
      await page.keyboard.press('PageDown');
      await expect.poll(() => region.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
      expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll);
      await page.keyboard.press('Shift+Tab');
      await expect(search).toBeFocused();
      const results = await new AxeBuilder({ page }).include('.pam-cleanup-panel')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(results.violations).toEqual([]);
      await page.screenshot({ path: `/tmp/dshub-cleanup-${viewport.width}-${theme}.png`, fullPage: true });
    });
  }
}
