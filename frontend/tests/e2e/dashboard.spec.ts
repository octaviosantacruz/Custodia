import AxeBuilder from '@axe-core/playwright';
import { expect, mockAuthenticatedApp, test } from './fixtures';

test('dashboard is modular and does not render a fixed executive chart section', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam');

  await expect(page.getByRole('region', { name: 'Mi panel de métricas' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Lectura ejecutiva' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Datos clave' })).toBeVisible();
  await expect(page.locator('.dashboard-data-strip').getByRole('button', { name: /Abrir resultados/ })).toHaveCount(3);
  await page.getByRole('button', { name: 'Explicar Safes sin cuentas' }).click();
  await expect(page.getByRole('tooltip')).toContainText('Inventario de Safes sincronizado desde CyberArk.');
  await expect(page.getByRole('tooltip')).toContainText('Señal: Sin cuentas');
  await expect(page.getByRole('heading', { name: 'Gráficos y objetivos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Editar vista' })).toBeVisible();
});

test('dashboard renders every visual block without stacking them when the compact grid is full', async ({ page }) => {
  await mockAuthenticatedApp(page);
  const filters = { workflow_status: '', classification_status: '', inventory_scope: '', data_quality_status: '', health_filter: '' };
  const widgets = Array.from({ length: 6 }, (_, index) => ({
    widget_id: `wide-chart-${index}`,
    title: `Gráfico ${index + 1}`,
    kind: 'chart',
    measure: 'safes',
    chart: { style: 'bars', group_by: 'business_unit' },
    filters,
    target_value: null,
    target_direction: null,
    period_label: null,
    baseline_value: null,
    value_format: 'count',
    position: index,
    size: 'md',
    value: 0,
    buckets: [{ key: 'UENO', filter_value: 'ueno', count: index + 1 }],
  }));
  await page.route('**/api/**', async (route) => {
    if (new URL(route.request().url()).pathname === '/api/dashboard/preferences') {
      await route.fulfill({ json: { widgets, is_default: false } });
      return;
    }
    await route.fallback();
  });
  await page.goto('/pam');

  const cards = page.locator('.personal-chart-card');
  await expect(cards).toHaveCount(6);
  const boxes = await cards.evaluateAll((nodes) => nodes.map((node) => {
    const { bottom, left, right, top } = node.getBoundingClientRect();
    return { bottom, left, right, top };
  }));
  expect(new Set(boxes.map((box) => Math.round(box.left))).size).toBe(3);
  expect(new Set(boxes.map((box) => Math.round(box.top))).size).toBe(2);
  for (let current = 0; current < boxes.length; current += 1) {
    for (let other = current + 1; other < boxes.length; other += 1) {
      const overlaps = boxes[current].left < boxes[other].right && boxes[current].right > boxes[other].left
        && boxes[current].top < boxes[other].bottom && boxes[current].bottom > boxes[other].top;
      expect(overlaps).toBe(false);
    }
  }
});

test('search refreshes only filtered dashboard resources after initial load', async ({ page }) => {
  const counts = new Map<string, number>();
  await mockAuthenticatedApp(page, { onRequest: (pathname) => counts.set(pathname, (counts.get(pathname) || 0) + 1) });
  await page.goto('/pam/safes');
  await expect(page.getByRole('heading', { name: 'Safes', exact: true })).toBeVisible();
  await expect.poll(() => counts.get('/api/safes') || 0).toBe(1);
  counts.clear();

  await page.locator('input[placeholder="Buscar por nombre o Safe URL ID"]:visible').fill('root');
  await expect.poll(() => counts.get('/api/safes') || 0).toBe(1);
  expect(counts.get('/api/analytics')).toBe(1);
  expect(counts.get('/api/summary') || 0).toBe(0);
  expect(counts.get('/api/catalogs') || 0).toBe(0);
  expect(counts.get('/api/cmdb/coverage') || 0).toBe(0);
});

test('personal dashboard creates a custom quarter goal and opens its combined filters', async ({ page }) => {
  let savedWidgets: Array<{ title: string; kind: string; filters: Record<string, string>; target_value: number; period_label: string }> = [];
  let safesRequestUrl = '';
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/dashboard/preferences' && request.method() === 'PUT') savedWidgets = (request.postDataJSON() as { widgets: typeof savedWidgets }).widgets;
    if (url.pathname === '/api/safes') safesRequestUrl = request.url();
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'], includeSafe: true });
  await page.goto('/pam');

  const panel = page.getByRole('region', { name: 'Mi panel de métricas' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Safes por empresa', { exact: true })).toBeVisible();
  await expect(page.getByText('Postura priorizada')).toHaveCount(0);
  await expect(page.getByText('Cadena PAM', { exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Editar vista' }).click();
  const dialog = page.getByRole('dialog', { name: /Editar vista|Crear métrica|Construí tu panel/ });
  await dialog.getByRole('button', { name: 'Nueva métrica' }).first().click();
  const title = dialog.getByLabel('Nombre').last();
  await title.fill('Objetivo Q4');
  await dialog.getByRole('button', { name: /Visualización/ }).click();
  await dialog.getByRole('button', { name: 'Tipo de Objetivo Q4' }).click();
  await page.getByRole('option', { name: 'Objetivo', exact: true }).click();
  const target = dialog.getByRole('spinbutton', { name: 'Meta', exact: true }).last();
  await target.fill('');
  await expect(target).toHaveValue('');
  await target.fill('400');
  await dialog.getByRole('textbox', { name: 'Período', exact: true }).last().fill('Q4 2026');
  await dialog.getByRole('button', { name: /Filtros y vista previa/ }).click();
  await dialog.getByText('Acotar (opcional)').last().click();
  await dialog.getByRole('button', { name: 'Alcance de Objetivo Q4' }).click();
  await page.getByRole('option', { name: 'Negocio', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Calidad de Objetivo Q4' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Guardar métrica' }).click();
  await expect.poll(() => savedWidgets.at(-1)?.title).toBe('Objetivo Q4');
  expect(savedWidgets.at(-1)).toMatchObject({ kind: 'goal', target_value: 400, period_label: 'Q4 2026', filters: { inventory_scope: 'business', data_quality_status: '' } });
  await panel.getByRole('button', { name: /Objetivo Q4/ }).click();
  await expect(page).toHaveURL(/\/pam\/safes$/);
  await expect.poll(() => safesRequestUrl).toContain('inventory_scope=business');
  await expect.poll(() => safesRequestUrl).not.toContain('data_quality_status=clean');
});

test('AUD-A11Y-001/002: deleting a metric from within the editor closes only the confirm dialog on Escape, not the whole editor', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam');

  // Unlike user-admin.tsx (where the confirm dialog is a JSX sibling of its
  // drawer), dashboard-customizer.tsx nests the delete-metric ConfirmDialog
  // *inside* the manage-view drawer's own DOM subtree -- so Escape here
  // must not bubble past the confirm dialog into the drawer's own
  // Escape-to-close handler.
  await page.getByRole('button', { name: 'Editar vista' }).click();
  const editor = page.getByRole('dialog', { name: 'Editar vista' });
  await expect(editor).toBeVisible();

  const deleteTrigger = editor.getByRole('button', { name: 'Eliminar Safes sin cuentas' });
  await deleteTrigger.click();

  const confirmDialog = page.getByRole('alertdialog', { name: 'Eliminar métrica' });
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog.getByRole('button', { name: 'Cerrar' })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(confirmDialog).toBeHidden();
  await expect(editor).toBeVisible();
  await expect(deleteTrigger).toBeFocused();
});

test('personal dashboard offers quick shortcuts before the advanced builder', async ({ page }) => {
  let savedWidgets: Array<{ title: string; kind: string; measure: string; filters: Record<string, string> }> = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/dashboard/preferences' && request.method() === 'PUT') {
      savedWidgets = (request.postDataJSON() as { widgets: typeof savedWidgets }).widgets;
    }
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'], includeSafe: true });
  await page.goto('/pam');

  const panel = page.getByRole('region', { name: 'Mi panel de métricas' });
  await panel.locator('.dashboard-create-card').click();
  const dialog = page.getByRole('dialog', { name: 'Elegí una vista' });
  await expect(dialog.getByRole('heading', { name: 'Empezá con una vista lista' })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: /Datos/ })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('button', { name: 'Crear vista rápida: Safes por empresa' })).toHaveCount(0);
  await expect(dialog.getByText('Cobertura y alcance', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Trabajo operativo', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Configuración', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Crear vista rápida: Cobertura PAM + SIA' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Crear vista rápida: Safes sin cuentas' })).toBeVisible();
  const configured = dialog.locator('.dashboard-manager-list');
  await expect(dialog.getByText('Datos configurados', { exact: true })).toBeVisible();
  await expect(configured.getByText('Safes sin cuentas', { exact: true })).toBeVisible();
  await expect(configured.getByText('Safes por empresa', { exact: true })).toHaveCount(0);

  await dialog.getByRole('tab', { name: /Gráficos/ }).click();
  await expect(dialog.getByRole('button', { name: 'Crear vista rápida: Safes por empresa' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Crear vista rápida: Evolución del inventario' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Crear vista rápida: Estado por empresa' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Crear vista rápida: Decisiones pendientes' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Crear vista rápida: Cuentas vs. miembros' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Crear vista rápida: Safes y cuentas por empresa' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Mapa geográfico/ })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Crear vista rápida: Safes sin cuentas' })).toHaveCount(0);
  await expect(dialog.getByText('Gráficos configurados', { exact: true })).toBeVisible();
  await expect(configured.getByText('Safes por empresa', { exact: true })).toBeVisible();
  await expect(configured.getByText('Safes sin cuentas', { exact: true })).toHaveCount(0);
  await dialog.getByRole('tab', { name: /Datos/ }).click();

  await dialog.getByRole('button', { name: 'Crear vista rápida: Safes sin cuentas' }).click();
  await expect.poll(() => savedWidgets.at(-1)?.title).toBe('Safes sin cuentas');
  expect(savedWidgets.at(-1)).toMatchObject({
    kind: 'count',
    measure: 'safes',
    filters: { health_filter: 'no_accounts' },
  });
});

test('personal dashboard builds a pie chart grouped by a dimension', async ({ page }) => {
  let savedWidgets: Array<{ title: string; kind: string; measure: string; chart: { style: string; group_by: string } | null }> = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/dashboard/preferences' && request.method() === 'PUT') savedWidgets = (request.postDataJSON() as { widgets: typeof savedWidgets }).widgets;
  });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'], includeSafe: true });
  await page.goto('/pam');

  const panel = page.getByRole('region', { name: 'Mi panel de métricas' });
  await panel.getByRole('button', { name: 'Editar vista' }).click();
  const dialog = page.getByRole('dialog', { name: /Editar vista|Crear métrica|Construí tu panel/ });
  await dialog.getByRole('button', { name: 'Nueva métrica' }).first().click();
  await dialog.getByLabel('Nombre').last().fill('Safes por unidad');
  await dialog.getByRole('button', { name: /Visualización/ }).click();
  await dialog.getByRole('button', { name: 'Tipo de Safes por unidad' }).click();
  await page.getByRole('option', { name: 'Gráfico', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Gráfico de Safes por unidad', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Agrupar gráfico de Safes por unidad' }).click();
  await page.getByRole('option', { name: 'Por unidad', exact: true }).click();
  await dialog.getByRole('button', { name: /Filtros y vista previa/ }).click();
  await dialog.getByRole('button', { name: 'Guardar métrica' }).click();

  await expect.poll(() => savedWidgets.at(-1)?.title).toBe('Safes por unidad');
  expect(savedWidgets.at(-1)).toMatchObject({ kind: 'chart', measure: 'safes', chart: { style: 'pie', group_by: 'business_unit' } });
  await expect(panel.locator('.personal-chart-card').last().getByRole('img', { name: 'Distribución' })).toBeVisible();
  await expect(panel.locator('.personal-chart-card').last().getByRole('button', { name: 'Finanzas', exact: true })).toBeVisible();
});
