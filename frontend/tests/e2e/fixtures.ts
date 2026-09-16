import { test as base, expect, type Page } from '@playwright/test';

export const unauthenticated = {
  mode: 'local',
  authenticated: false,
  setup_available: false,
  permissions: [],
  user: null,
};

type MockOptions = { onRequest?: (pathname: string) => void; permissions?: string[]; includeSafe?: boolean; largeInventory?: boolean; decommissionCandidate?: boolean; initialVisibleWorkspaces?: string[] };

export async function mockAuthenticatedApp(page: Page, options: MockOptions = {}) {
  const { onRequest, permissions = ['inventory:read', 'inventory:write', 'catalogs:write', 'access:manage', 'safes:classify', 'safes:bulk_classify', 'connections:import', 'ingestion:preview', 'ingestion:run', 'findings:manage', 'catalogs:manage'], includeSafe = false, largeInventory = false, decommissionCandidate = false, initialVisibleWorkspaces = ['safes'] } = options;
  let workspacePreferences = { visible_workspaces: initialVisibleWorkspaces, hidden_workspaces: [] as string[], recent_workspaces: [] as string[], updated_at: null as string | null };
  await page.route('**/api/**', async (route) => {
    const requestUrl = new URL(route.request().url());
    const pathname = requestUrl.pathname;
    onRequest?.(pathname);
    const bodies: Record<string, unknown> = {
      '/api/auth/status': {
        mode: 'local',
        authenticated: true,
        permissions,
        user: { actor_id: 'operator-1', name: 'Operador', email: 'operator@example.com', roles: ['operator'], role_names: ['Operador de plataforma'] },
      },
      '/api/auth/users': { rows: [{ actor_id: 'carlos@example.com', email: 'carlos@example.com', display_name: 'Carlos Ortiz', is_active: true, must_change_password: false, roles: ['admin'] }], total: 1, limit: 20, offset: 0 },
      '/api/access/roles': { rows: [
        { role_code: 'reader', display_name: 'Lector de plataforma', description: 'Consulta básica', domain_code: 'platform', role_kind: 'direct', lifecycle_status: 'active', system_managed: true, permission_codes: ['inventory:read'], level_refs: [], user_count: 0 },
        { role_code: 'admin', display_name: 'Administrador de plataforma', description: 'Administración completa', domain_code: 'platform', role_kind: 'direct', lifecycle_status: 'active', system_managed: true, permission_codes: ['inventory:read', 'inventory:write', 'inventory:export', 'catalogs:read', 'catalogs:write', 'access:manage', 'domain:pam', 'domain:admin'], level_refs: [], user_count: 1 },
        { role_code: 'netskope_reader', display_name: 'Netskope · Lector', description: 'Preparado para lectura', domain_code: 'dlp', role_kind: 'direct', lifecycle_status: 'planned', system_managed: true, permission_codes: ['domain:dlp', 'netskope:read'], level_refs: [], user_count: 0 },
        { role_code: 'security_reader', display_name: 'Lectura de seguridad', description: 'Lectura transversal', domain_code: null, role_kind: 'composite', lifecycle_status: 'planned', system_managed: false, permission_codes: ['inventory:read', 'domain:dlp', 'netskope:read'], level_refs: [{ domain_code: 'platform', level_code: 'reader' }, { domain_code: 'pam', level_code: 'reader' }, { domain_code: 'dlp', level_code: 'reader' }, { domain_code: 'dspm', level_code: 'reader' }], user_count: 0 },
      ] },
      '/api/access/domains': { rows: [
        { domain_code: 'platform', display_name: 'Plataforma', lifecycle_status: 'active', sort_order: 10, levels: [{ level_code: 'reader', display_name: 'Lector', base_role_code: 'reader', lifecycle_status: 'active', permission_codes: ['inventory:read'] }, { level_code: 'admin', display_name: 'Administrador', base_role_code: 'admin', lifecycle_status: 'active', permission_codes: ['inventory:read', 'access:manage'] }] },
        { domain_code: 'pam', display_name: 'CyberArk PAM', lifecycle_status: 'active', sort_order: 20, levels: [{ level_code: 'reader', display_name: 'Lector', base_role_code: 'cyberark_reader', lifecycle_status: 'active', permission_codes: ['domain:pam'] }, { level_code: 'admin', display_name: 'Administrador', base_role_code: 'cyberark_admin', lifecycle_status: 'active', permission_codes: ['domain:pam', 'domain:admin'] }] },
        { domain_code: 'dlp', display_name: 'Netskope DLP', lifecycle_status: 'planned', sort_order: 30, levels: [{ level_code: 'reader', display_name: 'Lector', base_role_code: 'netskope_reader', lifecycle_status: 'planned', permission_codes: ['domain:dlp', 'netskope:read'] }] },
        { domain_code: 'dspm', display_name: 'BigID DSPM', lifecycle_status: 'planned', sort_order: 40, levels: [{ level_code: 'reader', display_name: 'Lector', base_role_code: 'bigid_reader', lifecycle_status: 'planned', permission_codes: ['domain:dspm', 'bigid:read'] }] },
      ] },
      '/api/access/roles/composite': { created: true, role_code: 'security_lead', warning: { code: 'duplicate_combination', matching_role_code: 'security_reader', matching_role_name: 'Lectura de seguridad' } },
       '/api/access/permissions': { rows: [
         { permission_code: 'inventory:read', domain_code: 'pam', resource_code: 'inventory', action_code: 'read', description: 'Consultar inventario PAM', lifecycle_status: 'active', system_managed: true },
         { permission_code: 'domain:dlp', domain_code: 'dlp', resource_code: 'domain', action_code: 'access', description: 'Ingresar a Netskope DLP', lifecycle_status: 'planned', system_managed: true },
         { permission_code: 'netskope:read', domain_code: 'dlp', resource_code: 'workspace', action_code: 'read', description: 'Consultar Netskope DLP', lifecycle_status: 'planned', system_managed: true },
       ] },
      '/api/summary': {
        safes: 1, business_safes: 1, internal_safes: 0, scope_pending_safes: 0,
        scope_candidate_safes: 0, clean_business_safes: 1, obsolete_safes: 0,
        duplicate_safes: 0, accounts: 1, pending_classification: 0, assigned: 1,
        review: 0, latest_run: null,
        safe_health: { denominator: 1, missing_cpm: 0, no_accounts: 0, olac_disabled: 0, retention_unconfigured: 0, manage_safe_concentration: 0 },
      },
      '/api/dashboard/preferences': { widgets: [
        { widget_id: 'without-accounts', title: 'Safes sin cuentas', kind: 'count', measure: 'safes', chart: null, filters: { workflow_status: '', classification_status: '', inventory_scope: '', data_quality_status: '', health_filter: 'no_accounts' }, target_value: null, target_direction: null, period_label: null, baseline_value: null, value_format: 'count', position: null, size: 'sm', value: 51 },
        { widget_id: 'pending-classification', title: 'Pendientes de clasificar', kind: 'count', measure: 'safes', chart: null, filters: { workflow_status: '', classification_status: 'pending', inventory_scope: '', data_quality_status: '', health_filter: '' }, target_value: null, target_direction: null, period_label: null, baseline_value: null, value_format: 'count', position: null, size: 'sm', value: 104 },
        { widget_id: 'pam-users', title: 'Usuarios PAM', kind: 'count', measure: 'pam_users', chart: null, filters: { workflow_status: '', classification_status: '', inventory_scope: '', data_quality_status: '', health_filter: '' }, target_value: null, target_direction: null, period_label: null, baseline_value: null, value_format: 'count', position: null, size: 'sm', value: 98 },
        { widget_id: 'safes-by-company', title: 'Safes por empresa', kind: 'chart', measure: 'safes', chart: { style: 'pie', group_by: 'business_unit' }, filters: { workflow_status: '', classification_status: '', inventory_scope: '', data_quality_status: '', health_filter: '' }, target_value: null, target_direction: null, period_label: null, baseline_value: null, position: 0, size: 'sm', value: 0, buckets: [{ key: 'Ueno', filter_value: '3', count: 1 }] },
        { widget_id: 'accounts-by-company', title: 'Cuentas por empresa', kind: 'chart', measure: 'accounts', chart: { style: 'bars', group_by: 'business_unit' }, filters: { workflow_status: '', classification_status: '', inventory_scope: '', data_quality_status: '', health_filter: '' }, target_value: null, target_direction: null, period_label: null, baseline_value: null, position: 1, size: 'sm', value: 0, buckets: [{ key: 'Ueno', filter_value: '3', count: 1 }] },
        { widget_id: 'safes-by-status', title: 'Safes por estado', kind: 'chart', measure: 'safes', chart: { style: 'pie', group_by: 'workflow_status' }, filters: { workflow_status: '', classification_status: '', inventory_scope: '', data_quality_status: '', health_filter: '' }, target_value: null, target_direction: null, period_label: null, baseline_value: null, position: 2, size: 'sm', value: 0, buckets: [{ key: 'pending', filter_value: 'pending', count: 1 }, { key: 'retired', filter_value: 'retired', count: 1 }] },
      ], is_default: true },
      '/api/catalogs': includeSafe ? { business_units: [{ business_unit_id: 3, unit_code: 'FIN', unit_name: 'Finanzas', is_active: true }], responsibles: [{ responsible_id: 4, display_name: 'Ada Admin', email: 'ada@example.com', is_active: true }], account_types: [] } : { business_units: [], responsibles: [], account_types: [] },
      '/api/cmdb/coverage': { objects: [], relationships: [], chains: { pam: 'pending_sources', sia: 'pending_sources' } },
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
        accounts_active: 1, accounts_with_platform: 1, accounts_without_platform: 0,
        accounts_with_partial_platform: 0, platforms_observed: 1, safes_without_accounts: 0,
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
      '/api/safes': includeSafe ? { rows: [{ safe_number: 1, safe_name: 'Finance', safe_url_id: 'Finance', location: null, member_count: 1, account_count: 2, cpm_configured: true, olac_enabled: true, retention_configured: true, manage_safe_principal_count: 1, account_type_counts: {}, internal_name: null, business_unit_id: null, responsible_id: null, classification_status: 'pending', inventory_scope: 'pending', data_quality_status: 'pending', scope_hint: null, business_unit_name: null, responsible_name: null, workflow_status: 'pending', next_action: decommissionCandidate ? 'Dar de baja' : null }], total: 1, limit: 50, offset: 0 } : { rows: [], total: 0, limit: 50, offset: 0 },
      '/api/safes/1': includeSafe ? { safe: { safe_number: 1, safe_name: 'Finance', safe_url_id: 'Finance', location: null, member_count: 1, account_count: 2, cpm_configured: true, olac_enabled: true, retention_configured: true, manage_safe_principal_count: 1, account_type_counts: {}, internal_name: null, business_unit_id: null, responsible_id: null, classification_status: 'pending', inventory_scope: 'pending', data_quality_status: 'pending', scope_hint: null, business_unit_name: null, responsible_name: null, workflow_status: 'pending', next_action: null, creator_name: 'System', description: null, managing_cpm: 'CPM', number_of_versions_retention: 5, number_of_days_retention: 30, auto_purge_enabled: true, creation_time: null, last_modification_time: null, notes: null, assigned_at: null, assigned_by: null }, members: [{ member_id: 'member-1', member_name: 'Ada Admin', member_type: 'User', membership_expiration_date: null, is_predefined_user: false, is_read_only: false, permissions: { read: true } }] } : {},
      '/api/safes/1/accounts': includeSafe ? { rows: [{ safe_number: 1, safe_name: 'Finance', account_id: 'account-1', account_name: 'db-finance', user_name: 'dbadmin', address: '10.0.0.1', platform_id: 'platform-1', platform_name: 'PostgreSQL', lifecycle_status: 'active', last_seen_at: '2026-08-29T00:00:00Z', attributes: {} }], total: 1, limit: 200, offset: 0 } : {},
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
      '/api/cmdb/pam-aim-applications': {
        rows: [{ object_id: 40, display_name: 'Finance batch job', source_id: 'App1', description: 'Finance batch job', disabled: false, expiration_date: '', location: '\\' }],
        total: 1, limit: 100, offset: 0, search: '',
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
      '/api/connection-inventory': {
        rows: [{ inventory_id: 101, source_row_number: 2, instance_name: 'dev-compute-db-desa', environment: 'DEV', private_ip: '10.67.9.143', port: 22, ca_sia: true, ca_dba: true, zsp_implemented: true, access_available: true, description: 'Migrada desde Priv Cloud', import_id: 'batch-1', file_name: 'conexiones.csv', row_count: 1, imported_at: '2026-08-29T00:00:00Z', safe_matches: [{ safe_number: 1, safe_name: 'Finance', account_id: 'account-1', account_name: 'dbadmin', address: '10.67.9.143', platform_name: 'Unix', platform_id: 'unix' }], sia_matches: [{ object_id: 20, display_name: 'Finance access', source_id: 'policy-20' }], safe_match_count: 1, sia_match_count: 1 }],
        total: 1, limit: 50, offset: 0, search: '', import: { import_id: 'batch-1', file_name: 'conexiones.csv', row_count: 1, imported_at: '2026-08-29T00:00:00Z' },
      },
    };
    let responseBody = bodies[pathname] ?? {};
    const offset = Number(requestUrl.searchParams.get('offset') || 0);
    if (largeInventory && pathname === '/api/safes' && includeSafe) {
      const base = bodies[pathname] as { rows: Record<string, unknown>[]; total: number; limit: number; offset: number };
      responseBody = { ...base, total: 51, offset, rows: offset === 0 ? base.rows : [{ ...base.rows[0], safe_number: 2, safe_name: 'Finance 2', safe_url_id: 'Finance 2' }] };
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



export const test = base;
export { expect };
