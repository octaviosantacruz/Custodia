import type { NetskopeReviewAttention, NetskopeReviewSuggestion } from '../types/netskope';
import { t } from '../../../cross/i18n/index.ts';

/* NSK-DEVREV-001 labels, kept to read decisions saved before manual classification left the screens (NSK-INV-002):
   the inventory chips of an old deep link still need their words. */
export const NETSKOPE_REVIEW_DIAGNOSES: Array<{ value: string; label: string; hint: string }> = [
  { value: 'undetermined', label: t('Sin determinar'), hint: t('Todavía no hay una explicación confirmada.') },
  { value: 'uninstalled_reported', label: t('Desinstalación o deshabilitación informada'), hint: t('El último evento de Netskope lo indica; no prueba que se haya dado de baja el equipo.') },
  { value: 'replaced', label: 'Registro reemplazado', hint: t('Hay un registro más reciente del mismo equipo o usuario. Requiere confirmación de operaciones.') },
  { value: 'decommissioned', label: t('Baja confirmada'), hint: t('Requiere la referencia de la baja del activo.') },
  { value: 'in_use_not_reporting', label: t('En uso, sin reporte'), hint: t('El equipo se usa pero Netskope no recibe su señal: hay que recuperar el cliente.') },
  { value: 'historical_record', label: t('Registro histórico sin evidencia'), hint: t('Registro antiguo sin ninguna otra señal. No es una baja ni afirma que el equipo no exista.') },
  { value: 'temporary_exception', label: t('Excepción temporal'), hint: t('Requiere aprobador, motivo y vencimiento; al vencer vuelve a pendiente.') },
];
export const NETSKOPE_REVIEW_STATUSES: Array<{ value: string; label: string }> = [
  { value: 'pending', label: t('Pendiente') },
  { value: 'investigating', label: 'Investigando' },
  { value: 'ticket_open', label: 'Ticket abierto' },
  { value: 'resolved', label: t('Resuelto') },
];

export const NETSKOPE_REVIEW_DIAGNOSIS_LABELS: Record<string, string> = Object.fromEntries(NETSKOPE_REVIEW_DIAGNOSES.map((item) => [item.value, item.label]));
export const NETSKOPE_REVIEW_STATUS_LABELS: Record<string, string> = Object.fromEntries(NETSKOPE_REVIEW_STATUSES.map((item) => [item.value, item.label]));
/** "Sin clasificar" is what the drill and the card call a device with no decision or an undetermined one. */
export const NETSKOPE_UNCLASSIFIED_LABEL = t('Sin clasificar');
export function reviewDiagnosisLabel(value: string): string {
  return value === 'undetermined' ? NETSKOPE_UNCLASSIFIED_LABEL : NETSKOPE_REVIEW_DIAGNOSIS_LABELS[value] ?? value;
}

export const NETSKOPE_SUGGESTION_ORDER: NetskopeReviewSuggestion[] = ['uninstalled_reported', 'replaced', 'historical_record'];

export const NETSKOPE_REVIEW_ATTENTION_LABELS: Record<NetskopeReviewAttention, string> = {
  open_incident: t('Incidencias abiertas (en uso sin reporte, no resueltas)'),
  expired_exception: 'Excepciones vencidas',
  reported_again: t('Volvieron a reportar tras una decisión'),
};

/** NSK-INV-002: the same words in the Postura groups and in the inventory chip they open. */
export const STALE_EXPLANATION_LABELS: Record<NetskopeReviewSuggestion | 'none', string> = {
  uninstalled_reported: t('Netskope informó desinstalación o deshabilitación'),
  replaced: t('Reemplazado por un registro más nuevo'),
  historical_record: t('Registro histórico (sin señal hace más de 180 días)'),
  none: t('Sin explicación con los datos de Netskope'),
};
