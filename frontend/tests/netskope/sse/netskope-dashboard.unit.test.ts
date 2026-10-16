import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  DEFAULT_NETSKOPE_CHART_WIDGETS,
  netskopeChartHasMode,
  netskopeChartMode,
  netskopeDefaultChartMode,
  DEFAULT_NETSKOPE_DATA_WIDGETS,
  DEFAULT_NETSKOPE_WIDGETS,
  NETSKOPE_CHART_WIDGETS,
  NETSKOPE_DASHBOARD_PRESETS,
  NETSKOPE_DATA_WIDGETS,
  RECOMMENDED_NETSKOPE_WIDGETS,
  moveNetskopeWidget,
  moveNetskopeWidgetBefore,
  netskopeUserActivityDrill,
  netskopeChartBucketDrill,
  netskopeDataWidgetDrill,
  netskopeFiltersActive,
  netskopeFiltersFromKey,
  netskopeFilterKey,
  netskopeWidgetDefinition,
  netskopeWidgetSize,
  normalizeNetskopeAlertBuckets,
  netskopeAlertAvailabilityLabel,
  netskopeAlertTotalLabel,
  normalizeNetskopeWidgets,
  toggleNetskopeWidget,
} from '../../../src/netskope/sse/lib/netskope-dashboard.ts';
import type { NetskopeWidgetInstance } from '../../../src/netskope/sse/types/netskope.ts';
import { companyFromIdentity } from '../../../src/netskope/sse/lib/netskope-company.ts';
import { EMPTY_NETSKOPE_DEVICE_QUERY } from '../../../src/netskope/sse/lib/netskope-device-filters.ts';
import { NETSKOPE_PICKER_HIDDEN_WIDGETS, groupNetskopeWidgetDefinitions, netskopeWidgetPickerDetails } from '../../../src/netskope/sse/lib/netskope-dashboard-picker.ts';
import type { NetskopeAlertWindow, NetskopeSelectedMetrics } from '../../../src/netskope/sse/types/netskope.ts';

describe('Netskope dashboard selection', () => {
  it('adds and removes a widget without mutating the saved order', () => {
    const original = ['users_total'] as const;
    const added = toggleNetskopeWidget([...original], 'devices_total');
    assert.deepEqual(added, ['users_total', 'devices_total']);
    assert.deepEqual(original, ['users_total']);
    assert.deepEqual(toggleNetskopeWidget(added, 'users_total'), ['devices_total']);
  });

  it('starts with a simple default: four data blocks and three charts', () => {
    assert.equal(DEFAULT_NETSKOPE_DATA_WIDGETS.length, 4);
    assert.equal(DEFAULT_NETSKOPE_CHART_WIDGETS.length, 3);
  });

  it('declares source, permission, data status and default size for every widget', () => {
    for (const widget of [...NETSKOPE_DATA_WIDGETS, ...NETSKOPE_CHART_WIDGETS]) {
      assert.equal(widget.source, 'netskope', widget.id);
      assert.equal(widget.permission, 'netskope:read', widget.id);
      assert.equal(widget.dataStatus, widget.id === 'alerts_by_severity' ? 'pending' : 'confirmed', widget.id);
      assert.ok(['sm', 'md', 'lg'].includes(widget.defaultSize), widget.id);
    }
  });

  it('assigns every offered widget exactly once, and hides only the retired-from-picker one', () => {
    const definitions = [...NETSKOPE_DATA_WIDGETS, ...NETSKOPE_CHART_WIDGETS];
    const groups = groupNetskopeWidgetDefinitions(definitions);
    const groupedIds = groups.flatMap((group) => group.options.map((option) => option.id));

    assert.deepEqual(groups.map((group) => group.id), ['inventory', 'alerts']);
    assert.equal(groups.every((group) => group.options.length > 0), true);
    assert.equal(groupedIds.length, 11);
    assert.equal(new Set(groupedIds).size, groupedIds.length);
    // Every registered widget is either offered once or explicitly hidden: none is silently dropped.
    assert.deepEqual(definitions.map((definition) => definition.id).filter((id) => !groupedIds.includes(id)), [...NETSKOPE_PICKER_HIDDEN_WIDGETS]);
    assert.deepEqual(
      groups.find((group) => group.id === 'inventory')?.options.map((option) => option.id),
      [
        'users_recent_activity', 'devices_total', 'devices_stale_30d', 'devices_observed_user_unmatched',
        'devices_by_os', 'devices_by_classification', 'devices_by_company', 'users_by_company',
      ],
    );
    assert.deepEqual(
      groups.find((group) => group.id === 'alerts')?.options.map((option) => option.id),
      ['alerts_7d', 'alerts_30d', 'alerts_90d'],
    );
    assert.deepEqual(groupNetskopeWidgetDefinitions([]), []);
  });

  it('labels source, actual period and availability without replacing missing data with zero', () => {
    const metrics = {
      users_total: 12,
      devices_total: 8,
      devices_with_observed_user: 6,
      devices_stale_30d: 3,
      last_observed_at: '2026-10-02T12:00:00Z',
      users_with_device_activity_7d: 0,
    } as NetskopeSelectedMetrics;
    const alerts = [
      { days: 7, window_start: '2026-09-25T00:00:00Z', window_end: '2026-10-02T00:00:00Z', captured_at: '2026-10-02T00:00:00Z', total: null, availability: 'incomplete', by_alert_type: [], by_severity: [], by_action: [] },
      { days: 30, window_start: '2026-09-02T00:00:00Z', window_end: '2026-10-02T00:00:00Z', captured_at: '2026-10-01T00:00:00Z', total: 0, availability: 'complete', by_alert_type: [], by_severity: [], by_action: [] },
      { days: 90, window_start: '2026-07-04T00:00:00Z', window_end: '2026-10-02T00:00:00Z', captured_at: '2026-09-01T00:00:00Z', total: 42, availability: 'stale', by_alert_type: [], by_severity: [], by_action: [] },
    ] satisfies NetskopeAlertWindow[];

    const inventory = netskopeWidgetPickerDetails(netskopeWidgetDefinition('users_total')!, metrics, alerts);
    assert.match(inventory.sourceLabel, /Fuente: Inventario Netskope · Período: Inventario vigente/);
    assert.match(inventory.sourceLabel, /Disponibilidad: Inventario observado/);
    const activity = netskopeWidgetPickerDetails(netskopeWidgetDefinition('users_recent_activity')!, metrics, alerts);
    assert.match(activity.sourceLabel, /Período: Eventos de 7, 14 o 30 días/);
    assert.equal(activity.previewLabel, '0');
    const missingActivity = netskopeWidgetPickerDetails(netskopeWidgetDefinition('users_recent_activity')!, { ...metrics, users_with_device_activity_7d: undefined }, alerts);
    assert.equal(missingActivity.previewLabel, undefined);
    assert.match(netskopeWidgetPickerDetails(netskopeWidgetDefinition('users_total')!, null, alerts).sourceLabel, /Disponibilidad: Sin dato/);
    // The stale card names the period it reads (the whole inventory, not the 7-day window) and previews its own count.
    const staleDetails = netskopeWidgetPickerDetails(netskopeWidgetDefinition('devices_stale_30d')!, metrics, alerts);
    assert.match(staleDetails.sourceLabel, /Período: Último evento de más de 30 días · inventario vigente/);
    assert.equal(staleDetails.previewLabel, '3');

    const incomplete = netskopeWidgetPickerDetails(netskopeWidgetDefinition('alerts_7d')!, metrics, alerts);
    assert.match(incomplete.sourceLabel, /Fuente: Captura de alertas Netskope · Período: Captura de 7 días/);
    assert.match(incomplete.sourceLabel, /Disponibilidad: Datos incompletos/);
    assert.match(incomplete.sourceLabel, /período .* – /);
    assert.match(incomplete.sourceLabel, /capturada /);
    assert.equal(incomplete.previewLabel, 'Sin dato · Datos incompletos');
    const complete = netskopeWidgetPickerDetails(netskopeWidgetDefinition('alerts_30d')!, metrics, alerts);
    assert.match(complete.sourceLabel, /Captura de 30 días · Disponibilidad: Captura completa/);
    assert.equal(complete.previewLabel, '0');
    const stale = netskopeWidgetPickerDetails(netskopeWidgetDefinition('alerts_90d')!, metrics, alerts);
    assert.match(stale.sourceLabel, /Captura de 90 días · Disponibilidad: Captura vencida/);
    assert.equal(stale.previewLabel, '42 · Captura vencida');
    assert.equal(netskopeWidgetPickerDetails(netskopeWidgetDefinition('alerts_30d')!, metrics, []).previewLabel, undefined);
  });

  it('keeps pending AA severity visible but unavailable and never offers it as an addable binding', () => {
    const details = netskopeWidgetPickerDetails(netskopeWidgetDefinition('alerts_by_severity')!, null, []);
    assert.match(details.sourceLabel, /Fuente: Advanced Analytics/);
    assert.match(details.sourceLabel, /sin binding aprobado/);
    assert.match(details.sourceLabel, /requiere definición validada/);
    assert.equal(details.unavailable, true);
  });

  it('normalizes legacy id arrays and new widget instances', () => {
    assert.deepEqual(
      normalizeNetskopeWidgets({ data_widgets: ['users_total'], chart_widgets: ['devices_by_os'] }),
      [
        { id: 'users_total', size: 'sm', filters: {} },
        { id: 'devices_by_os', size: 'md', filters: {} },
      ],
    );
    assert.deepEqual(
      normalizeNetskopeWidgets({ widgets: [{ id: 'users_total', size: 'lg', filters: { os: 'Windows', company: 'ITTI' } }] }),
      [{ id: 'users_total', size: 'lg', filters: { company: 'ITTI' } }],
    );
    assert.deepEqual(normalizeNetskopeWidgets({ widgets: [] }), []);
  });

  it('declares allowlisted per-widget filters for every widget', () => {
    for (const widget of [...NETSKOPE_DATA_WIDGETS, ...NETSKOPE_CHART_WIDGETS]) {
      for (const key of widget.filterKeys) {
        assert.ok(['os', 'company', 'classification_status'].includes(key), widget.id);
      }
    }
    assert.deepEqual(netskopeWidgetDefinition('users_total')?.filterKeys, ['company']);
    assert.deepEqual(netskopeWidgetDefinition('alerts_7d')?.filterKeys, []);
  });

  it('round-trips filter keys and only reorders within a kind', () => {
    assert.deepEqual(
      netskopeFiltersFromKey(netskopeFilterKey({ os: 'Windows', company: 'ITTI' })),
      { os: 'Windows', company: 'ITTI' },
    );
    assert.equal(netskopeFiltersActive({}), false);
    assert.equal(netskopeFiltersActive({ os: 'Windows' }), true);
    const widgets: NetskopeWidgetInstance[] = [
      { id: 'users_total', size: 'sm', filters: {} },
      { id: 'devices_total', size: 'sm', filters: {} },
      { id: 'devices_by_os', size: 'md', filters: {} },
    ];
    assert.deepEqual(moveNetskopeWidget(widgets, 'devices_total', -1).map((widget) => widget.id), ['devices_total', 'users_total', 'devices_by_os']);
    assert.deepEqual(moveNetskopeWidget(widgets, 'users_total', -1).map((widget) => widget.id), ['users_total', 'devices_total', 'devices_by_os']);
    assert.deepEqual(moveNetskopeWidgetBefore(widgets, 'users_total', 'devices_by_os').map((widget) => widget.id), ['users_total', 'devices_total', 'devices_by_os']);
  });

  it('falls back to the registered default size when an instance is missing', () => {
    assert.equal(netskopeWidgetSize([], 'devices_by_os'), 'md');
    assert.equal(netskopeWidgetSize([], 'users_total'), 'sm');
    assert.equal(netskopeWidgetSize([{ id: 'users_total', size: 'lg' }], 'users_total'), 'lg');
  });

  it('turns data widgets into inventory links with the relevant filters', () => {
    assert.deepEqual(netskopeDataWidgetDrill('users_total'), { view: 'users', search: '' });
    // NSK-HB-001: the stale card opens exactly the devices it counted: older than 30 days, in the whole inventory, with its filters.
    const stale = netskopeDataWidgetDrill('devices_stale_30d', { os: 'Windows', classification_status: 'managed' });
    assert.equal(stale?.view, 'devices');
    if (stale?.view === 'devices') {
      assert.equal(stale.query.eventAge, 'gt_30d');
      assert.equal(stale.query.freshness, 'all');
      assert.equal(stale.query.evidenceState, undefined, 'it counts by age, so it never depends on the sync like the review state does');
      assert.equal(stale.query.filters.os, 'Windows');
      assert.equal(stale.query.filters.classification_status, 'managed');
      assert.equal(stale.query.filters.company, '');
      assert.equal('heartbeat' in stale.query, false);
    }
    // The widget filters also travel with the other device cards.
    const unmatched = netskopeDataWidgetDrill('devices_observed_user_unmatched', { company: 'ITTI' });
    if (unmatched?.view === 'devices') assert.deepEqual([unmatched.query.filters.company, unmatched.query.filters.observed_user_status], ['ITTI', 'unmatched']);
    assert.equal(netskopeDataWidgetDrill('devices_stale_30d')?.view, 'devices');
  });

  it('turns chart buckets into filtered inventory links', () => {
    const os = netskopeChartBucketDrill('devices_by_os', 'Windows');
    assert.equal(os.view, 'devices');
    if (os.view === 'devices') assert.equal(os.query.filters.os, 'Windows');
    assert.deepEqual(netskopeChartBucketDrill('users_by_company', 'ITTI'), { view: 'users', search: 'ITTI' });
  });

  it('keeps count-only DLP aggregate widgets informational', () => {
    // The product decision retired individual incident investigation, so the
    // aggregate cards and charts must not offer any navigation.
    assert.equal(netskopeDataWidgetDrill('alerts_7d'), null);
    assert.equal(netskopeDataWidgetDrill('alerts_30d'), null);
    assert.equal(netskopeDataWidgetDrill('alerts_90d'), null);
    assert.equal(netskopeChartBucketDrill('alerts_by_severity', 'high'), null);
  });

  it('shows absent alert totals as missing data and labels unavailable snapshots', () => {
    assert.equal(netskopeAlertTotalLabel(null), 'Sin dato');
    assert.equal(netskopeAlertTotalLabel(0), '0');
    assert.equal(netskopeAlertAvailabilityLabel('incomplete'), 'Datos incompletos');
    assert.equal(netskopeAlertAvailabilityLabel('stale'), 'Captura vencida');
    assert.equal(netskopeAlertAvailabilityLabel('complete'), null);
  });

  it('consolidates provider severity variants without changing the aggregate total', () => {
    const buckets = normalizeNetskopeAlertBuckets('by_severity', [
      { key: 'Sin Dato', count: 18_259_090 },
      { key: 'Unknown', count: 6_279_650 },
      { key: 'High', count: 2_234 },
      { key: ' high ', count: 34 },
      { key: 'Medium', count: 957 },
      { key: 'MEDIUM', count: 4 },
      { key: 'Informational', count: 67 },
      { key: 'info', count: 19 },
      { key: 'Critical', count: 13 },
      { key: 'Low', count: 89 },
    ]);

    assert.deepEqual(buckets, [
      { key: 'Crítica', count: 13 },
      { key: 'Alta', count: 2_268 },
      { key: 'Media', count: 961 },
      { key: 'Baja', count: 89 },
      { key: 'Informativa', count: 86 },
      { key: 'Sin dato', count: 24_538_740 },
    ]);
    assert.equal(buckets.reduce((total, bucket) => total + bucket.count, 0), 24_542_157);
    assert.equal(new Set(buckets.map((bucket) => bucket.key)).size, buckets.length);
  });

  it('offers a recommended first board that is valid, unique and balanced', () => {
    assert.equal(RECOMMENDED_NETSKOPE_WIDGETS.length, 6);
    const ids = RECOMMENDED_NETSKOPE_WIDGETS.map((widget) => widget.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const widget of RECOMMENDED_NETSKOPE_WIDGETS) {
      const definition = netskopeWidgetDefinition(widget.id);
      assert.ok(definition, widget.id);
      assert.equal(widget.size, definition?.defaultSize, widget.id);
    }
    assert.equal(ids.filter((id) => netskopeWidgetDefinition(id)?.kind === 'data').length, 4);
    assert.equal(ids.filter((id) => netskopeWidgetDefinition(id)?.kind === 'chart').length, 2);
  });

  it('refuses to drop a widget into another kind while dragging', () => {
    const widgets: NetskopeWidgetInstance[] = [
      { id: 'users_total', size: 'sm', filters: {} },
      { id: 'devices_total', size: 'sm', filters: {} },
      { id: 'devices_by_os', size: 'md', filters: {} },
    ];
    assert.deepEqual(moveNetskopeWidgetBefore(widgets, 'users_total', 'devices_by_os'), widgets);
    assert.deepEqual(moveNetskopeWidgetBefore(widgets, 'devices_by_os', 'users_total'), widgets);
    assert.deepEqual(moveNetskopeWidgetBefore(widgets, 'users_total', 'users_total'), widgets);
  });

  it('normalizes corporate email domains into company labels', () => {
    assert.equal(companyFromIdentity('user@itti.digital'), 'ITTI');
    assert.equal(companyFromIdentity('user@ueno.com.py'), 'UENO');
    assert.equal(companyFromIdentity('user@upay.com.py'), 'UPAY');
    assert.equal(companyFromIdentity('sin-correo'), 'Sin empresa');
  });
});

describe('Netskope dashboard presets', () => {
  it('defines three distinct, valid role sets within the board limits', () => {
    assert.deepEqual(NETSKOPE_DASHBOARD_PRESETS.map((preset) => preset.id), ['manager', 'operations', 'audit']);
    const signatures = NETSKOPE_DASHBOARD_PRESETS.map((preset) => preset.widgets.map((widget) => widget.id).join('|'));
    assert.equal(new Set(signatures).size, 3, 'each preset must be a different set');
    for (const preset of NETSKOPE_DASHBOARD_PRESETS) {
      assert.ok(preset.widgets.length >= 4 && preset.widgets.length <= 6, preset.id);
      assert.equal(new Set(preset.widgets.map((widget) => widget.id)).size, preset.widgets.length, preset.id);
      const kinds = preset.widgets.map((widget) => netskopeWidgetDefinition(widget.id)?.kind);
      assert.ok(kinds.every(Boolean), preset.id);
      assert.ok(kinds.includes('data') && kinds.includes('chart'), preset.id);
      for (const widget of preset.widgets) {
        assert.equal(widget.size, netskopeWidgetDefinition(widget.id)?.defaultSize, widget.id);
      }
    }
  });

  it('keeps the factory default set used by "Restablecer a predeterminada"', () => {
    assert.equal(DEFAULT_NETSKOPE_WIDGETS.length, 7);
    assert.equal(new Set(DEFAULT_NETSKOPE_WIDGETS.map((widget) => widget.id)).size, 7);
    assert.equal(DEFAULT_NETSKOPE_WIDGETS.filter((widget) => netskopeWidgetDefinition(widget.id)?.kind === 'data').length, 4);
    assert.equal(DEFAULT_NETSKOPE_WIDGETS.filter((widget) => netskopeWidgetDefinition(widget.id)?.kind === 'chart').length, 3);
  });

  it('NSK-XMET-001: cross user-device KPIs drill with their exact bucket', () => {
    const deviceDrill = (patch: Record<string, string>) => ({
      view: 'devices',
      query: { ...EMPTY_NETSKOPE_DEVICE_QUERY, filters: { ...EMPTY_NETSKOPE_DEVICE_QUERY.filters, ...patch } },
    });
    assert.deepEqual(netskopeDataWidgetDrill('devices_observed_user_matched'), deviceDrill({ observed_user_status: 'matched' }));
    assert.deepEqual(netskopeDataWidgetDrill('devices_observed_user_unmatched'), deviceDrill({ observed_user_status: 'unmatched' }));
    assert.deepEqual(netskopeDataWidgetDrill('users_without_observed_devices'), { view: 'users', search: '', deviceCount: '0' });
    // NSK-XMET-003: the activity card drills with the window it is showing.
    for (const days of [7, 14, 30] as const) assert.deepEqual(netskopeUserActivityDrill(days), { view: 'users', search: '', activityDays: days });

    assert.deepEqual(netskopeChartBucketDrill('devices_by_observed_user_status', 'ambiguous'), deviceDrill({ observed_user_status: 'ambiguous' }));
    assert.deepEqual(netskopeChartBucketDrill('users_by_device_count', '2plus'), { view: 'users', search: '', deviceCount: '2plus' });
    assert.deepEqual(netskopeChartBucketDrill('users_by_recent_device_age', 'gt_30d'), { view: 'users', search: '', recentDeviceAge: 'gt_30d' });
    assert.deepEqual(netskopeChartBucketDrill('coverage_risk_devices_by_user', 'uid-e'), {
      view: 'devices',
      query: {
        ...EMPTY_NETSKOPE_DEVICE_QUERY,
        freshness: 'all',
        coverageRisk: '1',
        filters: { ...EMPTY_NETSKOPE_DEVICE_QUERY.filters, observed_user: 'uid-e' },
      },
    });

    // Unknown buckets never fabricate a filter.
    assert.equal(netskopeChartBucketDrill('devices_by_observed_user_status', 'sin-dato'), null);
    assert.equal(netskopeChartBucketDrill('users_by_device_count', 'muchos'), null);
    assert.equal(netskopeChartBucketDrill('coverage_risk_devices_by_user', ''), null);
  });
});

describe('NSK-INV-002 retired diagnosis widgets', () => {
  it('are no longer offered and the stale card keeps counting by age', () => {
    for (const id of ['devices_stale_unclassified', 'devices_stale_by_diagnosis']) {
      assert.equal(netskopeWidgetDefinition(id as never), undefined, id);
    }
    const stale = netskopeDataWidgetDrill('devices_stale_30d');
    if (stale?.view === 'devices') assert.equal(stale.query.reviewDiagnosis, undefined);
  });
});

describe('chart presentation (donut or bars)', () => {
  it('uses bars for the rankings and the donut for small distributions, honours a saved choice, and gives none to data tiles, AA severity or the Top-10 risk sample', () => {
    assert.equal(netskopeChartMode({ id: 'devices_by_company' }), 'bars');
    assert.equal(netskopeChartMode({ id: 'users_by_company' }), 'bars');
    assert.equal(netskopeChartMode({ id: 'devices_by_company', style: 'donut' }), 'donut');
    assert.equal(netskopeChartMode({ id: 'devices_by_os' }), 'donut');
    assert.equal(netskopeChartMode({ id: 'devices_by_os', style: 'bars' }), 'bars');
    assert.equal(netskopeChartMode({ id: 'devices_by_os', style: null }), 'donut');
    assert.equal(netskopeDefaultChartMode('devices_by_classification'), 'donut');
    assert.equal(netskopeChartHasMode('devices_by_os'), true);
    assert.equal(netskopeChartHasMode('alerts_by_severity'), false);
    assert.equal(netskopeChartHasMode('coverage_risk_devices_by_user'), false);
    assert.equal(netskopeChartMode({ id: 'coverage_risk_devices_by_user', style: 'donut' }), 'bars', 'a sample is never drawn as a donut');
    assert.equal(netskopeChartHasMode('users_total'), false);
  });

  it('keeps the chosen presentation when preferences are read back, and drops it where it does not apply', () => {
    const widgets = normalizeNetskopeWidgets({ widgets: [
      { id: 'devices_by_os', size: 'md', filters: { os: 'Windows' }, style: 'bars' },
      { id: 'devices_by_company', size: 'md', style: 'donut' },
      { id: 'devices_by_classification', size: 'md', style: null },
      { id: 'users_total', size: 'sm', style: 'donut' as never },
      { id: 'devices_by_user_status', size: 'md', style: 'line' as never },
    ] });
    assert.deepEqual(widgets.map((widget) => [widget.id, widget.style ?? null]), [
      ['devices_by_os', 'bars'], ['devices_by_company', 'donut'], ['devices_by_classification', null], ['users_total', null], ['devices_by_user_status', null],
    ]);
    assert.deepEqual(widgets[0].filters, { os: 'Windows' });
  });

  it('no longer offers the alert type and action rankings', () => {
    const ids = [...NETSKOPE_DATA_WIDGETS, ...NETSKOPE_CHART_WIDGETS].map((definition) => definition.id as string);
    assert.equal(ids.includes('alerts_by_type'), false);
    assert.equal(ids.includes('alerts_by_action'), false);
    assert.equal((DEFAULT_NETSKOPE_CHART_WIDGETS as string[]).includes('alerts_by_type'), false);
  });
});
