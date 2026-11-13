// Inventario de cada herramienta tal como lo entrega la fuente. Sin veredictos:
// cada fila trae su ID de origen y, aparte, el vínculo que Custodia propone con
// una persona y por qué. Todo sale del mismo escenario de Acme Corp.
import { accounts, company, people, safes, type Person, type SourceMode } from './company.ts';
import { allDevices, sourceRun } from './view.ts';
import { t } from '../../cross/i18n/index.ts';

export type Raw = Record<string, string | number | boolean | null>;
export type Bond = { person: Person; basis: 'correo exacto' | 'ambiguo, sin unir' | 'miembro del Safe' | 'responsable' };

const roleName = (safeId: number) => {
  const safe = safes.find(s => s.id === safeId)!;
  return `${safe.area} · ${safe.name.includes('PROD') ? t('Producción') : 'Desarrollo'}`;
};
const members = (safeId: number) => people.filter(p => p.safeIds.includes(safeId));

/* ---------- CyberArk · Identity ---------- */

export function cyberarkIdentities() {
  return people.flatMap(person => person.identityIds.map(id => ({
    id: `acme-identity-${id}`,
    name: person.name,
    email: person.email,
    state: 'activa',
    roles: person.safeIds.map(roleName),
    bonds: [{ person, basis: person.identityIds.length > 1 ? t('ambiguo, sin unir') : 'correo exacto' }] as Bond[],
    raw: { object_id: id, source_id: `acme-identity-${id}`, display_name: person.name, email: person.email, active: true,
      area: person.area, site: person.site, observed_at: company.capturedAt } satisfies Raw,
  })));
}

export function cyberarkRoles() {
  return safes.map(safe => ({
    id: `acme-role-${safe.id}`,
    name: roleName(safe.id),
    safes: [safe.name],
    bonds: members(safe.id).map(person => ({ person, basis: t('miembro del Safe') })) as Bond[],
    raw: { object_id: 400 + safe.id, source_id: `acme-role-${safe.id}`, name: roleName(safe.id), grants_safe: safe.name,
      member_count: members(safe.id).length, observed_at: company.capturedAt } satisfies Raw,
  }));
}

/* ---------- CyberArk · PAM ---------- */

export function cyberarkSafes() {
  return safes.map(safe => {
    const owner = people.find(p => p.id === safe.responsibleId)!;
    const list = accounts.filter(a => a.safeId === safe.id);
    return {
      id: safe.name,
      area: safe.area,
      accounts: list.length,
      members: members(safe.id).length,
      cpm: 'CPM-ACME',
      retention: t('30 días · 5 versiones'),
      review: safe.workflow === 'in_progress' ? t('En revisión') : t('Pendiente'),
      note: safe.note,
      bonds: [{ person: owner, basis: 'responsable' }, ...members(safe.id).filter(p => p.id !== owner.id).map(person => ({ person, basis: t('miembro del Safe') }))] as Bond[],
      raw: { safe_number: safe.id, safe_name: safe.name, managing_cpm: 'CPM-ACME', number_of_days_retention: 30,
        number_of_versions_retention: 5, olac_enabled: true, account_count: list.length, observed_at: company.capturedAt } satisfies Raw,
    };
  });
}

export function cyberarkAccounts() {
  return accounts.map(account => {
    const safe = safes.find(s => s.id === account.safeId)!;
    return {
      id: account.id,
      name: account.name,
      user: account.userName,
      address: account.address,
      platform: account.platform,
      safe: safe.name,
      managed: account.automaticManagement,
      bonds: members(safe.id).map(person => ({ person, basis: t('miembro del Safe') })) as Bond[],
      raw: { account_id: account.id, account_name: account.name, user_name: account.userName, address: account.address,
        platform_id: account.platform, safe_name: safe.name, automatic_management_enabled: account.automaticManagement,
        management_status: account.automaticManagement ? 'success' : 'disabled', secret_modified_at: company.capturedAt } satisfies Raw,
    };
  });
}

export function cyberarkPlatforms() {
  return [...new Set(accounts.map(a => a.platform))].map(platform => {
    const list = accounts.filter(a => a.platform === platform);
    return {
      id: platform,
      accounts: list.length,
      safes: [...new Set(list.map(a => safes.find(s => s.id === a.safeId)!.name))],
      managed: list.filter(a => a.automaticManagement).length,
      raw: { platform_id: platform, account_count: list.length, observed_at: company.capturedAt } satisfies Raw,
    };
  });
}

/* ---------- Netskope ---------- */

export function netskopeUsers(mode: SourceMode) {
  const devices = allDevices(mode);
  return people.map(person => {
    const own = devices.filter(d => d.person.id === person.id);
    const last = own.map(d => d.lastSignalAt).sort().at(-1) ?? null;
    return {
      id: `acme-netskope-${person.id}`,
      name: person.name,
      email: person.email,
      devices: own.length,
      recent: own.filter(d => d.recent).length,
      lastSignalAt: last,
      bonds: [{ person, basis: 'correo exacto' }] as Bond[],
      raw: { object_id: person.netskopeId, source_id: `acme-netskope-${person.id}`, user_email: person.email,
        display_name: person.name, device_count: own.length, last_event_at: last, company: company.name } satisfies Raw,
    };
  });
}

export function netskopeDevices(mode: SourceMode) {
  return allDevices(mode).map(device => ({
    ...device,
    bonds: [{ person: device.person, basis: 'correo exacto' }] as Bond[],
    raw: { object_id: device.id, source_id: device.deviceId, hostname: device.hostname, os: device.os, os_version: device.osVersion,
      client_version: device.clientVersion, user_email: device.person.email, last_event_at: device.lastSignalAt,
      device_make: device.os === 'Windows' ? 'Dell' : 'Apple' } satisfies Raw,
  }));
}

export function netskopeVersions(mode: SourceMode) {
  const devices = allDevices(mode);
  return [...new Set(devices.map(d => d.clientVersion))].sort().reverse().map(version => {
    const list = devices.filter(d => d.clientVersion === version);
    return {
      id: version,
      devices: list.length,
      systems: [...new Set(list.map(d => `${d.os} ${d.osVersion}`))],
      recent: list.filter(d => d.recent).length,
      raw: { client_version: version, device_count: list.length, observed_at: sourceRun('sse', mode).completed_at } satisfies Raw,
    };
  });
}
