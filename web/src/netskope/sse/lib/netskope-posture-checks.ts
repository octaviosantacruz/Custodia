/* NSK-POSTURE-001: pure helpers over the posture response. Every number is a
   count the backend evaluated; a check that could not be evaluated is never
   added as zero, it is reported apart as pending. */
import type { NetskopePostureCheck, NetskopePostureSeverity } from '../types/netskope';

export const POSTURE_SEVERITIES: NetskopePostureSeverity[] = ['high', 'medium', 'low'];
const SEVERITY_RANK: Record<NetskopePostureSeverity, number> = { high: 0, medium: 1, low: 2 };

export const POSTURE_SEVERITY_LABELS: Record<NetskopePostureSeverity, string> = { high: 'Alta', medium: 'Media', low: 'Baja' };

export function postureSeverityTone(severity: NetskopePostureSeverity): 'danger' | 'warning' | 'info' {
  return severity === 'high' ? 'danger' : severity === 'medium' ? 'warning' : 'info';
}

export function postureEntityLabel(check: Pick<NetskopePostureCheck, 'entity'>, count = 2): string {
  if (check.entity === 'user') return count === 1 ? 'usuario' : 'usuarios';
  return count === 1 ? 'equipo' : 'equipos';
}

export function postureStatusLabel(check: NetskopePostureCheck): string {
  if (check.status === 'evaluated') return 'Evaluado';
  if (check.status === 'not_permitted') return 'Requiere el permiso para confianza de usuarios';
  if (check.entity === 'user') return 'Captura de confianza de usuarios no habilitada';
  return check.id.startsWith('os_') ? 'Sin versiones mínimas de SO configuradas' : 'Sin releases golden configuradas';
}

/** Where to configure or obtain what a pending check needs. */
export function posturePendingHint(check: NetskopePostureCheck): string {
  if (check.status === 'not_permitted') return 'Sólo quien tiene el permiso para confianza de usuarios ve este chequeo.';
  if (check.entity === 'user') return 'Un administrador debe habilitar la captura del índice de confianza.';
  return 'Un administrador de Netskope carga la línea base desde Equipos.';
}

export type PostureSummary = {
  total: number;
  bySeverity: Record<NetskopePostureSeverity, number>;
  devices: number;
  users: number;
  /** Evaluated checks per entity: a total of 0 only means "none found" when this is > 0. */
  evaluatedDevices: number;
  evaluatedUsers: number;
  withFindings: number;
  evaluated: number;
  pending: NetskopePostureCheck[];
};

export function postureSummary(checks: NetskopePostureCheck[]): PostureSummary {
  const summary: PostureSummary = { total: 0, bySeverity: { high: 0, medium: 0, low: 0 }, devices: 0, users: 0, evaluatedDevices: 0, evaluatedUsers: 0, withFindings: 0, evaluated: 0, pending: [] };
  for (const check of checks) {
    if (check.status !== 'evaluated') { summary.pending.push(check); continue; }
    summary.evaluated += 1;
    summary.total += check.count;
    summary.bySeverity[check.severity] += check.count;
    if (check.entity === 'user') { summary.users += check.count; summary.evaluatedUsers += 1; } else { summary.devices += check.count; summary.evaluatedDevices += 1; }
    if (check.count > 0) summary.withFindings += 1;
  }
  return summary;
}

const STATUS_RANK = (check: NetskopePostureCheck) => check.status !== 'evaluated' ? 2 : check.count > 0 ? 0 : 1;

/** Every check in one list: with findings (most severe, then largest), then checked with none, then not evaluated. */
export function postureRows(checks: NetskopePostureCheck[], severity: NetskopePostureSeverity | '' = ''): NetskopePostureCheck[] {
  return checks
    .filter((check) => !severity || check.severity === severity)
    .sort((left, right) => STATUS_RANK(left) - STATUS_RANK(right) || SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] || right.count - left.count);
}

/** The inventory list behind a device check: its exact filters over the whole
 *  active inventory. User checks open the UCI view. */
export function postureDrill(check: NetskopePostureCheck): { view: 'netskopeInventory' | 'netskopeUci'; path: string } {
  if (check.entity === 'user') return { view: 'netskopeUci', path: '/netskope/uci' };
  const params = new URLSearchParams({ freshness: 'all', ...check.query });
  return { view: 'netskopeInventory', path: `/netskope/inventory?${params}` };
}
