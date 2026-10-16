import { test as base, expect, type Page } from '@playwright/test';

export const unauthenticated = {
  mode: 'local',
  authenticated: false,
  setup_available: false,
  permissions: [],
  api_docs_enabled: false,
  user: null,
};

type MockOptions = { onRequest?: (pathname: string) => void; permissions?: string[]; authMode?: 'local' | 'oidc' | 'hybrid'; sessionUser?: Record<string, unknown>; userRows?: Record<string, unknown>[]; includeSafe?: boolean; largeInventory?: boolean; decommissionCandidate?: boolean; accountManagementUnavailable?: boolean; initialVisibleWorkspaces?: string[]; initialRecentWorkspaces?: string[]; dashboardWidgets?: Record<string, unknown>[]; latestRun?: Record<string, unknown> | null; apiDocsEnabled?: boolean; netskopeMetrics?: Record<string, unknown> };

export async function mockAuthenticatedApp(page: Page, options: MockOptions = {}) {
  const { onRequest, permissions = ['inventory:read', 'inventory:write', 'catalogs:write', 'access:manage', 'safes:read', 'safes:manage', 'coverage:read', 'coverage:manage', 'ingestion:preview', 'ingestion:run', 'findings:manage', 'catalogs:manage'], authMode = 'local', sessionUser = { actor_id: 'operator-1', name: 'Operador', email: 'operator@example.com', roles: ['operator'], role_names: ['Operador de plataforma'] }, userRows = [{ actor_id: 'carlos@example.com', email: 'carlos@example.com', display_name: 'Carlos Ortiz', is_active: true, must_change_password: false, roles: ['admin'], auth_source: 'local', last_login_at: null }], includeSafe = false, largeInventory = false, decommissionCandidate = false, accountManagementUnavailable = false, initialVisibleWorkspaces = ['safes'], initialRecentWorkspaces = [], dashboardWidgets, latestRun = null, apiDocsEnabled = true, netskopeMetrics = {} } = options;
  const peopleByEmail = new Map<string, { key: string; email: string; display_name: string; identities: Record<string, unknown>[] }>();
  for (const user of userRows) {
    const email = String(user.email || '');
    const key = email.trim().toLowerCase() || `${user.auth_source}:${user.actor_id}`;
    if (!peopleByEmail.has(key)) peopleByEmail.set(key, { key, email, display_name: String(user.display_name), identities: [] });
    const person = peopleByEmail.get(key)!;
    if (user.auth_source === 'oidc') person.display_name = String(user.display_name);
    person.identities.push(user);
  }
  let workspacePreferences = { visible_workspaces: initialVisibleWorkspaces, hidden_workspaces: [] as string[], recent_workspaces: initialRecentWorkspaces, updated_at: null as string | null };
  await page.route('**/api/**', async (route) => {
    const requestUrl = new URL(route.request().url());
    const pathname = requestUrl.pathname;
    onRequest?.(pathname);
    if (pathname === '/api/analytics/account-management' && accountManagementUnavailable) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Resumen temporalmente no disponible' }) });
      return;
    }
    if (RETIRED_DLP_PATHS.has(pathname)) {
      await route.fulfill({
        status: 410,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'La investigación de incidentes y eventos DLP individuales está retirada.' }),
      });
      return;
    }
    const bodies: Record<string, unknown> = {
      '/api/auth/status': {
        mode: authMode,
        authenticated: true,
        permissions,
        api_docs_enabled: apiDocsEnabled,
        user: sessionUser,
      },
      '/api/auth/users': { rows: userRows, total: userRows.length, limit: 20, offset: 0 },
      '/api/auth/access-review': { rows: [], total: 0, limit: 25, offset: 0, days: 90, summary: { assignments: 0, attention: 0, inactive_account: 0, manual_old: 0, stale_login: 0 } },
      '/api/auth/people': { rows: [...peopleByEmail.values()], total: peopleByEmail.size, limit: 20, offset: 0 },
      '/api/access/roles': { rows: [
        { role_code: 'reader', display_name: 'Lector de plataforma', description: 'Consulta básica', domain_code: 'platform', role_kind: 'direct', lifecycle_status: 'active', system_managed: true, permission_codes: ['inventory:read'], level_refs: [], user_count: 0 },
        { role_code: 'admin', display_name: 'Administrador de plataforma', description: 'Administración completa', domain_code: 'platform', role_kind: 'direct', lifecycle_status: 'active', system_managed: true, permission_codes: ['inventory:read', 'inventory:write', 'inventory:export', 'catalogs:read', 'catalogs:write', 'access:manage', 'domain:pam', 'domain:admin'], level_refs: [], user_count: 1, oidc_groups: ['sg_ds-hub_admins'] },
        { role_code: 'netskope_reader', display_name: 'Netskope · Lector', description: 'Lectura del espacio Netskope', domain_code: 'dlp', role_kind: 'direct', lifecycle_status: 'active', system_managed: true, permission_codes: ['domain:dlp', 'netskope:read'], level_refs: [], user_count: 0 },
        { role_code: 'security_reader', display_name: 'Lectura de seguridad', description: 'Lectura transversal', domain_code: null, role_kind: 'composite', lifecycle_status: 'active', system_managed: false, permission_codes: ['inventory:read', 'domain:dlp', 'netskope:read'], level_refs: [{ domain_code: 'platform', level_code: 'reader' }, { domain_code: 'dlp', level_code: 'reader' }], user_count: 0 },
      ] },
      '/api/access/domains': { rows: [
        { domain_code: 'platform', display_name: 'Plataforma', lifecycle_status: 'active', sort_order: 10, levels: [{ level_code: 'reader', display_name: 'Lector', base_role_code: 'reader', lifecycle_status: 'active', permission_codes: ['inventory:read'] }, { level_code: 'admin', display_name: 'Administrador', base_role_code: 'admin', lifecycle_status: 'active', permission_codes: ['inventory:read', 'access:manage'] }] },
        { domain_code: 'pam', display_name: 'CyberArk PAM', lifecycle_status: 'active', sort_order: 20, levels: [{ level_code: 'reader', display_name: 'Lector', base_role_code: 'cyberark_reader', lifecycle_status: 'active', permission_codes: ['domain:pam'] }, { level_code: 'admin', display_name: 'Administrador', base_role_code: 'cyberark_admin', lifecycle_status: 'active', permission_codes: ['domain:pam', 'domain:admin'] }] },
        { domain_code: 'dlp', display_name: 'Netskope DLP', lifecycle_status: 'active', sort_order: 30, levels: [{ level_code: 'reader', display_name: 'Lector', base_role_code: 'netskope_reader', lifecycle_status: 'active', permission_codes: ['domain:dlp', 'netskope:read'] }] },
        { domain_code: 'dspm', display_name: 'BigID DSPM', lifecycle_status: 'planned', sort_order: 40, levels: [{ level_code: 'reader', display_name: 'Lector', base_role_code: 'bigid_reader', lifecycle_status: 'planned', permission_codes: ['domain:dspm', 'bigid:read'] }] },
      ] },
      '/api/auth/oidc-groups': { rows: [], observed_identities: 0, unobserved_identities: userRows.filter((user) => user.auth_source === 'oidc').length },
      '/api/access/roles/composite': { created: true, role_code: 'security_lead', warning: { code: 'duplicate_combination', matching_role_code: 'security_reader', matching_role_name: 'Lectura de seguridad' } },
       '/api/access/permissions': { rows: [
         { permission_code: 'inventory:read', domain_code: 'pam', resource_code: 'inventory', action_code: 'read', description: 'Consultar inventario PAM', lifecycle_status: 'active', system_managed: true },
         ...[
           ['inventory:write', 'pam', 'inventory', 'write', 'Editar inventario PAM'],
           ['inventory:export', 'pam', 'inventory', 'export', 'Exportar inventario PAM'],
           ['catalogs:read', 'pam', 'catalogs', 'read', 'Consultar catálogos PAM'],
           ['catalogs:write', 'pam', 'catalogs', 'write', 'Editar catálogos PAM'],
           ['access:manage', 'platform', 'access', 'manage', 'Administrar usuarios y permisos'],
           ['domain:pam', 'pam', 'domain', 'access', 'Ingresar a CyberArk PAM'],
           ['domain:admin', 'platform', 'domain', 'access', 'Ingresar a Administración'],
         ].map(([permission_code, domain_code, resource_code, action_code, description]) => ({ permission_code, domain_code, resource_code, action_code, description, lifecycle_status: 'active', system_managed: true })),
         { permission_code: 'domain:dlp', domain_code: 'dlp', resource_code: 'domain', action_code: 'access', description: 'Ingresar a Netskope DLP', lifecycle_status: 'active', system_managed: true },
         { permission_code: 'netskope:read', domain_code: 'dlp', resource_code: 'workspace', action_code: 'read', description: 'Consultar Netskope DLP', lifecycle_status: 'active', system_managed: true },
       ] },
      '/api/summary': {
        safes: 1, business_safes: 1, internal_safes: 0, scope_pending_safes: 0,
        scope_candidate_safes: 0, clean_business_safes: 1, obsolete_safes: 0,
        duplicate_safes: 0, accounts: 1, pending_classification: 0, assigned: 1,
        review: 0, latest_run: latestRun,
        safe_health: { denominator: 1, missing_cpm: 0, no_accounts: 0, olac_disabled: 0, retention_unconfigured: 0, manage_safe_concentration: 0 },
      },
       '/api/dashboard/preferences': { widgets: dashboardWidgets || [
        { widget_id: 'without-accounts', title: 'Safes sin cuentas', kind: 'count', measure: 'safes', chart: null, filters: { workflow_status: '', classification_status: '', inventory_scope: '', data_quality_status: '', health_filter: 'no_accounts' }, target_value: null, target_direction: null, period_label: null, baseline_value: null, value_format: 'count', position: null, size: 'sm', value: 51 },
        { widget_id: 'pending-classification', title: 'Pendientes de clasificar', kind: 'count', measure: 'safes', chart: null, filters: { workflow_status: '', classification_status: 'pending', inventory_scope: '', data_quality_status: '', health_filter: '' }, target_value: null, target_direction: null, period_label: null, baseline_value: null, value_format: 'count', position: null, size: 'sm', value: 104 },
        { widget_id: 'pam-users', title: 'Usuarios PAM', kind: 'count', measure: 'pam_users', chart: null, filters: { workflow_status: '', classification_status: '', inventory_scope: '', data_quality_status: '', health_filter: '' }, target_value: null, target_direction: null, period_label: null, baseline_value: null, value_format: 'count', position: null, size: 'sm', value: 98 },
        { widget_id: 'safes-by-company', title: 'Safes por empresa', kind: 'chart', measure: 'safes', chart: { style: 'pie', group_by: 'business_unit' }, filters: { workflow_status: '', classification_status: '', inventory_scope: '', data_quality_status: '', health_filter: '' }, target_value: null, target_direction: null, period_label: null, baseline_value: null, position: 0, size: 'sm', value: 0, buckets: [{ key: 'Ueno', filter_value: '3', count: 1 }] },
        { widget_id: 'accounts-by-company', title: 'Cuentas por empresa', kind: 'chart', measure: 'accounts', chart: { style: 'bars', group_by: 'business_unit' }, filters: { workflow_status: '', classification_status: '', inventory_scope: '', data_quality_status: '', health_filter: '' }, target_value: null, target_direction: null, period_label: null, baseline_value: null, position: 1, size: 'sm', value: 0, buckets: [{ key: 'Ueno', filter_value: '3', count: 1 }] },
        { widget_id: 'safes-by-status', title: 'Safes por estado', kind: 'chart', measure: 'safes', chart: { style: 'pie', group_by: 'workflow_status' }, filters: { workflow_status: '', classification_status: '', inventory_scope: '', data_quality_status: '', health_filter: '' }, target_value: null, target_direction: null, period_label: null, baseline_value: null, position: 2, size: 'sm', value: 0, buckets: [{ key: 'pending', filter_value: 'pending', count: 1 }, { key: 'retired', filter_value: 'retired', count: 1 }] },
      ], is_default: true },
      '/api/catalogs': includeSafe ? { business_units: [{ business_unit_id: 3, unit_code: 'FIN', unit_name: 'Finanzas', is_active: true }], responsibles: [{ responsible_id: 4, display_name: 'Ada Admin', email: 'ada@example.com', is_active: true }], account_types: [] } : { business_units: [], responsibles: [], account_types: [] },
      '/api/cmdb/coverage': { objects: [], relationships: [], chains: { pam: 'pending_sources', sia: 'pending_sources' } },
      '/api/cmdb/netskope/sync-evidence': { source_fresh: true, source_status: 'completed', source_completed_at: '2026-10-05T11:00:00Z', as_of: '2026-10-05T12:00:00Z' },
      '/api/cmdb/netskope/metrics': {
        users_total: 1, users_with_device_activity_7d: 1, users_with_device_activity_14d: 1,
        users_with_device_activity_30d: 1, devices_total: 1, devices_stale_30d: 4,
        source_evidence: { source_fresh: true, source_status: 'completed', source_completed_at: '2026-10-05T11:00:00Z', as_of: '2026-10-05T12:00:00Z' },
        devices_with_observed_user: 1, last_observed_at: '2026-09-01T00:00:00Z',
        devices_by_os: [{ key: 'Windows', count: 1 }], devices_by_client: [{ key: '110.0.1', count: 1 }], devices_by_make: [{ key: 'Dell', count: 1 }],
        devices_by_classification: [{ key: 'managed', count: 1 }], devices_by_user_status: [{ key: 'enabled', count: 1 }],
        devices_by_company: [{ key: 'example.com', count: 1 }], users_by_company: [{ key: 'example.com', count: 1 }],
        devices_observed_user_matched: 1, devices_observed_user_ambiguous: 0, devices_observed_user_unmatched: 0,
        devices_by_observed_user_status: [{ key: 'matched', count: 1 }, { key: 'ambiguous', count: 0 }, { key: 'unmatched', count: 0 }],
        devices_active_total: 1,
        users_without_observed_devices: 0,
        users_by_device_count: [{ key: '0', count: 0 }, { key: '1', count: 1 }, { key: '2plus', count: 0 }],
        users_by_recent_device_age: [{ key: 'lt_24h', count: 1 }, { key: 'd1_7', count: 0 }, { key: 'd7_30', count: 0 }, { key: 'gt_30d', count: 0 }, { key: 'unknown', count: 0 }],
        coverage_risk_devices_by_user: [{ key: 'Ada Identity', count: 1, filter_value: 'uid-a' }],
        ...netskopeMetrics,
      },
      '/api/cmdb/netskope/aa/severity': {
        source: 'advanced_analytics', state: 'not_configured', buckets: [], total: null,
        window_days: null, timezone: null, scope: null, unit: null, fetched_at: null, cache_expires_at: null,
      },
      '/api/cmdb/netskope/alerts': {
        configured: true,
        dlp_export_configured: true,
        windows: [
          { days: 7, window_start: '2026-08-25T00:00:00Z', window_end: '2026-09-01T00:00:00Z', captured_at: '2026-09-01T00:00:00Z', total: 3, availability: 'complete', by_alert_type: [{ key: 'DLP', count: 3 }], by_severity: [], by_action: [] },
          { days: 30, window_start: '2026-08-02T00:00:00Z', window_end: '2026-09-01T00:00:00Z', captured_at: '2026-09-01T00:00:00Z', total: 12, availability: 'complete', by_alert_type: [{ key: 'DLP', count: 12 }], by_severity: [], by_action: [] },
          { days: 90, window_start: '2026-06-03T00:00:00Z', window_end: '2026-09-01T00:00:00Z', captured_at: '2026-09-01T00:00:00Z', total: 31, availability: 'complete', by_alert_type: [{ key: 'DLP', count: 31 }], by_severity: [], by_action: [] },
        ],
      },
      '/api/cmdb/netskope/experience/presence': {
        total: 0, reported: 0, statuses: [], methods: [], by_client_config: [], by_company: [], company_omitted_devices: 0, missing_label: 'Sin dato',
        source_evidence: { source_fresh: true, source_status: 'completed', source_completed_at: '2026-09-01T00:00:00Z', as_of: '2026-09-01T00:00:00Z' },
      },
      '/api/cmdb/netskope/posture': {
        checks: [
          { id: 'client_protection_off', entity: 'device', severity: 'high', title: 'Cliente desinstalado o deshabilitado', description: 'El último evento del cliente es desinstalación o deshabilitación.', status: 'evaluated', count: 3, query: { coverage_risk: '1' }, findings: [] },
          { id: 'stale_undiagnosed', entity: 'device', severity: 'medium', title: 'Sin señal hace más de 30 días', description: 'Más de 30 días sin eventos y sin diagnóstico.', status: 'evaluated', count: 3, query: { event_age: 'gt_30d', review_diagnosis: 'undetermined' }, findings: [] },
          { id: 'duplicate_hostname', entity: 'device', severity: 'low', title: 'Hostname con varios equipos activos', description: 'Mismo hostname en varios device_id.', status: 'evaluated', count: 5, query: { duplicate: 'hostname' }, findings: [] },
        ],
        source_evidence: { source_fresh: true, source_status: 'completed', source_completed_at: '2026-09-01T00:00:00Z', as_of: '2026-09-01T00:00:00Z' },
        uci_captured_at: null,
      },
      '/api/cmdb/netskope/observed-policies': {
        // NSK-POL-001: observed-only policies, still used by the Métricas policy widget.
        configured: true,
        windows: [],
      },
      '/api/cmdb/netskope/dlp/policies': {
        configured: true, window_days: 30, captured_at: '2026-09-25T00:00:00Z', partial: false,
        total_policies: 2, unnamed_alerts: 1,
        policies: [
          { policy: 'Policy A', alert_count: 4, last_7d: 3, previous_7d: 1, latest_event_at: '2026-09-24T00:00:00Z',
            by_severity: [{ key: 'High', count: 3 }, { key: 'Low', count: 1 }], by_action: [{ key: 'alert', count: 4 }] },
          { policy: 'Policy B', alert_count: 2, last_7d: 0, previous_7d: 2, latest_event_at: '2026-09-10T00:00:00Z',
            by_severity: [{ key: 'Low', count: 2 }], by_action: [{ key: 'block', count: 2 }] },
        ],
      },
      '/api/cmdb/netskope/dlp/status': {
        configured: true, captured_at: '2026-09-25T00:00:00Z',
        coverage_start: '2026-08-26T00:00:00Z', coverage_end: '2026-09-25T00:00:00Z',
        partial: false, scanned_events: 25, captured_alerts: 19,
      },
      '/api/cmdb/netskope/investigations': {
        rows: [
          { incident_id: '7', event_timestamp: '2026-09-24T00:00:00Z', status: 'open', severity: 'High', policy: 'Policy A', action: 'alert', user_id: 'u-1', user: { object_id: 8, display_name: 'Ada', email: 'ada@example.test' } },
          { incident_id: '8', event_timestamp: '2026-09-23T00:00:00Z', status: 'open', severity: 'High', policy: 'Policy A', action: 'alert', user_id: 'ghost', user: null },
        ],
        total: 2, limit: 50, offset: 0,
        severity: '', status: '', action: '', policy: '', resolution: '', user_id: '',
      },
      '/api/dashboard/netskope/preferences': { data_widgets: ['users_total', 'devices_total'], chart_widgets: ['devices_by_os'], is_default: true },
      '/api/cmdb/netskope/devices/facets': {
        os: [{ key: 'Windows', count: 1 }, { key: 'Mac OS X', count: 3 }], client_version: [{ key: '110.0.1', count: 1 }],
        classification_status: [{ key: 'managed', count: 1 }], user_status: [{ key: 'enabled', count: 1 }, { key: 'Sin dato', count: 2 }],
        company: [{ key: 'EXAMPLE', count: 1 }],
      },
      '/api/cmdb/netskope/devices/freshness': {
        thresholds: { recent_hours: 24, week_days: 7, stale_days: 30 }, total: 10, review_candidates: 4,
        source_evidence: { source_fresh: true, source_status: 'completed', source_completed_at: '2026-10-05T11:00:00Z', as_of: '2026-10-05T12:00:00Z' },
        buckets: [
          { key: 'lt_24h', label: 'Menos de 24 h', count: 5, by_classification: [] },
          { key: 'd1_7', label: '1 a 7 días', count: 1, by_classification: [] },
          { key: 'd7_30', label: '7 a 30 días', count: 0, by_classification: [] },
          { key: 'gt_30d', label: 'Más de 30 días', count: 4, by_classification: [] },
          { key: 'unknown', label: 'Sin dato', count: 0, by_classification: [] },
        ],
      },
      '/api/cmdb/netskope/device-reviews/summary': {
        candidates: 4, unclassified: 3, open_incidents: 2, expired_exceptions: 1, reported_again: 0,
        suggestions: [{ key: 'uninstalled_reported', count: 1 }, { key: 'replaced', count: 0 }, { key: 'historical_record', count: 2 }],
        historical_days: 180,
        source_evidence: { source_fresh: true, source_status: 'completed', source_completed_at: '2026-10-05T11:00:00Z', as_of: '2026-10-05T12:00:00Z' },
        buckets: [
          { key: 'undetermined', count: 3 }, { key: 'uninstalled_reported', count: 0 }, { key: 'replaced', count: 0 },
          { key: 'decommissioned', count: 0 }, { key: 'in_use_not_reporting', count: 0 }, { key: 'historical_record', count: 1 },
          { key: 'temporary_exception', count: 0 },
        ],
      },
      '/api/cmdb/netskope/devices/client-events': {
        total: 10, coverage_risk_total: 3, coverage_risk_events: ['Uninstalled', 'Disconnected By Uninstall', 'Admin Disabled'],
        events: [
          { key: 'Tunnel Down', count: 5, coverage_risk: false }, { key: 'Tunnel Up', count: 2, coverage_risk: false },
          { key: 'Disconnected By Uninstall', count: 2, coverage_risk: true }, { key: 'Admin Disabled', count: 1, coverage_risk: true },
        ],
      },
      '/api/cmdb/netskope/devices/changes': {
        available: true, completed_runs: 2,
        latest_run: { source_run_id: 'run-netskope-2', captured_at: '2026-09-22T00:00:00Z', position: 1, devices: 10 },
        previous_run: { source_run_id: 'run-netskope-1', captured_at: '2026-09-21T00:00:00Z', position: 2, devices: 10 },
        counts: { added: 1, removed: 2, upgraded: 3, downgraded: 0, version_changed: 0, os_changed: 1, classification_changed: 0 },
        samples: {
          added: [], upgraded: [], downgraded: [], version_changed: [], os_changed: [], classification_changed: [],
          removed: [{ device_id: 'gone-1', hostname: 'LAPTOP-GONE-1', before_value: '138.1.12.2776', after_value: null }, { device_id: 'gone-2', hostname: null, before_value: null, after_value: null }],
        },
      },
      '/api/cmdb/netskope/devices/client-compliance': {
        configured: true, total: 10,
        baseline: { value: { releases: ['141.0.0', '138.1.0', '135.0.0'] }, note: 'Doc oficial', updated_by: 'ada@example.com', updated_at: '2026-09-20T00:00:00Z' },
        buckets: [
          { key: 'current', label: 'Al día', count: 6 }, { key: 'one_behind', label: '1 golden atrás', count: 2 },
          { key: 'two_plus_behind', label: '2 o más golden atrás', count: 1 }, { key: 'unrecognized', label: 'Versión no reconocida', count: 1 },
        ],
        by_os: [{ os: 'Windows', total: 7, current: 4, one_behind: 2, two_plus_behind: 1, unrecognized: 0 }, { os: 'Mac', total: 3, current: 2, one_behind: 0, two_plus_behind: 0, unrecognized: 1 }],
      },
      '/api/cmdb/netskope/devices/fleet-groups': {
        group_by: 'company', client_baseline: true, os_baseline: false, omitted_groups: 0, omitted_devices: 0,
        summary: { devices: 10, signal_24h: 5, client_current: 6, client_evaluated: 9, os_supported: 0, os_evaluated: 0, on_prem: 3, location_reported: 8 },
        groups: [
          { key: 'EXAMPLE', devices: 7, signal_24h: 4, client_current: 5, client_evaluated: 7, os_supported: 0, os_evaluated: 0, on_prem: 3, location_reported: 6 },
          { key: 'OTRA', devices: 3, signal_24h: 1, client_current: 1, client_evaluated: 2, os_supported: 0, os_evaluated: 0, on_prem: 0, location_reported: 2 },
        ],
      },
      '/api/cmdb/netskope/devices/fleet': {
        total: 10,
        by_make: [{ key: 'HP', count: 6 }, { key: 'Hewlett-Packard', count: 1 }, { key: 'Apple', count: 3 }],
        by_model: [{ key: 'HP ProBook 450', count: 6 }, { key: 'Mac16,12', count: 3 }],
        by_company: [{ key: 'EXAMPLE', count: 10 }],
        by_os_version: [{ os: 'Windows', os_version: '11.0.26200', count: 7 }, { os: 'Mac', os_version: '26.6.2', count: 3 }],
        os_compliance: null,
      },
      '/api/netskope/baselines': {
        client_golden_releases: { value: { releases: ['141.0.0', '138.1.0', '135.0.0'] }, note: 'Doc oficial', updated_by: 'ada@example.com', updated_at: '2026-09-20T00:00:00Z' },
        os_minimum_versions: null,
      },
      '/api/cmdb/netskope/devices/duplicates': {
        hostname: { groups: 2, devices: 5, largest: 3, top: [{ key: 'NB-100', devices: 3, distinct_other: 2, last_seen_at: '2026-09-22T00:00:00Z' }, { key: 'NB-200', devices: 2, distinct_other: 1, last_seen_at: null }] },
        username: { groups: 1, devices: 4, largest: 4, top: [{ key: 'shared@example.com', devices: 4, distinct_other: 4, last_seen_at: null }] },
      },
      '/api/cmdb/netskope/devices': { rows: [
        { object_id: 501, display_name: 'LAPTOP-QA-01', source_id: 'device-501', attributes: {
          hostname: 'LAPTOP-QA-01', device_make: 'Dell', device_model: 'Latitude 5420', os: 'Windows', os_version: '11',
          client_version: '110.0.1', guid: 'guid-501-abc', heartbeat: true, username: 'qa.user@example.com',
          user_key: 'ukey-501', user_status: 'enabled', classification_status: 'managed',
          last_seen_event: 'connect', last_event_timestamp: 1758000000,
        }, first_seen_at: '2026-01-01T00:00:00Z', last_seen_at: '2026-09-01T00:00:00Z',
        device_evidence: {
          state: 'unknown', reason: 'Sin sincronización Netskope completa y vigente en las últimas 24 h; no se evalúa abandono.',
          last_signal_at: '2025-09-16T05:20:00Z', age_days: 379,
          source_fresh: false, source_status: 'completed', source_completed_at: '2026-09-01T00:00:00Z', as_of: '2026-10-01T00:00:00Z',
          recent_days: 7, review_days: 30, source_freshness_hours: 24,
          client_version: '110.0.1', os: 'Windows', os_version: '11', last_seen_event: 'connect',
        } },
      ], total: 1, limit: 50, offset: 0, search: '' },
      '/api/cmdb/netskope/devices/device-501/history': { device_id: 'device-501', snapshots: [
        { snapshot_id: 2, source_run_id: 'run-netskope-2', captured_at: '2026-09-01T00:00:00Z', attributes: {
          client_version: '110.0.1', os: 'Windows', os_version: '11', classification_status: 'managed', last_seen_event: 'connect',
        } },
        { snapshot_id: 1, source_run_id: 'run-netskope-1', captured_at: '2026-08-01T00:00:00Z', attributes: {
          client_version: '109.0.0', os: 'Windows', os_version: '10', classification_status: 'unmanaged', last_seen_event: 'disconnect',
        } },
      ] },
      '/api/cmdb/netskope/users': { rows: [
        { object_id: 601, display_name: 'QA User', source_id: 'user-601', attributes: { email: 'qa.user@example.com' },
          first_seen_at: '2026-01-01T00:00:00Z', last_seen_at: '2026-09-01T00:00:00Z' },
      ], total: 1, limit: 50, offset: 0, search: '' },
      '/api/lifecycle/retired': { rows: [], total: 0, deletion_enabled: false },
      '/api/analytics/concentration': { users: [], roles: [], totals: { users: 0, roles: 0, safes: 0 } },
      '/api/analytics/executive': {
        connection_coverage: {
          totals: { total: 12, both: 7, pam_only: 2, sia_only: 1, none: 2, zsp_implemented: 9, zsp_pending: 2, zsp_unknown: 1 },
          by_environment: [{ environment: 'PROD', total: 8, both: 5, pam_only: 1, sia_only: 1, none: 1, zsp_implemented: 6, zsp_pending: 1, zsp_unknown: 1 }, { environment: 'DEV', total: 4, both: 2, pam_only: 1, sia_only: 0, none: 1, zsp_implemented: 3, zsp_pending: 1, zsp_unknown: 0 }],
          import: { import_id: 'batch-1', file_name: 'conexiones.csv', row_count: 12, imported_at: '2026-08-29T00:00:00Z' },
        },
        access_concentration: { users: [{ name: 'alberto@itti.digital', safe_count: 9 }], roles: [], totals: { users: 1, roles: 0, safes: 9 } },
      },
      '/api/analytics/freshness': {
        safes: 1, last_mod_unknown: 0, last_mod_30d: 1, last_mod_90d: 0,
        last_mod_365d: 0, last_mod_over_year: 0, safes_without_accounts: 0,
        accounts_active: 1, accounts_retired: 0, accounts_not_seen_30d: 0,
      },
      '/api/analytics/license-reconciliation': {
        totals: { standard_users: 47, reconciled_users: 47, only_user_type: 0, only_role_members: 0, confirmed: true },
        rows: [{ object_id: 8, display_name: 'Ada', source_id: 'u-8', user_id: '12', license_roles: ['Privilege Cloud Users'], okta_groups: [] }],
      },
      '/api/analytics/account-platform-coverage': {
        accounts_active: 3, accounts_with_platform: 3, accounts_without_platform: 0,
        accounts_with_partial_platform: 0, platforms_observed: 1, safes_without_accounts: 0,
      },
      '/api/analytics/account-management': {
        accounts_active: 3, automatic_enabled: 1, automatic_disabled: 1, management_unknown: 1,
        status_success: 1, status_failure: 1, status_in_process: 0, status_unknown: 1,
        changed_30d: 1, changed_90d: 1, changed_365d: 0, changed_older: 0, changed_unknown: 1,
      },
      '/api/ingestion/runs': { rows: [] },
      '/api/events': { rows: [] },
      '/api/workspaces/preferences': { visible_workspaces: ['safes'], hidden_workspaces: [], recent_workspaces: [], updated_at: null },
      '/api/search': {
        query: 'Fin',
        groups: {
          safes: [{ type: 'safe', label: 'Finance', detail: 'Finance', workspace: 'safes', target: 1, query: 'Fin' }],
          accounts: [{ type: 'account', label: 'db-finance', detail: 'Safe: Finance', workspace: 'safes', target: 1, query: 'Fin' }],
          pam_users: [{ type: 'pam_user', label: 'Ada PAM', detail: 'PAM user', workspace: 'graph', target: 3, query: 'Fin' }],
          pam_roles: [{ type: 'pam_role', label: 'Finance operators', detail: 'PAM role', workspace: 'roles', target: 4, query: 'Fin' }],
          sia_policies: [{ type: 'sia_policy', label: 'Finance access', detail: 'active', workspace: 'sia', target: 5, query: 'Fin' }],
          identity_users: [{ type: 'identity_user', label: 'Ada Lovelace', detail: 'ada@example.test', workspace: 'identity', target: 6, query: 'Fin' }],
          identity_roles: [],
          connections: [{ type: 'connection', label: 'db-finance-01', detail: '10.0.0.1 · PROD', workspace: 'assets', target: 8, query: 'Fin' }],
        },
      },
      '/api/activity': {
        rows: [
          { audit_id: 13, actor_id: 'system:scheduler', actor_name: 'system:scheduler', action: 'sync_complete', entity_type: 'ingestion_run', entity_id: 'run-1', entity_name: 'cyberark', before_data: null, after_data: { source_system: 'cyberark', status: 'completed', received_objects: 4, received_relationships: 9, error_count: 0 }, created_at: '2026-08-29T01:00:00Z' },
          { audit_id: 12, actor_id: 'operator-1', actor_name: 'Operador', action: 'update', entity_type: 'safe_metadata', entity_id: '1', entity_name: 'Finance', before_data: { workflow_status: 'pending' }, after_data: { workflow_status: 'in_progress' }, created_at: '2026-08-29T00:00:00Z' },
        ],
        total: 2,
      },
      '/api/operational-logs': { rows: [], total: 0 },
      '/api/operational-errors': { rows: [], total: 0 },
      '/api/safes': includeSafe ? { rows: [{ safe_number: 1, safe_name: 'Finance', safe_url_id: 'Finance', location: null, member_count: 1, account_count: 2, cpm_configured: true, olac_enabled: true, retention_configured: true, manage_safe_principal_count: 1, account_type_counts: {}, internal_name: null, business_unit_id: null, responsible_id: null, classification_status: 'pending', inventory_scope: 'pending', data_quality_status: 'pending', scope_hint: null, business_unit_name: null, responsible_name: null, workflow_status: 'pending', next_action: decommissionCandidate ? 'Dar de baja' : null }], total: 1, classification_counts: { assigned: 0, review: 0, pending: 1 }, limit: 50, offset: 0 } : { rows: [], total: 0, classification_counts: { assigned: 0, review: 0, pending: 0 }, limit: 50, offset: 0 },
      '/api/safes/1': includeSafe ? { safe: { safe_number: 1, safe_name: 'Finance', safe_url_id: 'Finance', location: null, member_count: 1, account_count: 2, cpm_configured: true, olac_enabled: true, retention_configured: true, manage_safe_principal_count: 1, account_type_counts: {}, internal_name: null, business_unit_id: null, responsible_id: null, classification_status: 'pending', inventory_scope: 'pending', data_quality_status: 'pending', scope_hint: null, business_unit_name: null, responsible_name: null, workflow_status: 'pending', next_action: null, creator_name: 'System', description: null, managing_cpm: 'CPM', number_of_versions_retention: 5, number_of_days_retention: 30, auto_purge_enabled: true, creation_time: null, last_modification_time: null, notes: null, assigned_at: null, assigned_by: null }, members: [{ member_id: 'member-1', member_name: 'Ada Admin', member_type: 'User', membership_expiration_date: null, is_predefined_user: false, is_read_only: false, permissions: { read: true } }] } : {},
       '/api/safes/1/accounts': includeSafe ? { rows: [
         { safe_number: 1, safe_name: 'Finance', account_id: 'account-1', account_name: 'db-finance', user_name: 'dbadmin', address: '10.0.0.1', platform_id: 'platform-1', platform_name: 'PostgreSQL', lifecycle_status: 'active', last_seen_at: '2026-08-29T00:00:00Z', attributes: { automatic_management_enabled: true, management_status: 'success', secret_modified_at: '2026-09-29T00:00:00Z' } },
         { safe_number: 1, safe_name: 'Finance', account_id: 'account-2', account_name: 'svc-jobs', user_name: 'batch', address: '10.0.0.2', platform_id: 'platform-1', platform_name: 'PostgreSQL', lifecycle_status: 'active', last_seen_at: '2026-08-29T00:00:00Z', attributes: { automatic_management_enabled: false, management_status: 'failure', secret_modified_at: '2026-08-01T00:00:00Z' } },
         { safe_number: 1, safe_name: 'Finance', account_id: 'account-3', account_name: 'svc-legacy', user_name: null, address: null, platform_id: null, platform_name: null, lifecycle_status: 'active', last_seen_at: '2026-08-29T00:00:00Z', attributes: { automatic_management_enabled: null, management_status: null, secret_modified_at: null } },
       ], total: 3, limit: 200, offset: 0 } : {},
      '/api/safes/1/audit': includeSafe ? { rows: [] } : {},
      '/api/accounts': { rows: [], total: 0, limit: 50, offset: 0 },
      '/api/analytics': { workflow_status: [{ key: 'pending', count: 1 }, { key: 'retired', count: 1 }], next_actions: [{ key: 'Sin definir', count: 1 }], account_types: [], business_units: [{ key: 'unassigned', label: 'Sin unidad', count: 1 }], responsibles: [{ key: 'unassigned', label: 'Sin responsable', count: 1 }] },
      '/api/findings': {
        rows: [{
          finding_id: 1,
          rule_id: 'ACCOUNT_PLATFORM_MISSING',
          rule_version: '1',
          source_system: 'cyberark',
          subject_type: 'account',
          subject_id: 'account-24',
          title: 'Cuenta sin plataforma informada',
          severity: 'medium',
          category: 'data_quality',
          status: 'open',
          evidence: { account_id: 'account-24', account_name: 'svc-finance', safe_number: 24, safe_name: 'Finance', condition: 'platform_not_informed' },
          source_run_id: null,
          first_detected_at: '2026-08-28T00:00:00Z',
          last_detected_at: '2026-08-29T00:00:00Z',
          resolved_at: null,
          exception_reason: null,
          exception_until: null,
          updated_at: '2026-08-29T00:00:00Z',
        }],
        total: 1,
        limit: 50,
        offset: 0,
      },
      '/api/cmdb/pam-roles': {
        rows: [{ object_id: 7, display_name: 'Operations', source_id: '42', attributes: {}, member_count: 1, safe_count: 1, account_count: 2, sia_reference_count: 1, role_examples: [{ object_id: 7, display_name: 'Operations', source_id: '42' }] }],
        total: 1, limit: 50, offset: 0,
      },
      '/api/cmdb/pam-roles/7': {
        role: { object_id: 7, display_name: 'Operations', source_id: '42', attributes: {}, member_count: 1, safe_count: 1, account_count: 2, sia_reference_count: 1, first_seen_at: '2026-08-01T00:00:00Z', last_seen_at: '2026-08-29T00:00:00Z' },
        users: [{ object_id: 8, display_name: 'Ada', source_id: 'u-8' }],
        safes: [{ object_id: 9, display_name: 'Finance', source_id: 'FIN', account_count: 2 }],
        sia_references: [{ object_id: 20, display_name: 'Finance access', source_id: 'p-20', attributes: { status: 'Enabled', description: '', platforms: [], rule_names: [], policy_type: '', granted_users: [], granted_groups: [], granted_roles: ['Operations'] } }],
        sia_match_type: 'display_name_reference_only',
      },
      '/api/cmdb/identity-users': {
        rows: [{ object_id: 31, display_name: 'Ada Identity', source_id: 'identity-ada', attributes: { user_name: 'ada@example.com', email: 'ada@itti.digital', active: true, service_user: false, oauth_client: false, last_login_date: '', last_modified: '2026-09-09T00:00:00Z' }, role_count: 1, standard_seat_reconciled: true, federation_resolution: { status: 'matched', match_basis: 'email_domain_rule', email_domain: 'itti.digital', federation_code: 'okta_itti', expected_name: 'Okta ITTI', object_id: 63, source_id: 'fed-1', display_name: 'Okta-ITTI', active: true } }],
        total: 1, limit: 50, offset: 0,
      },
      '/api/cmdb/identity-roles': {
        rows: [{ object_id: 32, display_name: 'global auditor', source_id: 'global_auditor', attributes: { last_modified: '2026-09-09T00:00:00Z' }, member_count: 1 }],
        total: 1, limit: 50, offset: 0,
      },
      '/api/cmdb/identity-users/31': {
        user: { object_id: 31, display_name: 'Ada Identity', source_id: 'identity-ada', attributes: { user_name: 'ada@example.com', email: 'ada@itti.digital', active: true, service_user: false, oauth_client: false, last_login_date: '', last_modified: '2026-09-09T00:00:00Z' }, role_count: 1, standard_seat_reconciled: true, first_seen_at: '2026-09-09T00:00:00Z', last_seen_at: '2026-09-09T00:00:00Z', federation_resolution: { status: 'matched', match_basis: 'email_domain_rule', email_domain: 'itti.digital', federation_code: 'okta_itti', expected_name: 'Okta ITTI', object_id: 63, source_id: 'fed-1', display_name: 'Okta-ITTI', active: true } },
        roles: [{ object_id: 32, display_name: 'global auditor', source_id: 'global_auditor' }],
      },
      '/api/cmdb/identity-roles/32': {
        role: { object_id: 32, display_name: 'global auditor', source_id: 'global_auditor', attributes: { last_modified: '2026-09-09T00:00:00Z' }, member_count: 1, first_seen_at: '2026-09-09T00:00:00Z', last_seen_at: '2026-09-09T00:00:00Z' },
        members: [{ object_id: 31, display_name: 'Ada Identity', source_id: 'identity-ada' }],
      },
      '/api/cmdb/pam-users': {
        rows: [{ object_id: 8, display_name: 'Ada', source_id: 'u-8', role_count: 9, standard_seat_reconciled: true, enabled: true, suspended: false }],
        total: 1, limit: 50, offset: 0, search: '',
      },
      '/api/cmdb/pam-users/8/chain': {
        matched: true,
        pam_user: { object_id: 8, display_name: 'Ada', source_id: 'u-8' },
        roles: [{
          object_id: 7, display_name: 'Operations', source_id: '42', safe_count: 5,
          safes: [{
            object_id: 9, display_name: 'Finance', safe_number: 'FIN', account_count: 2,
            platform_count: 1,
            platforms: [{
              object_id: 10, display_name: 'Unix', source_id: 'Unix',
              psms: [{ object_id: 11, display_name: 'PSM-01', source_id: 'psm-1' }],
            }],
          }, {
            object_id: 12, display_name: 'Treasury', safe_number: 'TRE', account_count: 1,
            platform_count: 1,
            platforms: [{
              object_id: 10, display_name: 'Unix', source_id: 'Unix',
              psms: [{ object_id: 11, display_name: 'PSM-01', source_id: 'psm-1' }],
            }],
          }, {
            object_id: 13, display_name: 'Audit', safe_number: 'AUD', account_count: 1, platform_count: 0, platforms: [],
          }, {
            object_id: 14, display_name: 'Payroll', safe_number: 'PAY', account_count: 1, platform_count: 0, platforms: [],
          }, {
            object_id: 15, display_name: 'Vault', safe_number: 'VLT', account_count: 1, platform_count: 0, platforms: [],
          }],
        }, ...Array.from({ length: 8 }, (_, index) => ({
          object_id: 100 + index,
          display_name: `Role ${index + 2}`,
          source_id: `role-${index + 2}`,
          safe_count: 0,
          safes: [],
        }))],
        roles_omitted: 0,
        totals: { roles: 9, safes: 5, platforms: 1, psms: 1, accounts: 6 },
      },
      '/api/cmdb/pam-platforms': {
        rows: [{ object_id: 10, display_name: 'Unix', source_id: 'Unix', system_type: 'Unix', active: true, allowed_safes_pattern: '^Unix-', safe_count: 1, account_count: 2, psms: [{ object_id: 11, display_name: 'PSM-01', source_id: 'psm-1' }] }],
        total: 1, limit: 100, offset: 0, search: '',
      },
      '/api/cmdb/pam-connectors': {
        rows: [{ object_id: 11, display_name: 'PSM-01', source_id: 'psm-1', address: '10.0.0.1', platform_count: 1, platforms: [{ object_id: 10, display_name: 'Unix', source_id: 'Unix' }] }],
        total: 1, limit: 100, offset: 0, search: '',
      },
      '/api/cmdb/pam-platform-catalogs': {
        dependents: [], groups: [], rotational_groups: [],
      },
      '/api/cmdb/pam-platform-targets': { rows: [], total: 0, limit: 100, offset: 0, search: '' },
      '/api/cmdb/pam-psm-connector-types': { rows: [], total: 0, limit: 100, offset: 0, search: '' },
      '/api/cmdb/pam-components': {
        rows: [{ object_id: 30, display_name: 'PVWA', source_id: 'PVWA', description: 'Portal', total_count: 2, connected_count: 1, instance_versions: ['14.9.2'], latest_logon_at: 1789045249, all_instances_logged_on: false }],
      },
      '/api/cmdb/access-assets': {
        rows: [{
          object_id: 50, display_name: '509_3', source_id: '509_3',
          attributes: {
            access_method: 'RDP', asset_category: 'server', asset_type: 'windows',
            platform_type: 'Windows', platform_subtype: 'Domain', protocol: 'rdp',
            workflow_status: 'active', is_favorite: true, connection_components: ['PSM-RDP'],
            port: 3389, platform_id: '10',
          },
          platform_name: 'Unix',
        }],
        total: 1, limit: 100, offset: 0, search: '', asset_type: '',
      },
      '/api/cmdb/sia-connectors': {
        rows: [{
          object_id: 60, display_name: 'connector-1', source_id: 'connector-1',
          attributes: {
            status: 'connected', status_code: 'OK', version: '14.2', is_latest_version: true,
            os: 'linux', host_type: 'onprem', region: 'us-east-1', workspace_id: 'ws1', active_sessions_count: 2,
          },
        }],
        total: 1, limit: 100, offset: 0, search: '',
      },
      '/api/cmdb/sia-resources': {
        rows: [{
          object_id: 61, display_name: 'web-01', source_id: 'vm1',
          attributes: {
            resource_type: 'virtual_machine', os_type: 'linux', location_type: 'cloud',
            discovery_engine: 'aws', scanned_on: '2026-09-01T00:00:00Z',
          },
        }],
        total: 1, limit: 100, offset: 0, search: '', resource_type: '',
      },
      '/api/cmdb/sia-database-accounts': {
        rows: [{
          object_id: 62, display_name: 'app-db-account', source_id: 'db1',
          attributes: {
            store_type: 'mysql', platform: 'MySQL', port: 3306, database: 'app',
            created_at: '2026-09-01T00:00:00Z', modified_at: '2026-09-02T00:00:00Z',
          },
        }],
        total: 1, limit: 100, offset: 0, search: '',
      },
      '/api/cmdb/sia-target-sets': {
        rows: [{
          object_id: 64, display_name: 'Linux target set', source_id: 'target-set-1',
          attributes: {
            target_type: 'Linux', description: 'Strong target set',
            provisioning_format: 'JSON', certificate_validation: true,
          },
        }],
        total: 1, limit: 100, offset: 0, search: '',
      },
      '/api/cmdb/identity-federations': {
        rows: [{
          object_id: 63, display_name: 'Okta-ITTI', source_id: 'fed-1',
          attributes: { federation_type: 'SAML', active: true, role: 'idp', usage: 'sso' },
        }],
        total: 1, limit: 100, offset: 0, search: '',
      },
      '/api/cmdb/sia-policies': {
        rows: [{ object_id: 20, display_name: 'Finance access', source_id: 'policy-20', attributes: { status: 'Enabled', description: 'Acceso a bases Finance', platforms: ['OnPrem'], rule_names: ['ip rules'], policy_type: 'DB', ip_rules: ['10.67.10.186'], fqdn_rules: [], logical_names: [], granted_users: [], granted_groups: [], granted_roles: ['Operations'] } }],
        total: 1, limit: 50, offset: 0,
      },
      '/api/connection-inventory/progress': {
        current: {
          total: { n: 51, platform: { match: 45, missing: 2, undeclared: 1, unclassified: 0, unknown: 3 }, dba: { match: 38, missing: 8, undeclared: 5, unclassified: 0, unknown: 0 }, work: { pending: 30, in_progress: 10, onboarded: 8, blocked: 2, not_applicable: 1 } },
          by_environment: [
            { environment: 'PROD', n: 30, platform: { match: 28, missing: 1, undeclared: 0, unclassified: 0, unknown: 1 }, dba: { match: 22, missing: 5, undeclared: 3, unclassified: 0, unknown: 0 }, work: { pending: 20, in_progress: 5, onboarded: 4, blocked: 1, not_applicable: 0 } },
            { environment: 'DEV', n: 21, platform: { match: 17, missing: 1, undeclared: 1, unclassified: 0, unknown: 2 }, dba: { match: 16, missing: 3, undeclared: 2, unclassified: 0, unknown: 0 }, work: { pending: 10, in_progress: 5, onboarded: 4, blocked: 1, not_applicable: 1 } },
          ],
          by_responsible: [
            { responsible: 'Ana', n: 21, platform: { match: 17, missing: 1, undeclared: 1, unclassified: 0, unknown: 2 }, dba: { match: 16, missing: 3, undeclared: 2, unclassified: 0, unknown: 0 }, work: { pending: 10, in_progress: 5, onboarded: 4, blocked: 1, not_applicable: 1 } },
            { responsible: 'Sin responsable', n: 30, platform: { match: 28, missing: 1, undeclared: 0, unclassified: 0, unknown: 1 }, dba: { match: 22, missing: 5, undeclared: 3, unclassified: 0, unknown: 0 }, work: { pending: 20, in_progress: 5, onboarded: 4, blocked: 1, not_applicable: 0 } },
          ],
        },
        series: [
          { snapshot_date: '2026-09-30', captured_at: '2026-09-30T12:00:00Z', n: 51, platform: { match: 40, missing: 5, undeclared: 1, unclassified: 2, unknown: 3 }, dba: { match: 30, missing: 10, undeclared: 5, unclassified: 6, unknown: 0 }, work: { pending: 45, in_progress: 4, onboarded: 2, blocked: 0, not_applicable: 0 } },
          { snapshot_date: '2026-10-07', captured_at: '2026-10-07T12:00:00Z', n: 51, platform: { match: 43, missing: 3, undeclared: 1, unclassified: 1, unknown: 3 }, dba: { match: 35, missing: 9, undeclared: 5, unclassified: 2, unknown: 0 }, work: { pending: 38, in_progress: 8, onboarded: 5, blocked: 0, not_applicable: 0 } },
        ],
      },
      '/api/connection-inventory/uninventoried': {
        total: 3,
        rows: [
          { address: '10.67.9.200', pam_accounts: 2, pam_safes: 1, sia_policies: 1, sia_policy_names: ['Politica-DEV-OCI-Platform'] },
          { address: '10.67.9.201', pam_accounts: 0, pam_safes: 0, sia_policies: 2, sia_policy_names: ['Politica-A', 'Politica-B'] },
        ],
      },
      '/api/connection-inventory/stale': {
        days: 14, total: 3,
        rows: [
          { inventory_id: 101, instance_name: 'dev-compute-db-desa', environment: 'DEV', private_ip: '10.67.9.143', port: 22, work_status: 'blocked', responsible: 'Ana', last_change: '2026-08-20T12:00:00Z', idle_since: '2026-08-20T12:00:00Z', idle_days: 56 },
          { inventory_id: 102, instance_name: 'prod-app-01', environment: 'PROD', private_ip: '10.67.1.10', port: null, work_status: 'pending', responsible: 'Sin responsable', last_change: null, idle_since: '2026-09-01T12:00:00Z', idle_days: 44 },
        ],
      },
      '/api/connection-inventory/deviations': {
        platform: { match: 1, missing: 0, undeclared: 0, unclassified: 0, unknown: 0 },
        dba: { match: 0, missing: 1, undeclared: 0, unclassified: 0, unknown: 0 },
        policies: { total: 3, classified: 1 },
        work: { pending: 1, in_progress: 0, onboarded: 0, blocked: 0, not_applicable: 0 },
        responsibles: [{ responsible: 'Ana', total: 1 }],
      },
      '/api/connection-inventory/101/history': {
        rows: [{ actor_id: 'operator-1', action: 'update', before_data: { work_status: 'pending' }, after_data: { work_status: 'in_progress' }, created_at: '2026-10-14T12:00:00Z' }],
      },
      '/api/connection-inventory/sia-policies': {
        rows: [
          { source_id: 'policy-20', display_name: 'Politica-DEV-OCI-Platform', status: 'Enabled', capability: 'platform', suggested: 'platform', destinations: 1, classified_by: 'operator-1', classified_at: '2026-10-14T00:00:00Z' },
          { source_id: 'policy-21', display_name: 'Politica-DEV-OCI-DBA', status: 'Enabled', capability: null, suggested: 'dba', destinations: 1, classified_by: null, classified_at: null },
          { source_id: 'policy-22', display_name: 'Fideicomiso_ZSP-SSH', status: 'Enabled', capability: null, suggested: null, destinations: 0, classified_by: null, classified_at: null },
        ],
      },
      '/api/connection-inventory': {
        rows: [{ inventory_id: 101, lifecycle_status: 'active', retired_at: null, platform_result: 'match', dba_result: 'missing', work_status: 'pending', responsible: 'Ana', note: 'Ventana el viernes', source_row_number: 2, instance_name: 'dev-compute-db-desa', environment: 'DEV', private_ip: '10.67.9.143', port: 22, ca_sia: true, ca_dba: true, zsp_implemented: true, access_available: true, description: 'Migrada desde Priv Cloud', import_id: 'batch-1', file_name: 'conexiones.csv', row_count: 1, imported_at: '2026-08-29T00:00:00Z', safe_matches: [{ safe_number: 1, safe_name: 'Finance', account_id: 'account-1', account_name: 'dbadmin', address: '10.67.9.143', platform_name: 'Unix', platform_id: 'unix' }], sia_matches: [{ object_id: 20, display_name: 'Finance access', source_id: 'policy-20' }], safe_match_count: 1, sia_match_count: 1 }],
        total: 1, limit: 50, offset: 0, search: '', import: { import_id: 'batch-1', file_name: 'conexiones.csv', row_count: 1, imported_at: '2026-08-29T00:00:00Z' },
      },
    };
    let responseBody = bodies[pathname] ?? {};
    const offset = Number(requestUrl.searchParams.get('offset') || 0);
    if (pathname === '/api/cmdb/identity-users/31/pam-chain') {
      responseBody = { ...(bodies['/api/cmdb/pam-users/8/chain'] as Record<string, unknown>), match_basis: 'email', status: 'matched' };
    }
    if (pathname === '/api/chains/pam/node') {
      const key = `${requestUrl.searchParams.get('type')}:${requestUrl.searchParams.get('id')}`;
      responseBody = CHAIN_NODES[key] ? { node: CHAIN_NODES[key] } : { detail: 'Nodo no encontrado' };
    }
    if (pathname === '/api/chains/pam/expand') {
      const key = `${requestUrl.searchParams.get('type')}:${requestUrl.searchParams.get('id')}:${requestUrl.searchParams.get('direction')}`;
      const all = CHAIN_HOPS[key] ?? [];
      // CHAIN-011: the backend narrows by literal substring on label/sublabel;
      // mirror it so the e2e sees the same filtered list and total.
      const query = (requestUrl.searchParams.get('q') ?? '').trim().toLowerCase();
      const rows = query
        ? all.filter((row) => `${row.label ?? ''} ${row.sublabel ?? ''}`.toLowerCase().includes(query))
        : all;
      responseBody = {
        type: requestUrl.searchParams.get('type'),
        id: Number(requestUrl.searchParams.get('id')),
        direction: requestUrl.searchParams.get('direction'),
        rows,
        total: rows.length,
        limit: 50,
        offset,
      };
    }
    if (pathname === '/api/chains/pam/search') {
      responseBody = { query: requestUrl.searchParams.get('q') ?? '', groups: CHAIN_SEARCH_GROUPS };
    }
    if (pathname === '/api/chains/netskope/node') {
      const key = `${requestUrl.searchParams.get('type')}:${requestUrl.searchParams.get('id')}`;
      responseBody = NETSKOPE_CHAIN_NODES[key] ? { node: NETSKOPE_CHAIN_NODES[key] } : { detail: 'Nodo no encontrado' };
    }
    if (pathname === '/api/chains/netskope/expand') {
      const key = `${requestUrl.searchParams.get('type')}:${requestUrl.searchParams.get('id')}:${requestUrl.searchParams.get('direction')}`;
      const all = NETSKOPE_CHAIN_HOPS[key] ?? [];
      const rows = all.slice(offset, offset + 50);
      responseBody = {
        type: requestUrl.searchParams.get('type'),
        id: Number(requestUrl.searchParams.get('id')),
        direction: requestUrl.searchParams.get('direction'),
        rows,
        total: all.length,
        limit: 50,
        offset,
      };
    }
    if (pathname === '/api/chains/netskope/search') {
      responseBody = { query: requestUrl.searchParams.get('q') ?? '', groups: NETSKOPE_CHAIN_SEARCH_GROUPS };
    }
    if (pathname === '/api/chains/person/search') {
      responseBody = { query: requestUrl.searchParams.get('q') ?? '', people: PERSON_SEARCH_RESULTS };
    }
    if (pathname === '/api/chains/person') {
      const email = requestUrl.searchParams.get('email') ?? '';
      responseBody = PERSON_SUMMARIES[email] ?? { email, name: '', tools: {} };
    }
    if (pathname === '/api/chains/person/coverage') {
      responseBody = PERSON_CLIENT_COVERAGE_SUMMARY;
    }
    if (pathname === '/api/chains/person/coverage/detail') {
      const email = requestUrl.searchParams.get('email') ?? '';
      responseBody = PERSON_CLIENT_COVERAGE_DETAILS[email] ?? {
        ...PERSON_CLIENT_COVERAGE_DETAILS['riesgo@itti.digital'], email,
      };
    }
    if (largeInventory && pathname === '/api/safes' && includeSafe) {
      const base = bodies[pathname] as { rows: Record<string, unknown>[]; total: number; limit: number; offset: number };
      responseBody = { ...base, total: 51, classification_counts: { assigned: 0, review: 1, pending: 50 }, offset, rows: offset === 0 ? base.rows : [{ ...base.rows[0], safe_number: 2, safe_name: 'Finance 2', safe_url_id: 'Finance 2', classification_status: 'review' }] };
    }
    if (largeInventory && pathname === '/api/cmdb/pam-roles') {
      const base = bodies[pathname] as { rows: Record<string, unknown>[]; total: number; limit: number; offset: number };
      responseBody = { ...base, total: 51, offset, rows: offset === 0 ? base.rows : [{ ...base.rows[0], object_id: 57, display_name: 'Operations 2', source_id: '92' }] };
    }
    if (largeInventory && pathname === '/api/cmdb/access-assets') {
      const base = bodies[pathname] as { rows: Record<string, unknown>[]; total: number; limit: number; offset: number };
      responseBody = { ...base, total: 101, offset, rows: offset === 0 ? base.rows : [{ ...base.rows[0], object_id: 51, display_name: '509_4', source_id: '509_4' }] };
    }
    if (largeInventory && pathname === '/api/cmdb/pam-platforms') {
      const base = bodies[pathname] as { rows: Record<string, unknown>[]; total: number; limit: number; offset: number };
      responseBody = { ...base, total: 101, offset, rows: offset === 0 ? base.rows : [{ ...base.rows[0], object_id: 51, display_name: 'Windows', source_id: 'Windows' }] };
    }
    if (pathname === '/api/cmdb/pam-roles' && requestUrl.searchParams.has('kind')) {
      const base = bodies[pathname] as { rows: Record<string, unknown>[]; total: number; limit: number; offset: number };
      const kind = requestUrl.searchParams.get('kind');
      const pagedRole = largeInventory && offset > 0 && (kind === 'cyberark_role' || kind === '');
      const displayName = kind === 'user' ? 'alberto@itti.digital' : kind === 'okta_group' ? 'sg_database_admins' : (pagedRole ? 'Operations 2' : 'Operations');
      const row = { ...base.rows[0], display_name: displayName, object_id: pagedRole ? 57 : base.rows[0].object_id };
      responseBody = { ...base, total: largeInventory ? 51 : base.total, offset, rows: [row] };
    }
    if (largeInventory && pathname === '/api/accounts') {
      const account = { safe_number: 1, safe_name: 'Finance', account_id: 'account-1', account_name: 'db-finance', user_name: 'dbadmin', address: '10.0.0.1', platform_id: 'platform-1', platform_name: 'PostgreSQL', lifecycle_status: 'active', last_seen_at: '2026-08-29T00:00:00Z', attributes: {} };
      const nextAccount = { ...account, safe_number: 2, safe_name: 'Finance 2', account_id: 'account-2', account_name: 'db-finance-2' };
      responseBody = { rows: [offset === 0 ? account : nextAccount], total: 51, limit: 50, offset };
    }
    if (pathname === '/api/dashboard/preferences' && route.request().method() === 'PUT') {
      const payload = route.request().postDataJSON() as { widgets: Record<string, unknown>[] };
      responseBody = { widgets: payload.widgets.map((widget) => ({
        ...widget,
        baseline_value: widget.kind === 'goal' ? 1 : null,
        value: 1,
        buckets: widget.kind === 'chart' ? [{ key: 'Finanzas', count: 5 }, { key: 'Sin unidad', count: 3 }] : undefined,
      })), is_default: false };
    }
    if (pathname === '/api/dashboard/netskope/preferences' && route.request().method() === 'PUT') {
      const payload = route.request().postDataJSON() as { widgets: Record<string, unknown>[] };
      responseBody = { widgets: payload.widgets, is_default: false };
    }
    if (pathname === '/api/dashboard/preferences/preview') {
      const payload = route.request().postDataJSON() as { widgets: Record<string, unknown>[] };
      responseBody = { widgets: payload.widgets.map((widget) => ({
        ...widget,
        value: widget.kind === 'chart' ? 8 : 1,
        buckets: widget.kind === 'chart' ? [{ key: 'Finanzas', count: 5 }, { key: 'Sin unidad', count: 3 }] : undefined,
      })) };
    }
    if (pathname === '/api/workspaces/preferences') {
      if (route.request().method() === 'PUT') {
        const payload = route.request().postDataJSON() as Partial<Omit<typeof workspacePreferences, 'updated_at'>>;
        const requestedIds = [
          ...(payload.visible_workspaces ?? []),
          ...(payload.hidden_workspaces ?? []),
          ...(payload.recent_workspaces ?? []),
        ];
        const unknown = requestedIds.find((id) => !WORKSPACE_PREFERENCE_ALLOWLIST.has(id));
        if (unknown) {
          await route.fulfill({
            status: 422,
            contentType: 'application/json',
            body: JSON.stringify({ detail: `Workspace desconocido: ${unknown}` }),
          });
          return;
        }
        workspacePreferences = { ...workspacePreferences, ...payload, updated_at: '2026-09-10T12:30:00Z' };
      }
      responseBody = workspacePreferences;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(responseBody),
    });
  });
}



/* Mirror of the backend's ALLOWED_WORKSPACES contract
   (backend/app/cross/api/routes/workspace_preferences.py). Keeping it explicit here
   makes a frontend/backend id drift fail the e2e suite: the PUT is rejected
   with 422 exactly like the real route. netskopeAlerts is intentionally
   absent (retired); netskopeInventory is the current destination. */
/* Mirrors the backend ALLOWED_WORKSPACES (workspace_preferences.py); keep it
   in sync with workspace-catalog.ts. */
const WORKSPACE_PREFERENCE_ALLOWLIST = new Set([
  'general', 'posture', 'graph', 'person', 'safes', 'roles', 'platforms', 'connectors', 'pamCleanup',
  'identityUsers', 'identityGroups', 'identityRoles', 'sia', 'identity', 'assets',
  'users', 'activity', 'help', 'pamHealth', 'siaConnectors',
   'siaResources', 'siaDatabaseAccounts', 'identityFederations', 'ipInventory',
  'netskope', 'netskopeOperations', 'netskopeChains', 'netskopeInventory', 'netskopeUsers', 'netskopeDevices',
  'netskopeDlp', 'netskopeDemSites', 'netskopeUci', 'netskopePosture', 'netskopeAdmins',
]);

// Audit cases exercise the application's stored theme, not only the browser's
// preferred color scheme. Other cases retain the product's default theme.
export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    if (testInfo.title.includes('UX-AUD2-')) {
      const theme = testInfo.project.use.colorScheme === 'light' ? 'light' : 'dark';
      await page.addInitScript((value) => localStorage.setItem('dshub-theme:v1', value), theme);
    }
    await use(page);
  },
});
export { expect };

/* Retired DLP surface. NSK-DLP-001 revived the user/incident routes for
   netskope:dlp_read, so only the per-device summary stays 410: the approved
   allowlist has no device field. A test that hits a retired path must get the
   same 410 the backend returns. */
export const RETIRED_DLP_PATHS = new Set([
  '/api/cmdb/netskope/devices/alerts/summary',
]);

/* Cadenas PAM fixtures: a tiny verified graph so the explorer e2e can expand
   one hop at a time and pivot without a real backend. */
export const CHAIN_NODES: Record<string, Record<string, unknown>> = {
  'user:8': { type: 'user', id: 8, label: 'Ada', sublabel: 'u-8', counts: { forward: 1, back: 0 } },
  /* Linked to an Identity person (exact email): shown as the person, with the PAM account inside. */
  'user:12': { type: 'user', id: 12, label: 'grace.hopper', sublabel: 'grace@itti.digital', counts: { forward: 1, back: 0 }, identity: { object_id: 41, display_name: 'Grace Hopper', email: 'grace@itti.digital', basis: 'email_exact' } },
  'role:7': { type: 'role', id: 7, label: 'Operations', sublabel: '42', counts: { forward: 2, back: 1 } },
  'safe:9': { type: 'safe', id: 9, label: 'Finance', sublabel: 'FIN', counts: { forward: 1, back: 1 } },
  'safe:10': { type: 'safe', id: 10, label: 'Treasury', sublabel: 'TRE', counts: { forward: 0, back: 1 } },
  'platform:4': { type: 'platform', id: 4, label: 'Unix', sublabel: 'Unix', counts: { forward: 1, back: 1 } },
  'psm:5': { type: 'psm', id: 5, label: 'PSM-01', sublabel: 'psm-1', counts: { forward: 0, back: 1 } },
};

export const CHAIN_HOPS: Record<string, Record<string, unknown>[]> = {
  'user:8:forward': [{ ...CHAIN_NODES['role:7'], relation: { kind: 'persisted', basis: 'user_has_role' } }],
  'user:12:forward': [{ ...CHAIN_NODES['role:7'], relation: { kind: 'persisted', basis: 'user_has_role' } }],
  'role:7:back': [
    { ...CHAIN_NODES['user:8'], relation: { kind: 'persisted', basis: 'user_has_role' } },
    { ...CHAIN_NODES['user:12'], relation: { kind: 'persisted', basis: 'user_has_role' } },
  ],
  'role:7:forward': [
    { ...CHAIN_NODES['safe:9'], relation: { kind: 'persisted', basis: 'role_grants_access' } },
    { ...CHAIN_NODES['safe:10'], relation: { kind: 'persisted', basis: 'role_grants_access' } },
  ],
  'safe:10:back': [{ ...CHAIN_NODES['role:7'], relation: { kind: 'persisted', basis: 'role_grants_access' } }],
  'safe:9:forward': [{ ...CHAIN_NODES['platform:4'], relation: { kind: 'persisted', basis: 'safe_uses_platform' } }],
  'safe:9:back': [{ ...CHAIN_NODES['role:7'], relation: { kind: 'persisted', basis: 'role_grants_access' } }],
  'platform:4:forward': [{ ...CHAIN_NODES['psm:5'], relation: { kind: 'persisted', basis: 'platform_uses_psm' } }],
  'platform:4:back': [{ ...CHAIN_NODES['safe:9'], relation: { kind: 'persisted', basis: 'safe_uses_platform' } }],
  'psm:5:back': [{ ...CHAIN_NODES['platform:4'], relation: { kind: 'persisted', basis: 'platform_uses_psm' } }],
};

export const NETSKOPE_CHAIN_NODES: Record<string, Record<string, unknown>> = {
  'netskope_user:3': { type: 'netskope_user', id: 3, label: 'Ada Netskope', sublabel: 'u-3', counts: { forward: 51, back: 0 } },
  'netskope_user:4': { type: 'netskope_user', id: 4, label: 'Usuario sin vínculo', sublabel: 'u-4', counts: { forward: 0, back: 0 } },
  ...Object.fromEntries(Array.from({ length: 51 }, (_, index): [string, Record<string, unknown>] => {
    const id = 9 + index;
    const label = `Laptop-${String(index + 1).padStart(2, '0')}`;
    return [`netskope_device:${id}`, { type: 'netskope_device', id, label, sublabel: `dev-${id}`, counts: { forward: id === 9 ? 2 : 0, back: 1 } }];
  })),
};

export const NETSKOPE_CHAIN_HOPS: Record<string, Record<string, unknown>[]> = {
  'netskope_user:4:forward': [],
  'netskope_user:3:forward': Array.from({ length: 51 }, (_, index) => ({
    ...NETSKOPE_CHAIN_NODES[`netskope_device:${9 + index}`],
    relation: { kind: 'derived', basis: 'observed_user_exact' },
  })),
  'netskope_device:9:back': [{
    ...NETSKOPE_CHAIN_NODES['netskope_user:3'],
    relation: { kind: 'derived', basis: 'observed_user_exact' },
  }],
  'netskope_device:59:back': [{
    ...NETSKOPE_CHAIN_NODES['netskope_user:3'],
    relation: { kind: 'derived', basis: 'observed_user_exact' },
  }],
  'netskope_device:9:forward': [
    { type: 'netskope_client_version', id: 0, label: '110.0.1', sublabel: '', relation: { kind: 'derived', basis: 'attribute_group' }, counts: { forward: 0, back: 0 } },
    { type: 'netskope_os', id: 0, label: 'Windows', sublabel: '11', relation: { kind: 'derived', basis: 'attribute_group' }, counts: { forward: 0, back: 0 } },
  ],
};

export const NETSKOPE_CHAIN_SEARCH_GROUPS = {
  netskope_user: [
    { type: 'netskope_user', id: 3, label: 'Ada Netskope', sublabel: 'u-3' },
    { type: 'netskope_user', id: 4, label: 'Usuario sin vínculo', sublabel: 'u-4' },
  ],
  netskope_device: [{ type: 'netskope_device', id: 9, label: 'Laptop-01', sublabel: 'dev-9' }],
};

export const CHAIN_SEARCH_GROUPS = {
  user: [
    { type: 'user', id: 8, label: 'Ada', sublabel: 'u-8', standard_seat_reconciled: true },
    { ...CHAIN_NODES['user:12'], standard_seat_reconciled: false },
  ],
  role: [{ type: 'role', id: 7, label: 'Operations', sublabel: '42' }],
  safe: [{ type: 'safe', id: 9, label: 'Finance', sublabel: 'FIN' }],
  platform: [{ type: 'platform', id: 4, label: 'Unix', sublabel: 'Unix' }],
  psm: [{ type: 'psm', id: 5, label: 'PSM-01', sublabel: 'psm-1' }],
};

/* CHAIN-010 person view fixtures: one person present in the four tools so
   the hub renders matched, reference and deep links without a real backend. */
export const PERSON_SEARCH_RESULTS = [
  { email: 'ada@itti.digital', name: 'Ada Lovelace', sources: ['pam', 'identity', 'netskope'] },
  { email: 'riesgo@itti.digital', name: 'Riesgo Parcial', sources: ['pam', 'identity'] },
  { email: 'solo-pam@itti.digital', name: 'Solo PAM', sources: ['pam'] },
];

export const PERSON_SUMMARIES: Record<string, Record<string, unknown>> = {
  'ada@itti.digital': {
    email: 'ada@itti.digital',
    name: 'Ada Lovelace',
    tools: {
      pam: {
        status: 'matched', basis: 'email_exact',
        user: { object_id: 8, display_name: 'Ada', source_id: 'ada@itti.digital', user_type: 'EPVUser' },
        totals: { roles: 1, safes: 1, platforms: 1, psms: 1, accounts: 2 },
      },
      identity: {
        status: 'matched', basis: 'email_exact',
        user: { object_id: 12, display_name: 'Ada Lovelace', source_id: 'uuid-ada', active: true },
        federation: { object_id: 63, display_name: 'Okta ITTI', source_id: 'fed-1' },
        role_count: 2,
      },
      sia: { status: 'reference', basis: 'display_name_reference_only', policy_count: 1 },
      netskope: {
        status: 'matched', basis: 'email_exact',
        user: { object_id: 3, display_name: 'Ada Netskope', source_id: 'u-3' },
        device_count: 1, stale_device_count: 1, company: 'ITTI',
        client_versions: ['110.0.1'], operating_systems: ['Windows'],
      },
    },
  },
  /* UX-PERSON-001: ambiguous and unmatched tools must keep their own state and
     never draw an invented link. */
  'riesgo@itti.digital': {
    email: 'riesgo@itti.digital',
    name: 'Riesgo Parcial',
    tools: {
      pam: {
        status: 'matched', basis: 'email_exact',
        user: { object_id: 21, display_name: 'Riesgo', source_id: 'riesgo@itti.digital', user_type: 'EPVUser' },
        totals: { roles: 1, safes: 0, platforms: 0, psms: 0, accounts: 0 },
      },
      identity: { status: 'ambiguous', basis: 'multiple_active_candidates' },
      sia: { status: 'unmatched' },
      netskope: { status: 'unmatched' },
    },
  },
  /* UX-PERSON-001: an actor whose permissions only reach the PAM branch sees
     just those tools; the hierarchy adapts without inventing nodes. */
  'solo-pam@itti.digital': {
    email: 'solo-pam@itti.digital',
    name: 'Solo PAM',
    tools: {
      pam: {
        status: 'matched', basis: 'email_exact',
        user: { object_id: 22, display_name: 'Solo PAM', source_id: 'solo-pam@itti.digital', user_type: 'EPVUser' },
        totals: { roles: 0, safes: 1, platforms: 0, psms: 0, accounts: 1 },
      },
      sia: { status: 'reference', basis: 'display_name_reference_only', policy_count: 1 },
    },
  },
};

export const PERSON_CLIENT_COVERAGE_SUMMARY = {
  metric_code: 'CONN-001', metric_version: '1',
  label: 'Cliente Netskope activo y observado recientemente',
  population: 'Usuarios humanos activos de Identity Administration',
  person_freshness_hours: 24, device_freshness_days: 7,
  counts: {
    denominator: 3, covered: 1, partial: 1, gap: 0, unknown: 1,
    coverage_percent: 33.33, devices_recent: 3, devices_total: 4,
    device_coverage_percent: 75,
  },
  sources: {
    identity: {
      source_system: 'identity_administration', source_file: 'identity-administration-scim',
      run_id: 'identity-run-fixture', status: 'completed', started_at: '2026-09-30T10:00:00Z',
      completed_at: '2026-09-30T10:01:00Z', freshness: 'fresh', age_hours: 1,
    },
    netskope: {
      source_system: 'netskope', source_file: 'netskope-api', run_id: 'netskope-run-fixture',
      status: 'completed', started_at: '2026-09-30T10:00:00Z',
      completed_at: '2026-09-30T10:01:00Z', freshness: 'fresh', age_hours: 1,
    },
  },
};

export const PERSON_CLIENT_COVERAGE_DETAILS: Record<string, Record<string, unknown>> = {
  'ada@itti.digital': {
    metric_code: 'CONN-001', metric_version: '1', email: 'ada@itti.digital', status: 'partial',
    identity_records: 1, netskope_users: 1, devices_recent: 1, devices_not_recent: 1,
    devices_total: 2, devices_ambiguous: 0,
    sources: PERSON_CLIENT_COVERAGE_SUMMARY.sources,
    explanation: 'Hay dispositivos recientes y otros no recientes o sin fecha; esto no confirma su antigüedad.',
  },
  'riesgo@itti.digital': {
    metric_code: 'CONN-001', metric_version: '1', email: 'riesgo@itti.digital', status: 'unknown',
    identity_records: 1, netskope_users: 0, devices_recent: 0, devices_not_recent: 0,
    devices_total: 0, devices_ambiguous: 0,
    sources: PERSON_CLIENT_COVERAGE_SUMMARY.sources,
    explanation: 'El vínculo o la evidencia de fuente es ambiguo, incompleto o no vigente.',
  },
};
