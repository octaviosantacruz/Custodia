import assert from 'node:assert/strict';
import test from 'node:test';

import { createDashboardShortcut, createDashboardWidget, DASHBOARD_PERCENTAGE_MEASURES, DASHBOARD_SHORTCUTS, dashboardWidgetDetail, dashboardWidgetExplanation, dashboardValueLabel, type DashboardWidget } from '../src/lib/dashboard-metrics.ts';

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
  assert.match(explanation.source, /localmente en DS Hub/);
  assert.match(explanation.next, /Safes/);
});

test('quick dashboard shortcuts create valid widgets with useful defaults', () => {
  assert.equal(DASHBOARD_SHORTCUTS.length, 23);
  assert.deepEqual(createDashboardShortcut('pending-classification', 0).filters, { ...base.filters, classification_status: 'pending' });
  assert.deepEqual(createDashboardShortcut('without-accounts', 1).filters, { ...base.filters, health_filter: 'no_accounts' });
  assert.deepEqual(createDashboardShortcut('safes-by-company', 2).chart, { style: 'pie', group_by: 'business_unit' });
  const accountsByCompany = createDashboardShortcut('accounts-by-company', 3);
  assert.equal(accountsByCompany.title, 'Cuentas por empresa');
  assert.equal(accountsByCompany.kind, 'chart');
  assert.equal(accountsByCompany.measure, 'accounts');
  assert.deepEqual(accountsByCompany.chart, { style: 'bars', group_by: 'business_unit' });
  const coverage = createDashboardShortcut('pam-sia-coverage', 4);
  assert.equal(DASHBOARD_PERCENTAGE_MEASURES.has(coverage.measure), true);
  assert.equal(coverage.value_format, 'percentage');
  assert.equal(dashboardValueLabel({ value: 87, value_format: 'percentage' }), '87%');
  assert.deepEqual(createDashboardShortcut('inventory-trend', 5).chart, { style: 'line', group_by: 'inventory_trend' });
  assert.deepEqual(createDashboardShortcut('workflow-heatmap', 6).chart, { style: 'heatmap', group_by: 'business_unit_workflow' });
  assert.deepEqual(createDashboardShortcut('workflow-next-action', 7).chart, { style: 'heatmap', group_by: 'workflow_next_action' });
  assert.equal(DASHBOARD_SHORTCUTS.some((shortcut) => shortcut.id === ('data-quality' as never)), false);
});
