import type { NetskopeAnomalySeverity } from '../types/netskope';

export const ANOMALY_SEVERITIES: NetskopeAnomalySeverity[] = ['high', 'medium', 'low', 'informational', 'unknown'];

export const ANOMALY_SEVERITY_LABELS: Record<NetskopeAnomalySeverity, string> = {
  high: 'Alta', medium: 'Media', low: 'Baja', informational: 'Informativa', unknown: 'Sin dato',
};

export const ANOMALY_SEVERITY_TONES: Record<NetskopeAnomalySeverity, 'danger' | 'warning' | 'info' | 'neutral'> = {
  high: 'danger', medium: 'warning', low: 'info', informational: 'neutral', unknown: 'neutral',
};

export function scenarioLabel(scenario: string | null, subScenario: string | null): string {
  if (scenario && subScenario) return `${scenario} · ${subScenario}`;
  return scenario || subScenario || 'Sin dato';
}
