import fixture from './company.json' with { type: 'json' };

export const company = fixture.company;
export type Person = { id: number; name: string; email: string; area: string; site: string; identityIds: number[]; netskopeId: number; pamId: number | null; safeIds: number[]; case: string };
export const people: Person[] = fixture.people;
export const devices = fixture.devices;
export const safes = fixture.safes;
export const accounts = fixture.accounts;
export type SourceMode = 'complete' | 'stale' | 'partial';
export type CoverageStatus = 'covered' | 'partial' | 'gap' | 'unknown';
export const validMode = (value: string | null): SourceMode => value === 'stale' || value === 'partial' ? value : 'complete';
const ageDays = (at: string) => (Date.parse(company.asOf) - Date.parse(at)) / 86_400_000;
export const personDevices = (person: Person) => devices.filter(device => device.personId === person.id);
export const recentDevices = (person: Person) => personDevices(person).filter(device => ageDays(device.lastSignalAt) <= 7);

export function sourceEvidence(source: string, mode: SourceMode = 'complete') {
  const compromised = source === 'netskope' && mode !== 'complete';
  return {
    source_system: source, source_file: `fictional-${source}`, run_id: `faro-${source}-${mode}`,
    status: compromised && mode === 'partial' ? 'partial' : 'completed',
    started_at: compromised && mode === 'stale' ? '2026-10-19T12:00:00Z' : '2026-10-22T12:58:00Z',
    completed_at: compromised && mode === 'stale' ? '2026-10-19T13:00:00Z' : company.capturedAt,
    freshness: compromised ? mode === 'partial' ? 'incomplete' : 'stale' : 'fresh', age_hours: compromised && mode === 'stale' ? 73 : 1,
  };
}

// Presentation of CONN-001 v1, traced to Python person_client_coverage.py.
// This is a synthetic read model, not a replacement for backend authorization.
export function coverage(person: Person, mode: SourceMode = 'complete') {
  const total = personDevices(person).length;
  const recent = recentDevices(person).length;
  const unique = person.identityIds.length === 1;
  const status: CoverageStatus = mode !== 'complete' || !unique ? 'unknown'
    : recent === 0 ? 'gap' : recent < total ? 'partial' : 'covered';
  const explanation = status === 'unknown'
    ? !unique ? 'Hay dos identidades activas con el mismo correo. No se elige una automáticamente.'
      : mode === 'partial' ? 'La captura Netskope es parcial. No permite afirmar ausencia ni cobertura vigente.'
        : 'La captura Netskope tiene 73 horas. Supera el umbral de 24 horas; no se evalúa cobertura.'
    : status === 'gap' ? 'Identidad y usuario Netskope únicos, captura completa y vigente, pero ningún dispositivo reciente observado.'
      : status === 'partial' ? 'Hay un dispositivo reciente y otro sin señal en 7 días. No confirma abandono ni falta de EDR.'
        : 'Todos los dispositivos vinculados por usuario exacto tienen señal en los últimos 7 días. Sólo demuestra evidencia del cliente Netskope.';
  return {
    metric_code: 'CONN-001', metric_version: '1', email: person.email, status,
    identity_records: person.identityIds.length, netskope_users: 1,
    devices_recent: recent, devices_not_recent: total - recent, devices_total: total, devices_ambiguous: 0,
    sources: { identity: sourceEvidence('identity_administration'), netskope: sourceEvidence('netskope', mode) }, explanation,
  };
}

export function coverageSummary(mode: SourceMode = 'complete') {
  const counts = { denominator: people.length, covered: 0, partial: 0, gap: 0, unknown: 0,
    coverage_percent: null as number | null, devices_recent: devices.filter(d => ageDays(d.lastSignalAt) <= 7).length,
    devices_total: devices.length, device_coverage_percent: null as number | null };
  for (const person of people) counts[coverage(person, mode).status]++;
  if (mode === 'complete') {
    counts.coverage_percent = counts.covered / counts.denominator * 100;
    counts.device_coverage_percent = counts.devices_recent / counts.devices_total * 100;
  }
  return { metric_code: 'CONN-001', metric_version: '1', label: 'Cliente Netskope activo y observado recientemente',
    population: 'Personas activas de Faro Digital (Identity Administration)', person_freshness_hours: 24, device_freshness_days: 7,
    counts, sources: coverage(people[0], mode).sources };
}

export function personSummary(person: Person) {
  const linkedSafes = safes.filter(safe => person.safeIds.includes(safe.id));
  return { email: person.email, name: person.name, tools: {
    pam: person.pamId ? { status: 'matched', basis: 'email_exact',
      user: { object_id: person.pamId, display_name: person.name, source_id: `faro-pam-${person.id}`, user_type: 'EPVUser' },
      totals: { roles: 1, safes: linkedSafes.length, accounts: accounts.filter(a => person.safeIds.includes(a.safeId)).length,
        platforms: new Set(accounts.filter(a => person.safeIds.includes(a.safeId)).map(a => a.platform)).size, psms: 0 } }
      : { status: 'unmatched' },
    identity: person.identityIds.length !== 1 ? { status: 'ambiguous', basis: 'multiple_active_candidates' }
      : { status: 'matched', basis: 'email_exact', user: { object_id: person.identityIds[0], display_name: person.name,
        source_id: `faro-identity-${person.identityIds[0]}`, active: true }, role_count: person.pamId ? 1 : 0 },
    netskope: { status: 'matched', basis: 'email_exact', user: { object_id: person.netskopeId, display_name: person.name,
      source_id: `faro-netskope-${person.id}` }, device_count: recentDevices(person).length,
      stale_device_count: personDevices(person).length - recentDevices(person).length, company: company.name,
      client_versions: [...new Set(personDevices(person).map(d => d.clientVersion))], operating_systems: [...new Set(personDevices(person).map(d => d.os))] },
  } };
}
