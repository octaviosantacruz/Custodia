export function cyberarkSeverityCountsLabel(counts: Record<string, number> | null | undefined): string {
  if (!counts || Object.keys(counts).length === 0) return t('Sin datos');
  const values = Object.values(counts);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return t('Sin datos');
  return values.reduce((sum, value) => sum + value, 0).toLocaleString('es');
}

import { t } from '../../../cross/i18n/index.ts';