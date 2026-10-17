import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDashboardShortcut, createDashboardWidget, dashboardWidgetAcceptsFilters, dashboardWidgetEmptyAfterFilters, DASHBOARD_PERCENTAGE_MEASURES,
  DASHBOARD_PRESETS, DASHBOARD_SHORTCUTS, dashboardWidgetDetail, dashboardWidgetExplanation, dashboardWidgetSignature, dashboardValueLabel, withChartStyle,
  DEFAULT_PAM_SHORTCUT_IDS, RECOMMENDED_PAM_SHORTCUT_IDS, type DashboardWidget,
} from '../../../src/cyberark/pam/lib/dashboard-metrics.ts';

const base = createDashboardWidget(0);

test('a new block counts safes in total with no filters', () => {
  assert.equal(base.kind, 'count');
  assert.equal(base.measure, 'safes');
  assert.equal(base.chart, null);
  assert.equal(dashboardWidgetDetail(base), 'Todos los Safes activos');
});

test('an account measure without filters describes the account population', () => {
  const widget: DashboardWidget = { ...base, measure: 'accounts' };
  assert.equal(dashboardWidgetDetail(widget), 'Todas las cuentas activas');
});

test('a chart block reads as "<medida> por <dimensión>" plus any filters', () => {
  const widget: DashboardWidget = {
    ...base,
    kind: 'chart',
    measure: 'accounts',
    chart: { style: 'bars', group_by: 'business_unit' },
    filters: { ...base.filters, inventory_scope: 'business' },
  };
  assert.equal(dashboardWidgetDetail(widget), 'Cuentas por unidad · Alcance: Negocio');
});

test('key data explanation identifies the source and preserves the widget filters', () => {
  const widget = createDashboardShortcut('pending-classification', 0);
  const explanation = dashboardWidgetExplanation(widget);
  assert.match(explanation.includes, /Clasificación: Pendiente/);
  assert.match(explanation.source, /CyberArk/);
  assert.match(explanation.source, /localmente en Custodia/);
  assert.match(explanation.next, /Safes/);
});

test('the shortcut catalog has no leftover "data-quality" entry and matches its known count', () => {
  assert.equal(DASHBOARD_SHORTCUTS.length, 10);
  assert.equal(DASHBOARD_SHORTCUTS.some((shortcut) => shortcut.id === ('data-quality' as never)), false);
});

test('KR1 safe-coverage shortcuts default to a percentage widget with no filters', () => {
  const kr1Coverage = createDashboardShortcut('kr1-safe-coverage', 0);
  assert.equal(kr1Coverage.measure, 'safe_account_coverage');
  assert.equal(kr1Coverage.value_format, 'percentage');
  assert.deepEqual(kr1Coverage.filters, base.filters);
  assert.equal(kr1Coverage.title, 'KR1 · Safes con cuentas');
  assert.equal(dashboardValueLabel({ value: 87.84, value_format: 'percentage' }), '87,84%');
  assert.equal(createDashboardShortcut('safe-bu-coverage', 0).measure, 'kr1_safe_bu_coverage');
  assert.match(dashboardWidgetExplanation(kr1Coverage).includes, /no representa el KR1 formal completo/);
});

test('KR2 connection-coverage shortcut explains its proxy measure', () => {
  const kr2Coverage = createDashboardShortcut('kr2-connection-coverage', 0);
  assert.equal(kr2Coverage.measure, 'kr2_connection_coverage');
  assert.equal(kr2Coverage.value_format, 'percentage');
  assert.match(dashboardWidgetExplanation(kr2Coverage).source, /proxy por conexión/);
});

test('KR6 CyberArk compliance shortcut reports "Sin datos" when unavailable and disclaims SRS rotation', () => {
  const kr6 = createDashboardShortcut('kr6-cyberark-compliance', 1);
  assert.equal(kr6.measure, 'cyberark_compliance');
  assert.equal(kr6.value_format, 'percentage');
  assert.equal(dashboardValueLabel({ value: 0, value_format: 'percentage', data_status: 'unavailable' }), 'Sin datos');
  assert.match(dashboardWidgetExplanation(kr6).source, /no mide rotación SRS/);
});

test('KR6 detail distinguishes confirmed, pending and unavailable snapshots', () => {
  const kr6 = createDashboardShortcut('kr6-cyberark-compliance', 0);
  const snapshot = { ...kr6, value: 66.67, total_accounts: 3, compliant_accounts: 2, measured_at: '2026-09-17T12:00:00+00:00' };
  assert.match(dashboardWidgetDetail({ ...snapshot, data_status: 'available' }), /^2 de 3 cuentas$/);
  assert.match(dashboardWidgetDetail({ ...snapshot, data_status: 'pending' }), /^2 de 3 cuentas · Pendiente: cálculo del /);
  assert.equal(dashboardWidgetDetail({ ...snapshot, data_status: 'unavailable' }), 'Sin cálculo publicado');
  // A pending snapshot still shows the value: it exists, the recalc is overdue.
  assert.equal(dashboardValueLabel({ value: 66.67, value_format: 'percentage', data_status: 'pending' }), '66,67%');
});

test('connections detail follows the current import freshness', () => {
  const connections = { ...createDashboardWidget(0), measure: 'connections' as const, title: 'Filas de conexiones migradas' };
  assert.match(dashboardWidgetDetail({ ...connections, data_status: 'available', measured_at: '2026-09-17T12:00:00+00:00' }), /^Última carga del /);
  assert.match(dashboardWidgetDetail({ ...connections, data_status: 'pending', measured_at: '2026-08-01T12:00:00+00:00' }), / · Pendiente de actualizar$/);
  assert.equal(dashboardWidgetDetail({ ...connections, data_status: 'unavailable' }), 'Sin carga de conexiones migradas publicada');
});

test('inventory counts and charts render their run freshness state', () => {
  const safes = { ...createDashboardWidget(0), data_status: 'available' as const, measured_at: '2026-09-26T12:00:00+00:00' };
  assert.match(dashboardWidgetDetail(safes), /^Todos los Safes activos$/);
  assert.match(dashboardWidgetDetail({ ...safes, data_status: 'pending' }), / · Pendiente: corrida del /);
  assert.equal(dashboardWidgetDetail({ ...safes, data_status: 'unavailable' }), 'Todos los Safes activos · Sin inventario sincronizado');
  const filtered = { ...safes, filters: { ...safes.filters, workflow_status: 'pending' } };
  assert.match(dashboardWidgetDetail(filtered), /^Estado: Pendiente$/);
  const chart = { ...safes, kind: 'chart' as const, chart: { style: 'pie' as const, group_by: 'business_unit' as const } };
  assert.match(dashboardWidgetDetail(chart), /^Safes por unidad$/);
  const roles = { ...safes, measure: 'pam_roles' as const, data_status: 'pending' as const };
  assert.match(dashboardWidgetDetail(roles), /^Roles PAM activos · Pendiente: corrida del /);
});

test('coverage percentage measures share the denominator detail and unavailable state', () => {
  const pamSia = createDashboardShortcut('pam-sia-coverage', 0);
  assert.equal(dashboardWidgetDetail({ ...pamSia, value: 75, data_status: 'available', covered_count: 15, total_count: 20 }), '15 de 20 conexiones migradas');
  const zsp = createDashboardShortcut('zsp-coverage', 0);
  assert.equal(dashboardWidgetDetail({ ...zsp, value: 90, data_status: 'available', covered_count: 18, total_count: 20 }), '18 de 20 conexiones migradas');
  const platform = createDashboardShortcut('account-platform-coverage', 0);
  assert.equal(dashboardWidgetDetail({ ...platform, value: 75, data_status: 'available', covered_count: 30, total_count: 40 }), '30 de 40 cuentas');
  assert.equal(dashboardWidgetDetail({ ...zsp, value: 0, data_status: 'unavailable', covered_count: 0, total_count: 0 }), 'Sin inventario disponible');
  assert.equal(dashboardValueLabel({ value: 0, value_format: 'percentage', data_status: 'unavailable' }), 'Sin datos');
});

test('classification and health-filter shortcuts seed the matching count-widget filter', () => {
  assert.deepEqual(createDashboardShortcut('pending-classification', 0).filters, { ...base.filters, classification_status: 'pending' });
  assert.deepEqual(createDashboardShortcut('without-accounts', 1).filters, { ...base.filters, health_filter: 'no_accounts' });
});

test('distribution chart shortcuts (safes/accounts by company) pick the expected style and grouping', () => {
  assert.deepEqual(createDashboardShortcut('safes-by-company', 2).chart, { style: 'pie', group_by: 'business_unit' });
  const accountsByCompany = createDashboardShortcut('accounts-by-company', 3);
  assert.equal(accountsByCompany.title, 'Cuentas por empresa');
  assert.equal(accountsByCompany.kind, 'chart');
  assert.equal(accountsByCompany.measure, 'accounts');
  assert.deepEqual(accountsByCompany.chart, { style: 'pie', group_by: 'business_unit' });
});

test('PAM/SIA coverage shortcut is registered as a percentage measure', () => {
  const coverage = createDashboardShortcut('pam-sia-coverage', 4);
  assert.equal(DASHBOARD_PERCENTAGE_MEASURES.has(coverage.measure), true);
  assert.equal(coverage.value_format, 'percentage');
  assert.equal(dashboardValueLabel({ value: 87, value_format: 'percentage' }), '87%');
});

test('trend and workflow-heatmap shortcuts pick the expected chart style and grouping', () => {
  assert.deepEqual(createDashboardShortcut('inventory-trend', 5).chart, { style: 'line', group_by: 'inventory_trend' });
  assert.deepEqual(createDashboardShortcut('workflow-heatmap', 6).chart, { style: 'heatmap', group_by: 'business_unit_workflow' });
  assert.deepEqual(createDashboardShortcut('workflow-next-action', 7).chart, { style: 'heatmap', group_by: 'workflow_next_action' });
});

test('dashboardWidgetSignature ignores filter key order and detects real differences', () => {
  const filters = { workflow_status: 'pending' as const, classification_status: '' as const, inventory_scope: '' as const, data_quality_status: '' as const, health_filter: '' as const };
  const reordered = { health_filter: '' as const, data_quality_status: '' as const, inventory_scope: '' as const, classification_status: '' as const, workflow_status: 'pending' as const };
  const baseWidget = { kind: 'count' as const, measure: 'safes' as const, chart: null };
  assert.equal(
    dashboardWidgetSignature({ ...baseWidget, filters }),
    dashboardWidgetSignature({ ...baseWidget, filters: reordered }),
  );
  assert.notEqual(
    dashboardWidgetSignature({ ...baseWidget, filters }),
    dashboardWidgetSignature({ ...baseWidget, filters: { ...filters, workflow_status: '' } }),
  );
  assert.equal(
    dashboardWidgetSignature({ kind: 'chart', measure: 'safes', filters, chart: { style: 'pie', group_by: 'business_unit' } }),
    dashboardWidgetSignature({ kind: 'chart', measure: 'safes', filters: reordered, chart: { style: 'pie', group_by: 'business_unit' } }),
  );
});

test('dashboardWidgetAcceptsFilters offers the Safe filter set for a plain Safes/accounts count', () => {
  assert.equal(dashboardWidgetAcceptsFilters({ measure: 'safes', chart: null }), true);
  assert.equal(dashboardWidgetAcceptsFilters({ measure: 'accounts', chart: null }), true);
});

test('dashboardWidgetAcceptsFilters offers filters for a basic-dimension chart but not an advanced one', () => {
  assert.equal(dashboardWidgetAcceptsFilters({ measure: 'safes', chart: { style: 'pie', group_by: 'business_unit' } }), true);
  assert.equal(dashboardWidgetAcceptsFilters({ measure: 'safes', chart: { style: 'line', group_by: 'inventory_trend' } }), false);
  assert.equal(dashboardWidgetAcceptsFilters({ measure: 'safes', chart: { style: 'heatmap', group_by: 'business_unit_workflow' } }), false);
  assert.equal(dashboardWidgetAcceptsFilters({ measure: 'safes', chart: { style: 'heatmap', group_by: 'workflow_next_action' } }), false);
  assert.equal(dashboardWidgetAcceptsFilters({ measure: 'safes', chart: { style: 'scatter', group_by: 'safe_accounts_members' } }), false);
  assert.equal(dashboardWidgetAcceptsFilters({ measure: 'safes', chart: { style: 'combo', group_by: 'business_unit_inventory' } }), false);
});

test('dashboardWidgetAcceptsFilters rejects the global cross-cut measures regardless of chart', () => {
  assert.equal(dashboardWidgetAcceptsFilters({ measure: 'kr1_safe_bu_coverage', chart: null }), false);
  assert.equal(dashboardWidgetAcceptsFilters({ measure: 'pam_users', chart: null }), false);
  assert.equal(dashboardWidgetAcceptsFilters({ measure: 'cyberark_compliance', chart: null }), false);
});

test('dashboardWidgetEmptyAfterFilters only flags a real zero caused by active filters', () => {
  const filtered: DashboardWidget = { ...base, filters: { ...base.filters, workflow_status: 'blocked' }, value: 0 };
  assert.equal(dashboardWidgetEmptyAfterFilters(filtered), true);
  assert.equal(dashboardWidgetEmptyAfterFilters({ ...filtered, value: 4 }), false, 'a non-zero result is never "emptied"');
  assert.equal(dashboardWidgetEmptyAfterFilters(base), false, 'zero with no filters is not a filter problem');
  assert.equal(dashboardWidgetEmptyAfterFilters({ ...filtered, data_status: 'unavailable' }), false, 'an unavailable source is not a filter problem');
});

test('dashboardWidgetEmptyAfterFilters flags an empty basic-dimension chart but not an advanced one', () => {
  const chart: DashboardWidget = { ...base, kind: 'chart', chart: { style: 'pie', group_by: 'business_unit' }, filters: { ...base.filters, inventory_scope: 'business' }, value: 0, buckets: [] };
  assert.equal(dashboardWidgetEmptyAfterFilters(chart), true);
  assert.equal(dashboardWidgetEmptyAfterFilters({ ...chart, buckets: [{ key: 'Finanzas', count: 3 }], value: 3 }), false);
  const advanced: DashboardWidget = { ...chart, chart: { style: 'line', group_by: 'inventory_trend' }, filters: { ...base.filters, workflow_status: 'blocked' } };
  assert.equal(dashboardWidgetEmptyAfterFilters(advanced), false, 'advanced charts reset their filters and are never filtered empty');
});

test('the recommended PAM starter board is a balanced, valid set of known shortcuts', () => {
  assert.equal(RECOMMENDED_PAM_SHORTCUT_IDS.length, 6);
  assert.equal(new Set(RECOMMENDED_PAM_SHORTCUT_IDS).size, RECOMMENDED_PAM_SHORTCUT_IDS.length);
  const shortcuts = RECOMMENDED_PAM_SHORTCUT_IDS.map((id) => DASHBOARD_SHORTCUTS.find((shortcut) => shortcut.id === id));
  assert.ok(shortcuts.every(Boolean), 'every recommended id must resolve to a real shortcut');
  const dataCount = shortcuts.filter((shortcut) => shortcut!.kind !== 'chart').length;
  assert.equal(dataCount, 3);
  assert.equal(shortcuts.length - dataCount, 3);
  RECOMMENDED_PAM_SHORTCUT_IDS.forEach((id, index) => createDashboardShortcut(id, index));
});

test('the PAM role presets are three distinct, valid shortcut sets', () => {
  assert.deepEqual(DASHBOARD_PRESETS.map((preset) => preset.id), ['manager', 'operations', 'audit']);
  const known = new Set(DASHBOARD_SHORTCUTS.map((shortcut) => shortcut.id));
  const signatures = DASHBOARD_PRESETS.map((preset) => preset.shortcutIds.join('|'));
  assert.equal(new Set(signatures).size, 3, 'each preset must be a different set');
  for (const preset of DASHBOARD_PRESETS) {
    assert.ok(preset.shortcutIds.length >= 3 && preset.shortcutIds.length <= 6, `${preset.id} stays a short starting set`);
    assert.equal(new Set(preset.shortcutIds).size, preset.shortcutIds.length, `${preset.id} has no repeated shortcut`);
    assert.ok(preset.shortcutIds.every((id) => known.has(id)), `${preset.id} only uses catalog shortcuts`);
    const widgets = preset.shortcutIds.map((id, index) => createDashboardShortcut(id, index));
    const counts = widgets.filter((widget) => widget.kind === 'count').length;
    const visuals = widgets.length - counts;
    assert.ok(counts >= 1 && visuals >= 1, `${preset.id} mixes counters and charts`);
    assert.ok(counts <= 6 && visuals <= 6, `${preset.id} stays within the 6-per-kind board limit`);
    assert.equal(new Set(widgets.map((widget) => widget.widget_id)).size, preset.shortcutIds.length);
  }
});

test('the default PAM board mirrors the backend factory default', () => {
  assert.deepEqual(DEFAULT_PAM_SHORTCUT_IDS, ['safes-by-company', 'accounts-by-company', 'status-distribution']);
  const widgets = DEFAULT_PAM_SHORTCUT_IDS.map((id, index) => createDashboardShortcut(id, index));
  assert.deepEqual(widgets.map((widget) => widget.chart?.group_by), ['business_unit', 'business_unit', 'workflow_status']);
  assert.deepEqual(widgets.map((widget) => widget.kind), ['chart', 'chart', 'chart']);
});

test('switching between donut and bars keeps what the chart groups by, and an advanced style still brings its own grouping', () => {
  const byStatus = { ...createDashboardShortcut('status-distribution', 0) };
  const asBars = withChartStyle(byStatus, 'bars');
  assert.deepEqual(asBars.chart, { style: 'bars', group_by: 'workflow_status' });
  assert.deepEqual(asBars.filters, byStatus.filters);
  assert.deepEqual(withChartStyle(asBars, 'pie').chart, { style: 'pie', group_by: 'workflow_status' });
  const company = createDashboardShortcut('accounts-by-company', 1);
  assert.equal(withChartStyle(company, 'bars').measure, 'accounts');
  assert.deepEqual(withChartStyle(company, 'bars').chart, { style: 'bars', group_by: 'business_unit' });
  const heat = withChartStyle(company, 'heatmap');
  assert.deepEqual([heat.measure, heat.chart?.group_by, heat.size], ['safes', 'business_unit_workflow', 'md']);
  assert.deepEqual(withChartStyle(heat, 'pie').chart?.group_by, 'workflow_status', 'leaving an advanced grouping falls back to the first basic one');
});

test('the inventory evolution chart is no longer offered, the board defaults and presets use donuts for companies', () => {
  assert.equal(DASHBOARD_SHORTCUTS.some((shortcut) => shortcut.id === 'inventory-trend'), false);
  assert.equal(DASHBOARD_PRESETS.some((preset) => preset.shortcutIds.includes('inventory-trend')), false);
  assert.equal(RECOMMENDED_PAM_SHORTCUT_IDS.includes('inventory-trend'), false);
  assert.equal(createDashboardShortcut('accounts-by-type', 0).chart?.style, 'pie');
  assert.equal(createDashboardShortcut('safes-by-action', 0).chart?.style, 'bars');
});
