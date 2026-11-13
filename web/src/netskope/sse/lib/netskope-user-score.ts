import type { NetskopeExperienceScoreComponent } from '../types/netskope';
import { t } from '../../../cross/i18n/index.ts';

export const PERFORMANCE_EXPLANATION = t('Cómo funcionan el equipo, la red y las aplicaciones, según Netskope.');
export const PERFORMANCE_SCALE = 'De 0 a 100: mayor puntaje, mejor rendimiento.';

export const SCORE_COMPONENT_LABELS: Record<NetskopeExperienceScoreComponent, string> = {
  device: 'Equipo',
  network: 'Red',
  app: 'Aplicaciones',
};

/** A score is 0-100; a missing one is "Sin dato", never 0. */
export function formatScore(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value)) : t('Sin dato');
}

export function weakestLabel(weakest: NetskopeExperienceScoreComponent | null): string | null {
  return weakest ? SCORE_COMPONENT_LABELS[weakest] : null;
}
