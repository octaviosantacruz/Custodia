import { closeSettings, itemAction, openSettings } from '../support/dashboard-settings';
import AxeBuilder from '@axe-core/playwright';
import { expect, mockAuthenticatedApp, test } from '../support/fixtures';

test('dashboard is modular and does not render a fixed executive chart section', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam');

  await expect(page.getByRole('region', { name: 'Mi panel de métricas' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Lectura ejecutiva' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Datos clave' })).toBeVisible();
  await expect(page.locator('.dashboard-data-strip').getByRole('button', { name: /Abrir resultados/ })).toHaveCount(3);
  // Same card standard as Netskope: topic icon + semantic tone (a gap reads as warning).
  const gapCard = page.locator('.dashboard-data-item', { hasText: 'Safes sin cuentas' });
  await expect(gapCard).toHaveClass(/tone-warning/);
  await expect(gapCard.locator('.dashboard-data-title svg')).toHaveCount(1);
  await page.getByRole('button', { name: 'Explicar Safes sin cuentas' }).click();
  await expect(page.getByRole('tooltip')).toContainText('Inventario de Safes sincronizado desde CyberArk.');
  await expect(page.getByRole('tooltip')).toContainText('Señal: Sin cuentas');
  await expect(page.getByRole('heading', { name: 'Gráficos', exact: true })).toBeVisible();
  // Shared chart-card frame (same floor height and padding as Netskope).
  const chartFrame = await page.locator('.personal-chart-card').first().evaluate((el) => { const c = getComputedStyle(el); return [c.minHeight, c.paddingTop]; });
  expect(chartFrame).toEqual(['190px', '12px']);
  await expect(page.getByRole('button', { name: 'Editar vista' })).toBeVisible();
});

test('KR1 and KR2 shortcuts expose scoped percentage coverage', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam');
  await page.locator('.dashboard-create-card').click();
  await page.getByRole('button', { name: 'Agregar dato' }).click();
  const picker = page.locator('.dashboard-widget-picker');
  await picker.getByRole('button', { name: 'Cobertura y alcance', exact: true }).click();
  await expect(picker.locator('.dashboard-widget-picker-card').filter({ hasText: 'Safes con cuentas' })).toBeVisible();
  await expect(picker.getByText('Safes activos con cuentas / total de Safes activos; mide completitud, no depuración')).toBeVisible();
  await expect(picker.locator('.dashboard-widget-picker-card').filter({ hasText: 'Safes con unidad asignada' })).toBeVisible();
  await expect(picker.locator('.dashboard-widget-picker-card').filter({ hasText: 'KR2 · Cobertura de conexiones migradas' })).toBeVisible();
  await expect(picker.getByText('Conexiones del CSV cubiertas por PAM o SIA / total de conexiones importadas')).toBeVisible();

  await picker.getByRole('button', { name: 'Cerrar selector' }).click();
  await page.getByRole('button', { name: 'Agregar dato' }).click();
  const pickerAgain = page.locator('.dashboard-widget-picker');
  await pickerAgain.getByRole('button', { name: 'Configuración', exact: true }).click();
  await expect(pickerAgain.locator('.dashboard-widget-picker-card').filter({ hasText: 'KR6 · Compliance CyberArk' })).toBeVisible();
  await expect(pickerAgain.getByText('Cuentas compliant / total de cuentas, según el último cálculo publicado')).toBeVisible();
});

test('hover preview keeps the add action visibly above the chart', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam');
  await page.getByRole('button', { name: 'Editar vista' }).click();
  await page.getByRole('button', { name: 'Agregar gráfico' }).click();
  const picker = page.locator('.dashboard-widget-picker');
  const card = picker.locator('.dashboard-widget-picker-card').filter({ hasText: 'Cuentas por tipo' });
  const add = card.getByRole('button', { name: 'Agregar Cuentas por tipo' });

  await card.hover();
  await expect(card.locator('.dashboard-widget-picker-expanded')).toBeVisible();
  expect(await card.evaluate((node) => {
    const addAction = node.querySelector('.dashboard-widget-picker-add');
    const preview = node.querySelector('.dashboard-widget-picker-expanded');
    return Number.parseInt(getComputedStyle(addAction!).zIndex || '0', 10) > Number.parseInt(getComputedStyle(preview!).zIndex || '0', 10);
  })).toBe(true);
  // Whatever the preview's height, the add action stays the topmost thing at its own position.
  expect(await card.evaluate((node) => {
    const addAction = node.querySelector('.dashboard-widget-picker-add')!;
    const box = addAction.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return Boolean(hit && addAction.contains(hit));
  })).toBe(true);
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
    size: 'sm',
    value: 0,
    buckets: [{ key: 'GLOBEX', filter_value: 'globex', count: index + 1 }],
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

test('a resized visual block keeps its span instead of being forced into the compact grid', async ({ page }) => {
  await mockAuthenticatedApp(page);
  const filters = { workflow_status: '', classification_status: '', inventory_scope: '', data_quality_status: '', health_filter: '' };
  const widgets = Array.from({ length: 6 }, (_, index) => ({
    widget_id: `sized-chart-${index}`,
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
    size: index === 0 ? 'md' : 'sm',
    value: 0,
    buckets: [{ key: 'GLOBEX', filter_value: 'globex', count: index + 1 }],
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
  for (let current = 0; current < boxes.length; current += 1) {
    for (let other = current + 1; other < boxes.length; other += 1) {
      const overlaps = boxes[current].left < boxes[other].right && boxes[current].right > boxes[other].left
        && boxes[current].top < boxes[other].bottom && boxes[current].bottom > boxes[other].top;
      expect(overlaps).toBe(false);
    }
  }
  const widths = boxes.map((box) => Math.round(box.right - box.left));
  expect(Math.max(...widths)).toBeGreaterThan(Math.min(...widths));
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

test('connection coverage widget keeps its asset filter while navigating', async ({ page }) => {
  await mockAuthenticatedApp(page, {
    dashboardWidgets: [{
      widget_id: 'connections', title: 'Cobertura de conexiones', kind: 'count', measure: 'connections', chart: null,
      filters: { workflow_status: '', classification_status: '', inventory_scope: '', data_quality_status: '', health_filter: '' },
      target_value: null, target_direction: null, period_label: null, baseline_value: null, value_format: 'count', position: null, size: 'sm', value: 12,
    }],
  });
  await page.goto('/pam');

  await page.getByRole('button', { name: /Cobertura de conexiones.*12/ }).click();
  await expect(page).toHaveURL(/\/pam\/assets$/);
  await expect(page.getByRole('searchbox', { name: 'Buscar conexiones por IP o instancia' })).toBeVisible();
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
  await panel.locator('.dashboard-create-card').click();
  await page.getByRole('button', { name: 'Agregar dato' }).click();
  await page.getByRole('button', { name: 'Crear desde cero' }).click();

  const settings = page.locator('.dashboard-settings-panel');
  await settings.getByLabel('Nombre').fill('Objetivo Q4');
  await settings.getByRole('button', { name: 'Tipo de Objetivo Q4' }).click();
  await page.getByRole('option', { name: 'Objetivo', exact: true }).click();

  // The block moves to the visual grid when it stops being a plain count; its
  // settings panel stays open on it.
  const goal = settings;
  const target = goal.getByRole('spinbutton', { name: 'Meta', exact: true });
  await target.fill('');
  await expect(target).toHaveValue('');
  await target.fill('400');
  await goal.getByRole('textbox', { name: 'Período', exact: true }).fill('Q4 2026');
  // Filters live in the block's settings panel, next to presentation and size.
  await goal.getByRole('button', { name: 'Alcance de Objetivo Q4' }).click();
  await page.getByRole('option', { name: 'Negocio', exact: true }).click();
  await expect(goal.getByRole('button', { name: 'Calidad de Objetivo Q4' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Guardar vista' }).click();
  await expect.poll(() => savedWidgets.at(-1)?.title).toBe('Objetivo Q4');
  expect(savedWidgets.at(-1)).toMatchObject({ kind: 'goal', target_value: 400, period_label: 'Q4 2026', filters: { inventory_scope: 'business', data_quality_status: '' } });
  // The PUT is observed before the editor closes; wait for it so the click
  // below cannot match the editor's own "Objetivo Q4" controls.
  await expect(page.getByRole('button', { name: 'Guardar vista' })).toHaveCount(0);
  await panel.getByRole('button', { name: /Objetivo Q4/ }).click();
  await expect(page).toHaveURL(/\/pam\/safes$/);
  await expect.poll(() => safesRequestUrl).toContain('inventory_scope=business');
  await expect.poll(() => safesRequestUrl).not.toContain('data_quality_status=clean');
});
test('AUD-A11Y-001/002: removing a metric in place is immediate and remains an unsaved edit', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam');
  await expect(page.getByRole('heading', { name: 'Datos clave' })).toBeVisible();

  await page.getByRole('button', { name: 'Editar vista' }).click();
  await expect(page.getByRole('toolbar', { name: 'Edición del tablero PAM' })).toBeVisible();

  await page.getByRole('button', { name: 'Más acciones de Safes sin cuentas' }).click();
  await page.getByRole('menuitem', { name: 'Quitar Safes sin cuentas' }).click();

  await expect(page.getByRole('alertdialog', { name: 'Quitar de la vista' })).toHaveCount(0);
  await expect(page.getByText('Cambios sin guardar', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /Quitar Safes sin cuentas/ })).toHaveCount(0);
  await expect(page.getByRole('toolbar', { name: 'Edición del tablero PAM' })).toBeVisible();
});

test('personal dashboard offers quick shortcuts before the inline custom builder', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Agregar dato' }).click();
  const picker = page.locator('.dashboard-widget-picker');
  await expect(picker.getByText('Cobertura y alcance', { exact: true })).toBeVisible();
  await expect(picker.getByText('Trabajo operativo', { exact: true })).toBeVisible();
  await expect(picker.getByText('Configuración', { exact: true })).toBeVisible();
  await picker.getByRole('button', { name: 'Cobertura y alcance', exact: true }).click();
  await picker.locator('.dashboard-widget-picker-card').filter({ hasText: 'Safes con unidad asignada' }).getByRole('button', { name: 'Agregar' }).click();
  await expect(picker).toHaveCount(0);
  await page.getByRole('button', { name: 'Guardar vista' }).click();
  await expect.poll(() => savedWidgets.at(-1)?.title).toBe('Safes con unidad asignada');
  expect(savedWidgets.at(-1)).toMatchObject({
    kind: 'count',
    measure: 'kr1_safe_bu_coverage',
  });

  // "Crear desde cero" opens the builder inline on the new block, not in a modal.
  await page.getByRole('button', { name: 'Editar vista' }).click();
  await page.getByRole('button', { name: 'Agregar dato' }).click();
  await page.getByRole('button', { name: 'Crear desde cero' }).click();
  const newItem = page.locator('.dashboard-data-strip .dashboard-edit-item').last();
  const settings = page.locator('.dashboard-settings-panel');
  await expect(settings.getByLabel('Nombre')).toBeVisible();
  await newItem.getByRole('button', { name: 'Configurar Nueva métrica' }).click();
  await expect(settings).toHaveCount(0);
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
  await panel.locator('.dashboard-create-card').click();
  await page.getByRole('button', { name: 'Agregar dato' }).click();
  await page.getByRole('button', { name: 'Crear desde cero' }).click();
  const chart = page.locator('.dashboard-settings-panel');
  await chart.getByLabel('Nombre').fill('Safes por unidad');
  await chart.getByRole('button', { name: 'Tipo de Safes por unidad' }).click();
  await page.getByRole('option', { name: 'Gráfico', exact: true }).click();

  await expect(chart.getByRole('group', { name: 'Presentación de Safes por unidad' }).getByRole('button', { name: 'Dona' })).toHaveAttribute('aria-pressed', 'true');
  await chart.getByRole('button', { name: 'Agrupar gráfico de Safes por unidad' }).click();
  await page.getByRole('option', { name: 'Por unidad', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar vista' }).click();

  await expect.poll(() => savedWidgets.at(-1)?.title).toBe('Safes por unidad');
  expect(savedWidgets.at(-1)).toMatchObject({ kind: 'chart', measure: 'safes', chart: { style: 'pie', group_by: 'business_unit' } });
  await expect(panel.locator('.personal-chart-card').last().getByRole('img', { name: 'Distribución' })).toBeVisible();
  await expect(panel.locator('.personal-chart-card').last().getByRole('button', { name: 'Finanzas', exact: true })).toBeVisible();
});
test('VIEW-008: the PAM board edits in place, persists order/size and cancels without saving', async ({ page }) => {
  const preferencePuts: Array<{ widgets: Array<{ widget_id: string; size: string }> }> = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/dashboard/preferences' && request.method() === 'PUT') {
      preferencePuts.push(request.postDataJSON() as { widgets: Array<{ widget_id: string; size: string }> });
    }
  });
  await mockAuthenticatedApp(page);
  await page.goto('/pam');
  await expect(page.getByRole('heading', { name: 'Datos clave' })).toBeVisible();

  await page.getByRole('button', { name: 'Editar vista' }).click();
  await expect(page.getByRole('toolbar', { name: 'Edición del tablero PAM' })).toBeVisible();

  const dataItems = page.locator('.dashboard-data-strip .dashboard-edit-item');
  await dataItems.first().focus();
  await dataItems.first().press('ArrowRight');
  await page.locator('.personal-dashboard-metrics .dashboard-edit-item').filter({ hasText: 'Safes por empresa' }).getByRole('button', { name: 'Configurar Safes por empresa' }).click();
  await page.getByRole('dialog', { name: 'Configurar Safes por empresa' }).getByRole('button', { name: 'Grande' }).click();
  await page.getByRole('button', { name: 'Cerrar configuración' }).click();
  await page.getByRole('button', { name: 'Guardar vista' }).click();

  await expect.poll(() => preferencePuts.length).toBe(1);
  const saved = preferencePuts[0].widgets;
  expect(saved[0].widget_id).toBe('pending-classification');
  expect(saved.find((widget) => widget.widget_id === 'safes-by-company')?.size).toBe('lg');
  await expect(page.getByRole('toolbar', { name: 'Edición del tablero PAM' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Editar vista' }).click();
  await page.locator('.dashboard-data-strip .dashboard-edit-item').first().focus();
  await page.locator('.dashboard-data-strip .dashboard-edit-item').first().press('ArrowRight');
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await page.getByRole('alertdialog', { name: 'Descartar cambios' }).getByRole('button', { name: 'Descartar cambios' }).click();
  expect(preferencePuts.length).toBe(1);
  await expect(page.locator('.dashboard-data-strip .dashboard-data-item').first()).toContainText('Pendientes de clasificar');
});

test('EDIT-PERSIST-001: the PAM board saves only with changes and survives reload and workspace changes', async ({ page }) => {
  const preferencePuts: Array<{ widgets: Array<{ widget_id: string; size: string }> }> = [];
  let stored: Array<Record<string, unknown>> | null = null;
  await mockAuthenticatedApp(page);
  await page.route('**/api/dashboard/preferences*', async (route) => {
    if (new URL(route.request().url()).pathname !== '/api/dashboard/preferences') { await route.fallback(); return; }
    if (route.request().method() === 'PUT') {
      const payload = route.request().postDataJSON() as { widgets: Array<Record<string, unknown>> };
      preferencePuts.push(payload as { widgets: Array<{ widget_id: string; size: string }> });
      stored = payload.widgets.map((widget) => ({
        ...widget,
        baseline_value: widget.kind === 'goal' ? 1 : null,
        value: widget.kind === 'chart' ? 8 : 1,
        buckets: widget.kind === 'chart' ? [{ key: 'Globex', filter_value: '3', count: 5 }] : undefined,
      }));
      await route.fulfill({ json: { widgets: stored, is_default: false } });
      return;
    }
    if (stored) { await route.fulfill({ json: { widgets: stored, is_default: false } }); return; }
    await route.fallback();
  });
  await page.goto('/pam');
  await expect(page.getByRole('heading', { name: 'Datos clave' })).toBeVisible();

  await page.getByRole('button', { name: 'Editar vista' }).click();
  const saveButton = page.getByRole('button', { name: 'Guardar vista' });
  await expect(saveButton).toBeDisabled();
  const firstData = page.locator('.dashboard-data-strip .dashboard-edit-item').first();
  await firstData.focus();
  await firstData.press('ArrowRight');
  await expect(saveButton).toBeEnabled();

  await page.evaluate(() => { (window as unknown as { __dshubSaveMarker?: string }).__dshubSaveMarker = 'kept'; });
  await saveButton.click();
  await expect.poll(() => preferencePuts.length).toBe(1);
  await expect(page.getByRole('toolbar', { name: 'Edición del tablero PAM' })).toHaveCount(0);
  expect(preferencePuts[0].widgets[0].widget_id).toBe('pending-classification');
  // Saving never reloads the document; the marker set before saving survives.
  expect(await page.evaluate(() => (window as unknown as { __dshubSaveMarker?: string }).__dshubSaveMarker)).toBe('kept');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Datos clave' })).toBeVisible();
  await expect(page.locator('.dashboard-data-strip .dashboard-data-item').first()).toContainText('Pendientes de clasificar');

  await page.goto('/pam/safes');
  await page.goto('/pam');
  await expect(page.locator('.dashboard-data-strip .dashboard-data-item').first()).toContainText('Pendientes de clasificar');

  await page.getByRole('button', { name: 'Editar vista' }).click();
  await expect(page.getByRole('button', { name: 'Guardar vista' })).toBeDisabled();
});

test('VIEW-008: adding a chart from the board uses the category picker and persists with the view', async ({ page }) => {
  const preferencePuts: Array<{ widgets: Array<{ title: string; kind: string }> }> = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/dashboard/preferences' && request.method() === 'PUT') {
      preferencePuts.push(request.postDataJSON() as { widgets: Array<{ title: string; kind: string }> });
    }
  });
  await mockAuthenticatedApp(page);
  await page.goto('/pam');
  await expect(page.getByRole('heading', { name: 'Datos clave' })).toBeVisible();

  await page.getByRole('button', { name: 'Editar vista' }).click();
  await page.getByRole('button', { name: 'Agregar gráfico' }).click();
  const picker = page.locator('.dashboard-widget-picker');
  await expect(picker.getByRole('heading', { name: 'Elegí un gráfico para tu tablero' })).toBeVisible();
  await expect(picker.getByText('Cobertura y alcance', { exact: true })).toBeVisible();

  // Charts that need a source the product does not have yet stay visible,
  // disabled, with the reason as tooltip instead of disappearing.
  await picker.getByRole('button', { name: 'Requieren más datos', exact: true }).click();
  const unavailable = picker.locator('.dashboard-widget-picker-card').filter({ hasText: 'Mapa geográfico' });
  await expect(unavailable).toHaveAttribute('aria-disabled', 'true');
  await expect(unavailable).toHaveAttribute('title', 'Requiere país, región o coordenadas verificadas en el inventario.');
  await expect(unavailable.getByText('Requiere más datos')).toBeVisible();
  await picker.getByRole('button', { name: 'Requieren más datos', exact: true }).click();

  await picker.locator('.dashboard-widget-picker-card').filter({ hasText: 'Cuentas por tipo' }).getByRole('button', { name: 'Agregar' }).click();
  await expect(picker).toHaveCount(0);

  await page.getByRole('button', { name: 'Guardar vista' }).click();
  await expect.poll(() => preferencePuts.length).toBe(1);
  expect(preferencePuts[0].widgets.filter((widget) => widget.title === 'Cuentas por tipo' && widget.kind === 'chart')).toHaveLength(1);
});

test('VIEW-005: the inline preview warns when active filters leave the block at 0', async ({ page }) => {
  await mockAuthenticatedApp(page);
  // Same evaluation the board uses: this fixture widget ("Safes sin cuentas",
  // health_filter=no_accounts) resolves to 0 with the filter applied and to
  // the board's unfiltered value without it.
  await page.route('**/api/dashboard/preferences/preview?**', async (route) => {
    const payload = route.request().postDataJSON() as { widgets: Array<Record<string, unknown>> };
    await route.fulfill({ json: { widgets: payload.widgets.map((widget) => ({
      ...widget,
      value: Object.values(widget.filters as Record<string, string>).some(Boolean) ? 0 : 51,
    })) } });
  });
  await page.goto('/pam');
  await expect(page.locator('.dashboard-data-strip .dashboard-data-item').filter({ hasText: 'Safes sin cuentas' })).toContainText('51');

  await page.getByRole('button', { name: 'Editar vista' }).click();
  const item = page.locator('.dashboard-data-strip .dashboard-edit-item').filter({ hasText: 'Safes sin cuentas' });
  await item.getByRole('button', { name: 'Configurar Safes sin cuentas' }).click();
  const settings = page.getByRole('dialog', { name: 'Configurar Safes sin cuentas' });
  const preview = settings.locator('.dashboard-widget-preview');
  const warning = settings.locator('.dashboard-widget-preview-warning');
  await expect(preview.locator('strong')).toHaveText('0');
  await expect(warning).toContainText('Ningún dato cumple los filtros aplicados: el bloque quedaría en 0');

  // Clearing the toolbar filter widens the block again: the same evaluation
  // endpoint returns the value the board shows and the warning goes away.
  await settings.getByRole('button', { name: 'Señal técnica de Safes sin cuentas' }).click();
  await page.getByRole('option', { name: 'No filtrar', exact: true }).click();
  await expect(preview.locator('strong')).toHaveText('51');
  await expect(warning).toHaveCount(0);
});

test('VIEW-003: a preset replaces the saved view only after confirmation and can be undone', async ({ page }) => {
  const preferencePuts: Array<{ widgets: Array<{ title: string; kind: string }> }> = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/dashboard/preferences' && request.method() === 'PUT') {
      preferencePuts.push(request.postDataJSON() as { widgets: Array<{ title: string; kind: string }> });
    }
  });
  await mockAuthenticatedApp(page);
  await page.goto('/pam');
  await expect(page.getByRole('heading', { name: 'Datos clave' })).toBeVisible();

  // The Manager preset is staged in a dialog: the saved view stays untouched
  // until the operator confirms.
  await page.getByRole('button', { name: 'Vistas iniciales' }).click();
  // The menu must open inside the viewport (the PAM toolbar sat left while the menu anchors right, clipping it).
  const presetBox = await page.getByRole('menu', { name: 'Vistas iniciales' }).boundingBox();
  expect(presetBox?.x ?? -1).toBeGreaterThanOrEqual(0);
  await page.getByRole('menuitem', { name: /^Manager/ }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Aplicar vista "Manager"' });
  await expect(dialog).toBeVisible();
  expect(preferencePuts).toHaveLength(0);
  await expect(page.locator('.dashboard-data-strip')).toContainText('Safes sin cuentas');
  await dialog.getByRole('button', { name: 'Aplicar vista' }).click();
  await expect.poll(() => preferencePuts.length).toBe(1);
  expect(preferencePuts[0].widgets.map((widget) => widget.title)).toEqual([
    'KR1 · Safes con cuentas', 'Safes con unidad asignada', 'KR2 · Cobertura de conexiones migradas',
    'Safes por empresa', 'Cuentas por empresa',
  ]);

  // Undo restores the previous saved view without another confirmation.
  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect.poll(() => preferencePuts.length).toBe(2);
  expect(preferencePuts[1].widgets.map((widget) => widget.title)).toContain('Safes sin cuentas');

  // Reset asks again and lands on the source factory defaults.
  await page.getByRole('button', { name: 'Vistas iniciales' }).click();
  await page.getByRole('menuitem', { name: /^Restablecer a predeterminada/ }).click();
  const resetDialog = page.getByRole('alertdialog', { name: 'Restablecer a predeterminada' });
  await expect(resetDialog).toBeVisible();
  expect(preferencePuts).toHaveLength(2);
  await resetDialog.getByRole('button', { name: 'Restablecer' }).click();
  await expect.poll(() => preferencePuts.length).toBe(3);
  expect(preferencePuts[2].widgets.map((widget) => widget.title)).toEqual(['Safes por empresa', 'Cuentas por empresa', 'Estado del trabajo sobre los Safes']);

  // "Vaciar vista" asks first, then saves an empty view.
  await page.getByRole('button', { name: 'Vistas iniciales' }).click();
  await page.getByRole('menuitem', { name: /^Vaciar vista/ }).click();
  const clearDialog = page.getByRole('alertdialog', { name: 'Vaciar vista' });
  await expect(clearDialog).toBeVisible();
  expect(preferencePuts).toHaveLength(3);
  await clearDialog.getByRole('button', { name: 'Vaciar' }).click();
  await expect.poll(() => preferencePuts.length).toBe(4);
  expect(preferencePuts[3].widgets).toEqual([]);
});

test('VIEW-004: a pending inventory widget shows its state, run date and warning tone', async ({ page }) => {
  const filters = { workflow_status: '', classification_status: '', inventory_scope: '', data_quality_status: '', health_filter: '' };
  await mockAuthenticatedApp(page, { dashboardWidgets: [
    { widget_id: 'pending-safes', title: 'Safes pendientes', kind: 'count', measure: 'safes', chart: null, filters, target_value: null, target_direction: null, period_label: null, baseline_value: null, value_format: 'count', position: null, size: 'sm', value: 465, data_status: 'pending', measured_at: '2026-09-20T10:00:00+00:00' },
    { widget_id: 'fresh-safes', title: 'Safes confirmados', kind: 'count', measure: 'safes', chart: null, filters, target_value: null, target_direction: null, period_label: null, baseline_value: null, value_format: 'count', position: null, size: 'sm', value: 465, data_status: 'available', measured_at: '2026-09-26T10:00:00+00:00' },
  ] });
  await page.goto('/pam');
  const pending = page.locator('.dashboard-data-strip .dashboard-data-item').filter({ hasText: 'Safes pendientes' });
  const fresh = page.locator('.dashboard-data-strip .dashboard-data-item').filter({ hasText: 'Safes confirmados' });
  await expect(pending).toHaveAttribute('data-status', 'pending');
  await expect(pending.locator('small')).toContainText('Pendiente: corrida del');
  await expect(fresh).toHaveAttribute('data-status', 'available');
  await expect(fresh.locator('small')).not.toContainText('Pendiente');
  // Pending is not just text: the detail line takes the warning tone.
  const pendingColor = await pending.locator('small').evaluate((node) => getComputedStyle(node).color);
  const freshColor = await fresh.locator('small').evaluate((node) => getComputedStyle(node).color);
  expect(pendingColor).not.toBe(freshColor);
});

test('PAM board: the block menu holds duplicate, move and remove, and switching donut/bars keeps what the chart groups by', async ({ page }) => {
  const preferencePuts: Array<{ widgets: Array<{ widget_id: string; title: string; chart: { style: string; group_by: string } | null }> }> = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/dashboard/preferences' && request.method() === 'PUT') preferencePuts.push(request.postDataJSON() as (typeof preferencePuts)[number]);
  });
  await mockAuthenticatedApp(page);
  await page.goto('/pam');
  await page.getByRole('button', { name: 'Editar vista' }).click();

  const status = page.locator('.personal-dashboard-metrics .dashboard-edit-item').filter({ hasText: 'Safes por empresa' }).first();
  const settings = await openSettings(status);
  const presentation = settings.getByRole('group', { name: 'Presentación de Safes por empresa' });
  await expect(presentation.getByRole('button', { name: 'Dona' })).toHaveAttribute('aria-pressed', 'true');
  await presentation.getByRole('button', { name: 'Barras' }).click();
  await expect(presentation.getByRole('button', { name: 'Barras' })).toHaveAttribute('aria-pressed', 'true');
  await closeSettings(page);

  await itemAction(page, 'Safes por empresa', 'Duplicar');
  await expect(page.locator('.personal-dashboard-metrics .dashboard-edit-item').filter({ hasText: 'Safes por empresa · copia' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Guardar vista' }).click();
  await expect.poll(() => preferencePuts.length).toBe(1);
  const company = preferencePuts[0].widgets.find((widget) => widget.title === 'Safes por empresa');
  expect(company?.chart).toEqual({ style: 'bars', group_by: 'business_unit' });
  expect(preferencePuts[0].widgets.some((widget) => widget.title === 'Safes por empresa · copia')).toBe(true);
});

test('DASH-GRID-001: PAM and Netskope place charts of the same size in the same shared grid cells, while editing and after saving', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1200 });
  const sizes = ['md', 'sm', 'lg'] as const;
  // Column offset and width inside the grid, plus whether the card starts below the first row.
  const cells = (selector: string) => page.locator(selector).evaluateAll((elements) => {
    const boxes = elements.map((element) => ({ box: element.getBoundingClientRect(), grid: element.closest('.personal-dashboard-metrics')!.getBoundingClientRect() }));
    const firstRow = Math.min(...boxes.map(({ box }) => box.top));
    return boxes.map(({ box, grid }) => ({ left: Math.round(box.left - grid.left), lowerRow: box.top - firstRow > 2, width: Math.round(box.width) }));
  });

  await mockAuthenticatedApp(page, {
    permissions: ['inventory:read', 'netskope:read'],
    netskopeMetrics: { devices_total: 10, users_total: 10, devices_by_os: [{ key: 'Windows', count: 7 }, { key: 'Mac', count: 3 }], devices_by_company: [{ key: 'Acme', count: 6 }, { key: 'GLOBEX', count: 4 }], users_by_company: [{ key: 'Acme', count: 6 }, { key: 'GLOBEX', count: 4 }] },
  });
  await page.route('**/api/dashboard/netskope/preferences', (route) => route.fulfill({ json: {
    widgets: ['devices_by_os', 'devices_by_company', 'users_by_company'].map((id, index) => ({ id, size: sizes[index], filters: {} })), is_default: false,
  } }));
  await page.goto('/netskope');
  await expect(page.locator('.dashboard-visual-section .personal-chart-card')).toHaveCount(3);
  const netskope = await cells('.dashboard-visual-section .personal-chart-card');
  await page.getByRole('button', { name: 'Editar vista' }).click();
  await expect(page.locator('.dashboard-visual-section .dashboard-edit-item')).toHaveCount(3);
  expect(await cells('.dashboard-visual-section .dashboard-edit-item')).toEqual(netskope);

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await mockAuthenticatedApp(page, { includeSafe: true, dashboardWidgets: sizes.map((size, index) => ({
    widget_id: `chart-${index}`, title: `Gráfico ${index}`, kind: 'chart', measure: 'safes', chart: { style: 'pie', group_by: 'business_unit' },
    filters: { workflow_status: '', classification_status: '', inventory_scope: '', data_quality_status: '', health_filter: '' },
    target_value: null, target_direction: null, period_label: null, baseline_value: null, position: null, size, value: 0,
    buckets: [{ key: 'GLOBEX', count: 3 }, { key: 'Acme', count: 1 }],
  })) });
  await page.goto('/pam');
  await expect(page.locator('.dashboard-visual-section .personal-chart-card')).toHaveCount(3);
  expect(await cells('.dashboard-visual-section .personal-chart-card')).toEqual(netskope);
  // Wide (2 zones) and small (1 zone) share the first row; large covers 2×2 below.
  expect(netskope.map((cell) => cell.lowerRow)).toEqual([false, false, true]);
  expect(netskope[0].width).toBeGreaterThan(netskope[1].width * 1.9);
  expect(netskope[2].width).toBe(netskope[0].width);
});
