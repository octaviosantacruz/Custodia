// Lectura de presentación sobre el modelo de Acme Corp (company.ts).
// No decide nada nuevo: agrupa por fuente, aplica el escenario de captura
// y deriva hallazgos cruzados con la regla y las fuentes que los sostienen.
import { accounts, company, coverage, people, personDevices, personSummary, safes, sourceEvidence, type CoverageStatus, type Person, type SourceMode } from './company.ts';

export type SourceKey = 'pam' | 'sse';
export type PlannedKey = 'edr' | 'vuln' | 'firewall';

export type SourceInfo = { key: SourceKey | PlannedKey; mono: string; kind: string; product: string; detail: string };

/**
 * Fuentes conectadas en la demo: el color de cada una es su procedencia.
 * CyberArk es una sola fuente con dos módulos: Identity (identidades y roles)
 * y PAM (Safes y cuentas).
 */
export const SOURCES: Record<SourceKey, SourceInfo> = {
  pam: { key: 'pam', mono: 'PA', kind: 'Identidad y privilegios', product: 'CyberArk', detail: 'Identidades y roles (Identity); Safes, cuentas y miembros (PAM).' },
  sse: { key: 'sse', mono: 'SE', kind: 'Red y navegación', product: 'Netskope', detail: 'Usuarios, equipos y señal del cliente.' },
};
export const SOURCE_ORDER: SourceKey[] = ['pam', 'sse'];

/** Fuentes del plan: tienen color reservado, pero ningún adaptador ni dato. */
export const PLANNED: SourceInfo[] = [
  { key: 'edr', mono: 'ED', kind: 'Endpoint', product: 'CrowdStrike · Cortex XDR', detail: 'Sensor instalado y activo por equipo.' },
  { key: 'vuln', mono: 'VU', kind: 'Vulnerabilidades', product: 'Tenable', detail: 'Exposición por activo.' },
  { key: 'firewall', mono: 'FW', kind: 'Firewalls', product: 'Por definir', detail: 'Reglas y tráfico por segmento.' },
];

export const VERDICT_LABEL: Record<CoverageStatus, string> = { covered: 'Cubierto', partial: 'Parcial', gap: 'Brecha', unknown: 'Desconocido' };

export const MODE_LABEL: Record<SourceMode, string> = { complete: 'Completa y vigente', stale: 'Desactualizada (73 h)', partial: 'Parcial' };

const HOUR = 3_600_000;
const asOf = Date.parse(company.asOf);

/** Tiempo relativo al instante de la captura, no al reloj del visitante. */
export function ago(iso: string) {
  const hours = Math.round((asOf - Date.parse(iso)) / HOUR);
  if (hours < 1) return 'hace minutos';
  if (hours < 48) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

export function sourceRun(key: SourceKey, mode: SourceMode) {
  if (key === 'pam') return { ...sourceEvidence('cyberark'), freshness: 'fresh' as const };
  const run = sourceEvidence('netskope', mode);
  return { ...run, freshness: run.freshness as 'fresh' | 'stale' | 'incomplete' };
}

/** Equipos tal como los ve la captura elegida: una captura vieja no tiene señales más nuevas que ella. */
export function devicesFor(person: Person, mode: SourceMode) {
  return personDevices(person).map(device => {
    const lastSignalAt = mode === 'stale' ? new Date(Date.parse(device.lastSignalAt) - 72 * HOUR).toISOString() : device.lastSignalAt;
    return { ...device, lastSignalAt, recent: asOf - Date.parse(lastSignalAt) <= 7 * 24 * HOUR };
  });
}

export function allDevices(mode: SourceMode) {
  return people.flatMap(person => devicesFor(person, mode).map(device => ({ ...device, person })));
}

export function personView(person: Person, mode: SourceMode) {
  const summary = personSummary(person);
  const personSafes = safes.filter(safe => person.safeIds.includes(safe.id));
  return {
    person,
    coverage: coverage(person, mode),
    identity: summary.tools.identity,
    pam: summary.tools.pam,
    sse: summary.tools.netskope,
    safes: personSafes.map(safe => ({ ...safe, accounts: accounts.filter(account => account.safeId === safe.id) })),
    devices: devicesFor(person, mode),
  };
}

export type Insight = {
  id: string; tone: CoverageStatus; title: string; person: Person; sources: SourceKey[]; rule: string; detail: string;
};

const TONE_ORDER: Record<CoverageStatus, number> = { gap: 0, partial: 1, unknown: 2, covered: 3 };

/**
 * Hallazgos cruzados: sólo existen cuando dos fuentes, juntas, dicen
 * algo que ninguna dice sola. Cada uno nombra la regla y las fuentes.
 */
export function insights(mode: SourceMode): Insight[] {
  const list: Insight[] = [];
  for (const person of people) {
    const view = personView(person, mode);
    if (view.identity.status === 'ambiguous') {
      list.push({ id: `dup-${person.id}`, tone: 'unknown', person, sources: ['pam', 'sse'],
        title: 'Dos identidades activas comparten un correo',
        rule: 'Unión sólo por correo exacto y único', detail: 'No se elige una automáticamente. La cobertura queda desconocida hasta que una persona decida.' });
    }
    if (!person.pamId) continue;
    const status = view.coverage.status;
    if (status === 'gap') {
      list.push({ id: `gap-${person.id}`, tone: 'gap', person, sources: ['pam', 'sse'],
        title: 'Acceso privilegiado sin ningún equipo observado',
        rule: 'CONN-001 v1 · señal del cliente en 7 días', detail: `${view.safes.map(s => s.name).join(', ')} · ninguna señal de Netskope en una captura completa.` });
    } else if (status === 'partial') {
      list.push({ id: `partial-${person.id}`, tone: 'partial', person, sources: ['pam', 'sse'],
        title: 'Acceso privilegiado con un equipo sin señal reciente',
        rule: 'CONN-001 v1 · señal del cliente en 7 días', detail: `${view.safes.map(s => s.name).join(', ')} · ${view.devices.filter(d => !d.recent).map(d => d.hostname).join(', ')} sin señal. No confirma abandono.` });
    } else if (status === 'unknown' && mode !== 'complete') {
      list.push({ id: `blind-${person.id}`, tone: 'unknown', person, sources: ['pam', 'sse'],
        title: 'Acceso privilegiado con cobertura no evaluable',
        rule: 'Captura de Netskope fuera de umbral', detail: 'Hay acceso privilegiado, pero la captura no permite afirmar ni negar cobertura.' });
    }
  }
  return list.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
}
