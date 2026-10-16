import test from 'node:test';
import assert from 'node:assert/strict';
import { navigateFromWidget, selectSearchResult } from '../../../src/cyberark/pam/lib/widget-navigation.ts';
import type { DashboardWidget } from '../../../src/cyberark/pam/lib/dashboard-metrics.ts';

const widget = (overrides: Partial<DashboardWidget> = {}): DashboardWidget => ({
  widget_id: 'test', title: 'test', kind: 'chart', measure: 'safes', filters: {
    workflow_status: '', classification_status: '', inventory_scope: '', data_quality_status: '', health_filter: '',
  }, chart: { style: 'bars', group_by: 'business_unit' }, target_value: null, target_direction: null,
  period_label: null, baseline_value: null, value_format: 'count', size: 'sm', position: null, value: 1, ...overrides,
});

test('safe search navigation resets stale filters and seeds the safe name', () => {
  assert.equal(selectSearchResult({ type: 'safe', label: 'Finance', detail: 'Safe', workspace: 'safes', target: 1, query: 'Finance' }).filters.search, 'Finance');
  assert.equal(selectSearchResult({ type: 'safe', label: 'Finance', detail: 'Safe', workspace: 'safes', target: 1, query: 'Finance' }).filters.workflowFilter, '');
});

test('widget navigation maps chart buckets to safe filters', () => {
  const navigation = navigateFromWidget(widget(), { key: 'Acme', count: 2 });
  assert.equal(navigation.workspace, 'safes');
  assert.equal(navigation.filters?.businessUnitFilter, 'Acme');
  assert.equal(navigation.filters?.page, 0);
});

test('widget navigation handles special measures and malformed cross filters', () => {
  assert.equal(navigateFromWidget(widget({ measure: 'connections', chart: null })).workspace, 'assets');
  const platform = navigateFromWidget(widget({ measure: 'account_platform_coverage', chart: null }));
  assert.equal(platform?.workspace, 'safes');
  assert.equal(platform && platform.workspace === 'safes' ? platform.reset : undefined, false);
  const nonempty = navigateFromWidget(widget({ measure: 'safe_account_coverage', chart: null }));
  assert.equal(nonempty && nonempty.workspace === 'safes' ? nonempty.filters.healthFilter : undefined, 'no_accounts');
  const navigation = navigateFromWidget(widget({ chart: { style: 'heatmap', group_by: 'business_unit_workflow' } }), { key: '{bad', count: 1 });
  assert.equal(navigation.workspace, 'safes');
  assert.equal(navigation.filters?.businessUnitFilter, '');
});

test('asset coverage widget preserves its seeded filters for the PAM router', () => {
  const navigation = navigateFromWidget(widget({ measure: 'connections', chart: null }));
  assert.equal(navigation.workspace, 'assets');
  assert.ok(navigation.assetsSeed);
});

test('widget navigation ignores an unfilterable Otros bucket', () => {
  assert.equal(navigateFromWidget(widget(), { key: 'Otros', count: 4 }), null);
});

test('search navigation handles accounts and identity roles', () => {
  assert.equal(selectSearchResult({ type: 'account', label: 'admin', detail: 'Safe: Finance', workspace: 'safes', target: 1, query: 'admin' }).filters.search, 'Finance');
  const identity = selectSearchResult({ type: 'identity_role', label: 'sg_admin', detail: 'role', workspace: 'identity', target: 'r1', query: 'sg_admin' });
  assert.equal(identity.workspace, 'identity');
  assert.equal(identity.identitySection, 'roles');
});

test('widget navigation maps empty and compound dimensions', () => {
  const action = navigateFromWidget(widget({ chart: { style: 'bars', group_by: 'next_action' } }), { key: 'Sin definir', count: 1 });
  assert.equal(action?.workspace === 'safes' ? action.filters.nextActionFilter : undefined, '__empty__');
  const cross = navigateFromWidget(widget({ chart: { style: 'heatmap', group_by: 'workflow_next_action' } }), { key: JSON.stringify({ workflow_status: 'in_progress', next_action: 'Review' }), count: 1 });
  assert.equal(cross?.workspace === 'safes' ? cross.filters.workflowFilter : undefined, 'in_progress');
  assert.equal(cross?.workspace === 'safes' ? cross.filters.nextActionFilter : undefined, 'Review');
});
