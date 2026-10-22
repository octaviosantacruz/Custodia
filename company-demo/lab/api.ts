import { accounts, company, coverage, coverageSummary, devices, people, personSummary, safes, type SourceMode } from './company.ts';
import type { NetskopeRow } from '../src/netskope/sse/types/netskope';

const permissions = ['inventory:read', 'catalogs:read', 'domain:pam', 'domain:dlp', 'pam:catalogs_read', 'identity:catalogs_read', 'netskope:read'];
const includesQuery = (value: unknown, query: string) => JSON.stringify(value).toLocaleLowerCase().includes(query.toLocaleLowerCase());
const areaId = (area: string) => company.areas.indexOf(area) + 1;
const stamp = { first_seen_at: '2026-10-01T13:00:00Z', last_seen_at: company.capturedAt, lifecycle_status: 'active' };
const safeRows = () => safes.map(s => ({ safe_number: s.id, safe_name: s.name, safe_url_id: s.name,
  location: null, member_count: people.filter(p => p.safeIds.includes(s.id)).length, account_count: accounts.filter(a => a.safeId === s.id).length,
  cpm_configured: true, olac_enabled: true, retention_configured: true, manage_safe_principal_count: 1, account_type_counts: {},
  internal_name: s.name, business_unit_id: areaId(s.area), responsible_id: s.responsibleId,
  classification_status: s.quality === 'clean' ? 'assigned' : 'review', inventory_scope: s.scope, data_quality_status: s.quality,
  scope_hint: null, business_unit_name: s.area, responsible_name: people.find(p => p.id === s.responsibleId)!.name,
  workflow_status: s.workflow, next_action: 'Revisar cobertura de cliente', notes: s.note,
  creator_name: 'Faro Digital · ejemplo', description: 'Safe sintético para demostrar inventario y revisión.', managing_cpm: 'CPM-FARO',
  number_of_versions_retention: 5, number_of_days_retention: 30, auto_purge_enabled: true,
  creation_time: null, last_modification_time: null, assigned_at: company.capturedAt, assigned_by: 'Analista demo' }));
const accountRows = () => accounts.map(a => ({ safe_number: a.safeId, safe_name: safes.find(s => s.id === a.safeId)!.name,
  account_id: a.id, account_name: a.name, user_name: a.userName, address: a.address, platform_id: a.platform, platform_name: a.platform,
  ...stamp, attributes: { automatic_management_enabled: a.automaticManagement, management_status: a.automaticManagement ? 'success' : 'disabled', secret_modified_at: company.capturedAt } }));
const platforms = [...new Set(accounts.map(a => a.platform))].map((name, index) => ({ name, id: 600 + index }));
const safePlatformIds = (id: number) => platforms.filter(p => accounts.some(a => a.safeId === id && a.platform === p.name)).map(p => p.id);
const nodes = () => [
  ...people.filter(p => p.pamId).map(p => ({ type: 'user', id: p.pamId!, label: p.name, sublabel: p.email, counts: { forward: 1, back: 0 } })),
  ...safes.map(s => ({ type: 'role', id: 400 + s.id, label: `${s.area} · ${s.id === 1 ? 'Producción' : 'Desarrollo'}`, sublabel: `faro-role-${s.id}`, counts: { forward: 1, back: people.filter(p => p.safeIds.includes(s.id)).length } })),
  ...safes.map(s => ({ type: 'safe', id: s.id, label: s.name, sublabel: s.area, counts: { forward: safePlatformIds(s.id).length, back: 1 } })),
  ...platforms.map(p => ({ type: 'platform', id: p.id, label: p.name, sublabel: p.name, counts: { forward: 0, back: safes.filter(s => safePlatformIds(s.id).includes(p.id)).length } })),
];

export function createCompanyApi(mode: SourceMode) {
  let preferences = { visible_workspaces: ['person', 'safes', 'graph', 'netskopeInventory'], hidden_workspaces: [], recent_workspaces: [], updated_at: company.capturedAt };
  const evidence = { source_fresh: mode === 'complete', source_status: mode === 'partial' ? 'partial' : 'completed',
    source_completed_at: mode === 'stale' ? '2026-10-19T13:00:00Z' : company.capturedAt, as_of: company.asOf };
  const deviceRows = (): NetskopeRow[] => devices.map(d => {
    const person = people.find(p => p.id === d.personId)!;
    // A stale snapshot must not contain observations newer than its capture.
    const signalAt = mode === 'stale' ? new Date(Date.parse(d.lastSignalAt) - 3 * 86_400_000).toISOString() : d.lastSignalAt;
    const age = (Date.parse(company.asOf) - Date.parse(signalAt)) / 86_400_000;
    return { object_id: d.id, display_name: d.hostname, source_id: d.deviceId, ...stamp, last_seen_at: evidence.source_completed_at,
      attributes: { hostname: d.hostname, device_make: d.os === 'Windows' ? 'Dell' : 'Apple', device_model: d.os === 'Windows' ? 'Latitude' : 'MacBook',
        os: d.os, os_version: d.osVersion, client_version: d.clientVersion, guid: d.deviceId, heartbeat: age <= 7, username: person.email,
        user_key: `faro-netskope-${person.id}`, user_status: 'enabled', classification_status: 'managed', company: company.name,
        last_seen_event: 'connect', last_event_timestamp: Date.parse(signalAt) / 1000 },
      observed_user_status: 'matched',
      observed_user: { source_id: `faro-netskope-${person.id}`, object_id: person.netskopeId, display_name: person.name, email: person.email },
      device_evidence: { state: mode !== 'complete' ? 'unknown' : age <= 7 ? 'recent' : 'not_recent',
        reason: mode !== 'complete' ? 'Fuente parcial o vencida: no se evalúa cobertura.' : age <= 7 ? 'Señal reciente en el escenario.' : 'Sin señal en los últimos 7 días; revisar sin asumir abandono.',
        last_signal_at: signalAt, age_days: age, ...evidence, recent_days: 7, review_days: 30, source_freshness_hours: 24,
        client_version: d.clientVersion, os: d.os, os_version: d.osVersion, last_seen_event: 'connect' } };
  });
  function page(rows: unknown[], url: URL) {
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 50));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    return { rows: rows.slice(offset, offset + limit), total: rows.length, offset, limit, search: url.searchParams.get('q') ?? '' };
  }
  return async function respond(url: URL, method = 'GET', body?: string): Promise<Response> {
    const path = url.pathname.replace(/\/$/, '');
    const q = url.searchParams.get('q') ?? '';
    const json = (value: unknown, status = 200) => Response.json(value, { status });
    if (path === '/api/workspaces/preferences') {
      if (method === 'PUT') preferences = { ...preferences, ...JSON.parse(body ?? '{}'), updated_at: company.capturedAt };
      return json(preferences);
    }
    if (method !== 'GET') return json({ detail: 'Demo de sólo lectura. Las acciones reales requieren backend y autorización.' }, 405);
    if (path === '/api/auth/status') return json({ mode: 'local', authenticated: true, permissions,
      api_docs_enabled: false, user: { actor_id: 'fictional:analyst', name: 'Analista demo', email: 'analista@faro.example',
        auth_source: 'local', roles: ['demo_reader'], role_names: ['Lectura de la empresa ficticia'], must_change_password: false } });
    if (path === '/api/events' || path === '/api/ingestion/schedules' || path === '/api/ingestion/runs') return json({ rows: [] });
    if (path === '/api/chains/person/search') return json({ query: q, people: people.filter(p => includesQuery([p.name, p.email, p.area], q)).map(p => ({ email: p.email, name: p.name, sources: p.pamId ? ['pam', 'identity', 'netskope'] : ['identity', 'netskope'] })) });
    if (path === '/api/chains/person/coverage') return json(coverageSummary(mode));
    if (path === '/api/chains/person' || path === '/api/chains/person/coverage/detail') {
      const person = people.find(p => p.email === url.searchParams.get('email'));
      return person ? json(path.endsWith('/detail') ? coverage(person, mode) : personSummary(person)) : json({ detail: 'Persona no encontrada en Faro Digital.' }, 404);
    }
    if (path === '/api/cmdb/netskope/sync-evidence') return json(evidence);
    if (/^\/api\/cmdb\/netskope\/users\/\d+\/(experience\/score|anomalies)$/.test(path)) return json({ detail: 'Esta demo no incluye evidencia ADEM ni UEBA.' }, 403);
    if (path === '/api/cmdb/netskope/devices/facets') {
      const buckets = (key: 'os' | 'clientVersion') => [...new Set(devices.map(d => d[key]))].map(value => ({ key: value, count: devices.filter(d => d[key] === value).length }));
      return json({ os: buckets('os'), client_version: buckets('clientVersion'), classification_status: [{ key: 'managed', count: devices.length }], user_status: [{ key: 'enabled', count: devices.length }], company: [{ key: company.name, count: devices.length }] });
    }
    if (path === '/api/cmdb/netskope/devices') {
      const supported = new Set(['q', 'limit', 'offset', 'observed_user_id', 'os', 'client_version', 'classification_status', 'user_status', 'company', 'freshness']);
      const unsupported = [...url.searchParams].find(([key, value]) => value && !supported.has(key));
      if (unsupported) return json({ detail: `El filtro ${unsupported[0]} todavía no está modelado en esta demo.` }, 422);
      let rows = deviceRows().filter(d => includesQuery(d, q));
      const observed = url.searchParams.get('observed_user_id');
      if (observed) rows = rows.filter(d => d.observed_user?.object_id === Number(observed));
      for (const key of ['os', 'client_version', 'classification_status', 'user_status', 'company'] as const) {
        const value = url.searchParams.get(key);
        if (value) rows = rows.filter(d => d.attributes[key] === value);
      }
      const freshness = url.searchParams.get('freshness') || 'recent';
      if (!['recent', 'all'].includes(freshness)) return json({ detail: 'Vigencia de inventario no válida.' }, 422);
      if (freshness === 'recent') rows = rows.filter(d => (d.device_evidence?.age_days ?? Infinity) <= 7);
      return json({ ...page(rows, url), source_evidence: evidence });
    }
    if (path === '/api/cmdb/netskope/users') {
      const unsupported = [...url.searchParams].find(([key, value]) => value && !['q', 'limit', 'offset'].includes(key));
      if (unsupported) return json({ detail: `El filtro ${unsupported[0]} todavía no está modelado en esta demo.` }, 422);
      return json({ ...page(people.filter(p => includesQuery(p, q)).map(p => ({ object_id: p.netskopeId, display_name: p.name, source_id: `faro-netskope-${p.id}`, ...stamp, last_seen_at: evidence.source_completed_at, attributes: { email: p.email, company: company.name, account_status: 'enabled' } })), url), source_evidence: evidence });
    }
    const history = path.match(/^\/api\/cmdb\/netskope\/devices\/([^/]+)\/history$/);
    if (history) {
      const device = deviceRows().find(d => d.source_id === history[1]);
      return device ? json({ device_id: device.source_id, snapshots: [{ snapshot_id: device.object_id, source_run_id: `faro-netskope-${mode}`, captured_at: evidence.source_completed_at, attributes: device.attributes }] }) : json({ detail: 'Equipo inexistente' }, 404);
    }
    if (path === '/api/catalogs') return json({ business_units: company.areas.map((a, i) => ({ business_unit_id: i + 1, unit_code: `FARO-${i + 1}`, unit_name: a, is_active: true })), responsibles: people.map(p => ({ responsible_id: p.id, display_name: p.name, email: p.email, is_active: true })), account_types: [] });
    if (path === '/api/summary') return json({ safes: safes.length, business_safes: safes.length, internal_safes: 0, scope_pending_safes: 0, scope_candidate_safes: 0, clean_business_safes: safes.filter(s => s.quality === 'clean').length, obsolete_safes: safes.filter(s => s.quality === 'obsolete').length, duplicate_safes: safes.filter(s => s.quality === 'duplicate').length,
      accounts: accounts.length, pending_classification: 0, assigned: safeRows().filter(s => s.classification_status === 'assigned').length, review: safeRows().filter(s => s.classification_status === 'review').length, latest_run: null,
      safe_health: { denominator: safes.length, missing_cpm: 0, no_accounts: 0, olac_disabled: 0, retention_unconfigured: 0, manage_safe_concentration: 0 } });
    if (path === '/api/cmdb/coverage') return json({ objects: [], relationships: [], chains: { pam: 'pending_sources', sia: 'pending_sources' } });
    if (path === '/api/lifecycle/retired') return json({ rows: [], total: 0, deletion_enabled: false });
    if (path === '/api/analytics/account-platform-coverage') return json({ accounts_active: accounts.length, accounts_with_platform: accounts.length, accounts_without_platform: 0, accounts_with_partial_platform: 0, platforms_observed: new Set(accounts.map(a => a.platform)).size, safes_without_accounts: 0 });
    if (path === '/api/analytics/account-management') return json({ accounts_active: accounts.length, automatic_enabled: accounts.filter(a => a.automaticManagement).length, automatic_disabled: accounts.filter(a => !a.automaticManagement).length, management_unknown: 0, status_success: accounts.filter(a => a.automaticManagement).length, status_failure: 0, status_in_process: 0, status_unknown: accounts.filter(a => !a.automaticManagement).length, changed_30d: accounts.length, changed_90d: accounts.length, changed_365d: accounts.length, changed_older: 0, changed_unknown: 0 });
    if (path === '/api/analytics') return json({ workflow_status: [], next_actions: [], account_types: [], business_units: [], responsibles: [] });
    if (path === '/api/safes') {
      let rows = safeRows().filter(s => includesQuery(s, q));
      const filterKeys = { workflow_status: 'workflow_status', classification_status: 'classification_status', inventory_scope: 'inventory_scope', data_quality_status: 'data_quality_status', business_unit: 'business_unit_id', responsible: 'responsible_id', next_action: 'next_action' } as const;
      for (const [key, field] of Object.entries(filterKeys)) {
        const value = url.searchParams.get(key);
        if (value) rows = rows.filter(s => String(s[field as keyof typeof s]) === value);
      }
      const health = url.searchParams.get('health_filter');
      if (health && ['missing_cpm', 'no_accounts', 'olac_disabled', 'retention_unconfigured', 'manage_safe_concentration'].includes(health)) rows = [];
      return json({ ...page(rows, url), classification_counts: { assigned: rows.filter(s => s.classification_status === 'assigned').length, review: rows.filter(s => s.classification_status === 'review').length, pending: 0 } });
    }
    const safePath = path.match(/^\/api\/safes\/(\d+)(?:\/(accounts|audit))?$/);
    if (safePath) {
      const number = Number(safePath[1]); const safe = safeRows().find(s => s.safe_number === number);
      if (!safe) return json({ detail: 'Safe no encontrado' }, 404);
      if (safePath[2] === 'accounts') return json(page(accountRows().filter(a => a.safe_number === number && includesQuery(a, q)), url));
      if (safePath[2] === 'audit') return json({ rows: [{ audit_id: number, actor_id: 'fictional:analyst', actor_name: 'Analista demo', action: 'update', entity_type: 'safe_metadata', entity_id: String(number), entity_name: safe.safe_name,
        before_data: { notes: null }, after_data: { notes: safe.notes }, created_at: company.capturedAt }] });
      return json({ safe, members: people.filter(p => p.safeIds.includes(number)).map(p => ({ member_id: `faro-pam-${p.id}`, member_name: p.name, member_type: 'User', membership_expiration_date: null, is_predefined_user: false, is_read_only: true, permissions: { use_accounts: true, retrieve_accounts: true } })) });
    }
    if (path === '/api/chains/pam/node') {
      const node = nodes().find(n => n.type === url.searchParams.get('type') && n.id === Number(url.searchParams.get('id')));
      return node ? json({ node }) : json({ detail: 'Nodo no encontrado' }, 404);
    }
    if (path === '/api/chains/pam/search') return json({ query: q, groups: Object.fromEntries(['user', 'role', 'safe', 'platform', 'psm'].map(type => [type, nodes().filter(n => n.type === type && includesQuery(n, q))])) });
    if (path === '/api/chains/pam/expand') {
      const type = url.searchParams.get('type'), id = Number(url.searchParams.get('id')), direction = url.searchParams.get('direction');
      const person = people.find(p => p.pamId === id);
      const targetIds = type === 'user' ? (person?.safeIds ?? []).map(id => 400 + id)
        : type === 'role' && direction === 'forward' ? [id - 400]
          : type === 'safe' && direction === 'back' ? [400 + id]
            : type === 'safe' && direction === 'forward' ? safePlatformIds(id)
              : type === 'platform' && direction === 'back' ? safes.filter(s => safePlatformIds(s.id).includes(id)).map(s => s.id)
                : type === 'role' && direction === 'back' ? people.filter(p => p.safeIds.includes(id - 400)).map(p => p.pamId!) : [];
      const targetType = type === 'user' ? 'role' : type === 'safe' ? direction === 'back' ? 'role' : 'platform'
        : type === 'platform' ? 'safe' : direction === 'back' ? 'user' : 'safe';
      const rows = nodes().filter(n => n.type === targetType && targetIds.includes(n.id) && includesQuery(n, q)).map(n => ({ ...n, relation: { kind: 'persisted', basis: type === 'user' || targetType === 'user' ? 'user_has_role' : type === 'platform' || targetType === 'platform' ? 'safe_uses_platform' : 'role_grants_access' } }));
      return json({ ...page(rows, url), type, id, direction });
    }
    if (path === '/api/search') return json({ query: q, groups: { safes: safeRows().filter(s => includesQuery(s, q)).map(s => ({ type: 'safe', label: s.safe_name, detail: s.business_unit_name, workspace: 'safes', target: s.safe_number, query: s.safe_name })), accounts: [], pam_users: [], pam_roles: [], sia_policies: [], identity_users: [], identity_roles: [], connections: [] } });
    return json({ detail: `Este endpoint no está modelado en la demo de Faro Digital: ${path}` }, 501);
  };
}

export function installCompanyApi(mode: SourceMode) {
  const respond = createCompanyApi(mode);
  // No fallback to fetch: an unimplemented endpoint must never reach a real server.
  globalThis.fetch = async (input, init) => {
    const request = new Request(input instanceof URL ? input : typeof input === 'string' ? new URL(input, location.href) : input, init);
    const url = new URL(request.url);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) throw new Error('La demo sólo permite su API sintética local.');
    if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return respond(url, request.method, request.method === 'GET' ? undefined : await request.text());
  };
}
