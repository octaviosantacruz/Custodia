import type { PersonClientCoverageDetail, PersonCoverageSourceRun, PersonToolSummary } from './chains-api';

/** Registration matching and current client coverage are independent evidence. */
export function personConnectionLink(identity: PersonToolSummary | undefined, netskope: PersonToolSummary | undefined) {
  if (identity?.status === 'ambiguous' || netskope?.status === 'ambiguous') {
    return { style: 'ambiguous' as const, label: 'Vínculo ambiguo', explanation: 'Hay varios candidatos. No se confirma una relación entre los registros.' };
  }
  if (identity?.status === 'matched' && netskope?.status === 'matched') {
    return { style: 'linked' as const, label: 'Vinculados por correo', explanation: 'Esta persona tiene registros vinculados por correo exacto, uno a uno, en Identity Administration y Netskope.' };
  }
  return { style: 'none' as const, label: 'Sin contraparte confirmada', explanation: 'No hay un vínculo confirmado entre un registro Identity y un usuario Netskope para esta persona.' };
}

const COVERAGE_SOURCES = [
  ['identity', 'Identity Administration'],
  ['netskope', 'Netskope'],
] as const;

function freshnessProblems(sources: Record<string, PersonCoverageSourceRun>): string[] {
  const problems: string[] = [];
  for (const [key, label] of COVERAGE_SOURCES) {
    const source = sources[key];
    if (!source) {
      problems.push(`${label}: frescura no informada`);
      continue;
    }
    if (source.freshness === 'fresh') continue;
    if (source.freshness === 'stale') problems.push(`${label} desactualizada`);
    else if (source.freshness === 'incomplete') problems.push(`${label} con última corrida incompleta`);
    else problems.push(`${label} sin corrida completa vigente`);
  }
  return problems;
}

function unavailableSourcesReason(sources: Record<string, PersonCoverageSourceRun>): string | null {
  const problems = freshnessProblems(sources);
  return problems.length ? `No se puede determinar: ${problems.join('; ')}.` : null;
}

/** Explains unknown for the selected person from that detail snapshot only. */
export function personCoverageDetailReason(detail: PersonClientCoverageDetail): string | null {
  if (detail.status !== 'unknown') return null;

  const sourceReason = unavailableSourcesReason(detail.sources);
  if (sourceReason) return sourceReason;
  if (detail.devices_ambiguous > 0 || detail.identity_records > 1 || detail.netskope_users > 1) {
    return 'No se puede determinar: la evidencia individual tiene candidatos o dispositivos ambiguos.';
  }
  if (detail.identity_records === 0) {
    return 'No se puede determinar: no hay un registro elegible de Identity para esta persona.';
  }
  if (detail.identity_records > 0 && detail.netskope_users === 0) {
    return 'No se puede determinar: no hay una contraparte Netskope observada para esta persona.';
  }
  return 'No se puede determinar: la evidencia individual es insuficiente para clasificar la cobertura.';
}
