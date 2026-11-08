/**
 * Datos de la demo publicada: Acme Corp (model/company.json).
 *
 * Responde desde el modelo las rutas que cuentan la historia de la empresa
 * (Personas, Safes, cuentas, métricas de CyberArk y el inventario de
 * Netskope) y delega el resto en la API simulada de las pruebas. Todas las
 * cifras salen del mismo escenario, así que el sitio, las vistas y los
 * contadores dicen lo mismo.
 *
 * Las fechas del modelo se corren para que la captura sea siempre "de hace
 * una hora" respecto del visitante; las relaciones entre fechas no cambian.
 */
import { accounts, company, coverage, coverageSummary, devices, people, personDevices, personSummary, safes, sourceEvidence, type Person } from './model/company.ts';
import type { MockRequest, MockResponse } from './mock-api.ts';

type Handler = (request: MockRequest) => Promise<MockResponse>;
type Json = unknown;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const asOf = Date.parse(company.asOf);
const RECENT_DAYS = 7;
const REVIEW_DAYS = 30;

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** Corre cada fecha ISO del cuerpo por el mismo desfase. */
export function shiftDates(value: Json, offset: number): Json {
  if (typeof value === 'string') return ISO.test(value) ? new Date(Date.parse(value) + offset).toISOString() : value;
  if (Array.isArray(value)) return value.map((item) => shiftDates(item, offset));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shiftDates(item, offset)]));
  }
  return value;
}

const areaIds = new Map(company.areas.map((area, index) => [area, index + 1]));
const areaCode = (area: string) => area.slice(0, 3).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const personById = new Map(people.map((person) => [person.id, person]));
const counts = (items: string[]) => [...items.reduce((map, key) => map.set(key, (map.get(key) ?? 0) + 1), new Map<string, number>())]
  .map(([key, count]) => ({ key, count }));

const netskopeRun = sourceEvidence('netskope');
const sourceState = {
  source_fresh: true, source_status: netskopeRun.status, source_completed_at: netskopeRun.completed_at, as_of: company.asOf,
};

function safeAccounts(safeId: number) {
  return accounts.filter((account) => account.safeId === safeId);
}

function safeRow(safe: (typeof safes)[number]) {
  const responsible = personById.get(safe.responsibleId);
  const members = people.filter((person) => person.safeIds.includes(safe.id));
  return {
    safe_number: safe.id, safe_name: safe.name, safe_url_id: safe.name, location: null,
    member_count: members.length, account_count: safeAccounts(safe.id).length,
    cpm_configured: true, olac_enabled: true, retention_configured: true, manage_safe_principal_count: 1,
    account_type_counts: {}, internal_name: null,
    business_unit_id: areaIds.get(safe.area) ?? null, business_unit_name: safe.area,
    responsible_id: responsible?.id ?? null, responsible_name: responsible?.name ?? null,
    classification_status: safe.quality === 'clean' ? 'assigned' : 'pending',
    inventory_scope: safe.scope, data_quality_status: safe.quality, scope_hint: null,
    workflow_status: safe.workflow, next_action: null,
  };
}

function safeDetail(safe: (typeof safes)[number]) {
  return {
    safe: {
      ...safeRow(safe), creator_name: 'Administrador', description: null, managing_cpm: 'PasswordManager',
      number_of_versions_retention: 5, number_of_days_retention: null, auto_purge_enabled: false,
      creation_time: '2026-01-12T10:00:00Z', last_modification_time: company.capturedAt, notes: safe.note,
      assigned_at: safe.quality === 'clean' ? '2026-10-20T15:00:00Z' : null,
      assigned_by: safe.quality === 'clean' ? 'Equipo de seguridad' : null,
    },
    members: people.filter((person) => person.safeIds.includes(safe.id)).map((person) => ({
      member_id: `acme-member-${person.id}`, member_name: person.email, member_type: 'User',
      membership_expiration_date: null, is_predefined_user: false, is_read_only: false,
      permissions: { useAccounts: true, retrieveAccounts: true, listAccounts: true },
    })),
  };
}

function accountRow(account: (typeof accounts)[number]) {
  const safe = safes.find((item) => item.id === account.safeId)!;
  return {
    safe_number: safe.id, safe_name: safe.name, account_id: account.id, account_name: account.name,
    user_name: account.userName, address: account.address, platform_id: account.platform.toLowerCase(),
    platform_name: account.platform, lifecycle_status: 'active', last_seen_at: company.capturedAt,
    attributes: {
      automatic_management_enabled: account.automaticManagement,
      management_status: account.automaticManagement ? 'success' : null,
      secret_modified_at: account.automaticManagement ? '2026-10-15T03:00:00Z' : null,
    },
  };
}

function deviceAge(device: (typeof devices)[number]) {
  return (asOf - Date.parse(device.lastSignalAt)) / DAY;
}

function deviceRow(device: (typeof devices)[number]) {
  const person = personById.get(device.personId)!;
  const age = deviceAge(device);
  const recent = age <= RECENT_DAYS;
  return {
    object_id: device.id, display_name: device.hostname, source_id: device.deviceId,
    attributes: {
      hostname: device.hostname, device_make: device.os === 'Mac OS X' ? 'Apple' : 'Lenovo',
      device_model: device.os === 'Mac OS X' ? 'MacBook Pro' : 'ThinkPad T14', os: device.os, os_version: device.osVersion,
      client_version: device.clientVersion, guid: device.deviceId, heartbeat: recent, username: person.email,
      user_key: `acme-netskope-${person.id}`, user_status: 'enabled', classification_status: 'managed',
      last_seen_event: recent ? 'connect' : 'disconnect', last_event_timestamp: Math.floor(Date.parse(device.lastSignalAt) / 1000),
    },
    first_seen_at: '2026-03-02T09:00:00Z', last_seen_at: device.lastSignalAt,
    device_evidence: {
      ...sourceState, state: recent ? 'recent' : age <= REVIEW_DAYS ? 'not_recent' : 'review',
      reason: recent ? 'Señal del cliente en los últimos 7 días.' : `Sin señal hace ${Math.round(age)} días. No confirma abandono.`,
      last_signal_at: device.lastSignalAt, age_days: Math.floor(age), recent_days: RECENT_DAYS, review_days: REVIEW_DAYS,
      source_freshness_hours: 24, client_version: device.clientVersion, os: device.os, os_version: device.osVersion,
      last_seen_event: recent ? 'connect' : 'disconnect',
    },
  };
}

function userRow(person: Person) {
  return {
    object_id: person.netskopeId, display_name: person.name, source_id: `acme-netskope-${person.id}`,
    attributes: { email: person.email, department: person.area, location: person.site },
    first_seen_at: '2026-03-02T09:00:00Z', last_seen_at: company.capturedAt,
  };
}

function page<T>(rows: T[], url: URL, limit = 50) {
  const offset = Number(url.searchParams.get('offset') ?? 0) || 0;
  return { rows: rows.slice(offset, offset + limit), total: rows.length, limit, offset, search: url.searchParams.get('search') ?? url.searchParams.get('q') ?? '' };
}

function matches(text: string, query: string) {
  const needle = query.trim().toLowerCase();
  return !needle || text.toLowerCase().includes(needle);
}

const widget = (fields: Record<string, unknown>) => ({
  chart: null, filters: { workflow_status: '', classification_status: '', inventory_scope: '', data_quality_status: '', health_filter: '' },
  target_value: null, target_direction: null, period_label: null, baseline_value: null, value_format: 'count',
  position: null, size: 'sm', value: 0, ...fields,
});

function dashboardWidgets() {
  const rows = safes.map(safeRow);
  const withoutAccounts = rows.filter((row) => row.account_count === 0).length;
  const pending = rows.filter((row) => row.classification_status === 'pending').length;
  const pamUsers = people.filter((person) => person.pamId).length;
  const byArea = (measure: 'safes' | 'accounts') => company.areas.map((area) => ({
    key: area, filter_value: String(areaIds.get(area)),
    count: measure === 'safes' ? safes.filter((safe) => safe.area === area).length
      : accounts.filter((account) => safes.find((safe) => safe.id === account.safeId)?.area === area).length,
  })).filter((bucket) => bucket.count > 0);
  return [
    widget({ widget_id: 'without-accounts', title: 'Safes sin cuentas', kind: 'count', measure: 'safes', filters: { workflow_status: '', classification_status: '', inventory_scope: '', data_quality_status: '', health_filter: 'no_accounts' }, value: withoutAccounts }),
    widget({ widget_id: 'pending-classification', title: 'Pendientes de clasificar', kind: 'count', measure: 'safes', filters: { workflow_status: '', classification_status: 'pending', inventory_scope: '', data_quality_status: '', health_filter: '' }, value: pending }),
    widget({ widget_id: 'pam-users', title: 'Usuarios PAM', kind: 'count', measure: 'pam_users', value: pamUsers }),
    widget({ widget_id: 'safes-by-company', title: 'Safes por área', kind: 'chart', measure: 'safes', chart: { style: 'pie', group_by: 'business_unit' }, position: 0, buckets: byArea('safes') }),
    widget({ widget_id: 'accounts-by-company', title: 'Cuentas por área', kind: 'chart', measure: 'accounts', chart: { style: 'bars', group_by: 'business_unit' }, position: 1, buckets: byArea('accounts') }),
    widget({ widget_id: 'safes-by-status', title: 'Safes por estado', kind: 'chart', measure: 'safes', chart: { style: 'pie', group_by: 'workflow_status' }, position: 2, buckets: counts(safes.map((safe) => safe.workflow)).map((bucket) => ({ ...bucket, filter_value: bucket.key })) }),
  ];
}

function netskopeMetrics() {
  const recent = devices.filter((device) => deviceAge(device) <= RECENT_DAYS);
  const usersWithRecent = new Set(recent.map((device) => device.personId));
  const perUser = people.map((person) => personDevices(person).length);
  const latest = devices.map((device) => device.lastSignalAt).sort().at(-1) ?? null;
  return {
    users_total: people.length, users_with_device_activity_7d: usersWithRecent.size,
    users_with_device_activity_14d: new Set(devices.filter((device) => deviceAge(device) <= 14).map((device) => device.personId)).size,
    users_with_device_activity_30d: new Set(devices.filter((device) => deviceAge(device) <= 30).map((device) => device.personId)).size,
    devices_total: devices.length, devices_stale_30d: devices.filter((device) => deviceAge(device) > 30).length,
    source_evidence: sourceState, devices_with_observed_user: devices.length, last_observed_at: latest,
    devices_by_os: counts(devices.map((device) => device.os)), devices_by_client: counts(devices.map((device) => device.clientVersion)),
    devices_by_make: counts(devices.map((device) => device.os === 'Mac OS X' ? 'Apple' : 'Lenovo')),
    devices_by_classification: [{ key: 'managed', count: devices.length }], devices_by_user_status: [{ key: 'enabled', count: devices.length }],
    devices_by_company: [{ key: company.name, count: devices.length }], users_by_company: [{ key: company.name, count: people.length }],
    devices_observed_user_matched: devices.length, devices_observed_user_ambiguous: 0, devices_observed_user_unmatched: 0,
    devices_by_observed_user_status: [{ key: 'matched', count: devices.length }, { key: 'ambiguous', count: 0 }, { key: 'unmatched', count: 0 }],
    devices_active_total: recent.length,
    users_without_observed_devices: perUser.filter((count) => count === 0).length,
    users_by_device_count: [
      { key: '0', count: perUser.filter((count) => count === 0).length },
      { key: '1', count: perUser.filter((count) => count === 1).length },
      { key: '2plus', count: perUser.filter((count) => count >= 2).length },
    ],
    users_by_recent_device_age: [
      { key: 'lt_24h', count: usersWithRecent.size }, { key: 'd1_7', count: 0 }, { key: 'd7_30', count: 0 },
      { key: 'gt_30d', count: 0 }, { key: 'unknown', count: people.length - usersWithRecent.size },
    ],
    coverage_risk_devices_by_user: people.filter((person) => personDevices(person).some((device) => deviceAge(device) > RECENT_DAYS))
      .map((person) => ({ key: person.name, filter_value: `acme-netskope-${person.id}`, count: personDevices(person).filter((device) => deviceAge(device) > RECENT_DAYS).length })),
  };
}

function freshness() {
  const bucket = (key: string, label: string, test: (age: number) => boolean) => ({ key, label, count: devices.filter((device) => test(deviceAge(device))).length, by_classification: [] });
  return {
    thresholds: { recent_hours: 24, week_days: 7, stale_days: 30 }, total: devices.length,
    review_candidates: devices.filter((device) => deviceAge(device) > RECENT_DAYS).length, source_evidence: sourceState,
    buckets: [
      bucket('lt_24h', 'Menos de 24 h', (age) => age < 1), bucket('d1_7', '1 a 7 días', (age) => age >= 1 && age <= 7),
      bucket('d7_30', '7 a 30 días', (age) => age > 7 && age <= 30), bucket('gt_30d', 'Más de 30 días', (age) => age > 30),
      bucket('unknown', 'Sin dato', () => false),
    ],
  };
}

function summary() {
  const rows = safes.map(safeRow);
  return {
    safes: rows.length, business_safes: rows.filter((row) => row.inventory_scope === 'business').length, internal_safes: 0,
    scope_pending_safes: 0, scope_candidate_safes: 0, clean_business_safes: rows.filter((row) => row.data_quality_status === 'clean').length,
    obsolete_safes: 0, duplicate_safes: 0, accounts: accounts.length,
    pending_classification: rows.filter((row) => row.classification_status === 'pending').length,
    assigned: rows.filter((row) => row.classification_status === 'assigned').length, review: 0,
    latest_run: { run_id: 'acme-cyberark-complete', status: 'completed', started_at: '2026-10-22T12:58:00Z', completed_at: company.capturedAt, source_file: 'fictional-cyberark' },
    safe_health: { denominator: rows.length, missing_cpm: 0, no_accounts: rows.filter((row) => row.account_count === 0).length, olac_disabled: 0, retention_unconfigured: 0, manage_safe_concentration: 0 },
  };
}

/** Respuesta del modelo para la ruta, o null si la demo delega en la API simulada. */
export function acmeResponse(url: URL, method: string): Json | null {
  if (method !== 'GET') return null;
  const path = url.pathname;
  const q = url.searchParams.get('q') ?? url.searchParams.get('search') ?? '';
  const email = url.searchParams.get('email') ?? '';
  const byEmail = people.find((person) => person.email === email);

  if (path === '/api/chains/person/search') {
    return { query: q, people: people.filter((person) => matches(`${person.name} ${person.email}`, q)).map((person) => ({
      email: person.email, name: person.name, sources: [...(person.pamId ? ['pam'] : []), 'identity', 'netskope'],
    })) };
  }
  if (path === '/api/chains/person') return byEmail ? personSummary(byEmail) : { email, name: '', tools: {} };
  if (path === '/api/chains/person/coverage') return coverageSummary();
  if (path === '/api/chains/person/coverage/detail') return byEmail ? coverage(byEmail) : null;

  if (path === '/api/summary') return summary();
  if (path === '/api/dashboard/preferences') return { widgets: dashboardWidgets(), is_default: true };
  if (path === '/api/catalogs') {
    return {
      business_units: company.areas.map((area) => ({ business_unit_id: areaIds.get(area), unit_code: areaCode(area), unit_name: area, is_active: true })),
      responsibles: people.map((person) => ({ responsible_id: person.id, display_name: person.name, email: person.email, is_active: true })),
      account_types: [],
    };
  }
  if (path === '/api/analytics') {
    return {
      workflow_status: counts(safes.map((safe) => safe.workflow)), next_actions: [{ key: 'Sin definir', count: safes.length }], account_types: [],
      business_units: counts(safes.map((safe) => safe.area)).map((bucket) => ({ ...bucket, label: bucket.key })),
      responsibles: counts(safes.map((safe) => personById.get(safe.responsibleId)?.name ?? 'Sin responsable')).map((bucket) => ({ ...bucket, label: bucket.key })),
    };
  }
  if (path === '/api/safes') {
    const rows = safes.map(safeRow).filter((row) => matches(`${row.safe_name} ${row.business_unit_name} ${row.responsible_name}`, q));
    return { ...page(rows, url), classification_counts: {
      assigned: rows.filter((row) => row.classification_status === 'assigned').length, review: 0,
      pending: rows.filter((row) => row.classification_status === 'pending').length,
    } };
  }
  const safeMatch = path.match(/^\/api\/safes\/([^/]+)(\/accounts|\/audit)?$/);
  if (safeMatch) {
    const key = decodeURIComponent(safeMatch[1]);
    const safe = safes.find((item) => String(item.id) === key || item.name === key);
    if (!safe) return null;
    if (safeMatch[2] === '/accounts') return { rows: safeAccounts(safe.id).map(accountRow), total: safeAccounts(safe.id).length, limit: 200, offset: 0 };
    if (safeMatch[2] === '/audit') return { rows: [] };
    return safeDetail(safe);
  }
  if (path === '/api/accounts') {
    return page(accounts.map(accountRow).filter((row) => matches(`${row.account_name} ${row.user_name} ${row.address} ${row.safe_name}`, q)), url);
  }
  if (path === '/api/cmdb/pam-users') {
    return page(people.filter((person) => person.pamId && matches(`${person.name} ${person.email}`, q)).map((person) => ({
      object_id: person.pamId, display_name: person.email, source_id: `acme-pam-${person.id}`, role_count: 1,
      standard_seat_reconciled: true, enabled: true, suspended: false,
    })), url);
  }

  if (path === '/api/cmdb/netskope/sync-evidence') return sourceState;
  if (path === '/api/cmdb/netskope/metrics') return netskopeMetrics();
  if (path === '/api/cmdb/netskope/devices/freshness') return freshness();
  if (path === '/api/cmdb/netskope/devices/facets') {
    return {
      os: counts(devices.map((device) => device.os)), client_version: counts(devices.map((device) => device.clientVersion)),
      classification_status: [{ key: 'managed', count: devices.length }], user_status: [{ key: 'enabled', count: devices.length }],
      company: [{ key: company.name, count: devices.length }],
    };
  }
  if (path === '/api/cmdb/netskope/devices') {
    return page(devices.map(deviceRow).filter((row) => matches(`${row.display_name} ${row.attributes.username}`, q)), url);
  }
  if (path === '/api/cmdb/netskope/users') {
    return page(people.filter((person) => matches(`${person.name} ${person.email}`, q)).map(userRow), url);
  }
  return null;
}

export function withAcmeData(fallback: Handler, now = () => Date.now()): Handler {
  return async (request) => {
    const url = new URL(request.url);
    const body = acmeResponse(url, request.method);
    if (body === null) return fallback(request);
    const offset = Math.floor((now() - asOf) / HOUR) * HOUR - HOUR;
    return { status: 200, contentType: 'application/json', body: JSON.stringify(shiftDates(body, offset)) };
  };
}
