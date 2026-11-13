/* NSK-EXP-ONPREM-001: labels and shares for Netskope's On-Premises Detection.
   "En oficina" and "Fuera de oficina" are Netskope's own classification (a configured
   corporate network matched, or not); a device without the field is "Sin dato" and is
   never counted as remote. */

export type PresenceStatusKey = 'on-prem' | 'off-prem' | 'unconfig' | 'Unknown' | 'Sin dato';

const STATUS_LABELS: Record<string, string> = {
  'on-prem': 'En oficina',
  'off-prem': t('Fuera de oficina'),
  'unconfig': t('Detección sin configurar'),
  'Unknown': 'Desconocido',
  'Sin dato': 'Sin dato',
};

export function presenceStatusLabel(key: string): string {
  return STATUS_LABELS[key] ?? key;
}

import { t } from '../../../cross/i18n/index.ts';