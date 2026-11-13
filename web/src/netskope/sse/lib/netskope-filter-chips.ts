import { STALE_EXPLANATION_LABELS, NETSKOPE_REVIEW_ATTENTION_LABELS, NETSKOPE_REVIEW_STATUS_LABELS, reviewDiagnosisLabel } from './netskope-device-review.ts';
import { presenceStatusLabel } from './netskope-presence.ts';
import { uciRatingLabel } from './netskope-fleet-groups.ts';
import type { NetskopeDeviceFilterKey, NetskopeDeviceQuery, NetskopeEventAge } from '../types/netskope';
import { t } from '../../../cross/i18n/index.ts';

export const NETSKOPE_EVENT_AGE_OPTIONS: Array<{ value: NetskopeEventAge; label: string }> = [
  { value: '', label: 'Cualquier antigüedad' },
  { value: 'lt_24h', label: t('Evento en las últimas 24 h') },
  { value: 'd1_7', label: t('Evento hace 1 a 7 días') },
  { value: 'd7_30', label: t('Evento hace 7 a 30 días') },
  { value: 'gt_30d', label: t('Sin eventos hace más de 30 días') },
  { value: 'unknown', label: t('Sin dato de evento') },
];

export type NetskopeFilterChip = {
  id: string;
  label: string;
  clear: Partial<Omit<NetskopeDeviceQuery, 'filters'>> | { filter: NetskopeDeviceFilterKey };
};

type NetskopeFilterChipLabels = {
  evidenceState: Record<string, string>;
  change: Record<string, string>;
  clientCompliance: Record<string, string>;
  osCompliance: Record<string, string>;
};

const DEVICE_FILTER_CHIP_LABELS: Record<NetskopeDeviceFilterKey, string> = {
  os: 'SO',
  client_version: 'Cliente',
  classification_status: t('Clasificación'),
  user_status: t('Estado de usuario'),
  company: 'Empresa',
  last_seen_event: t('Último evento'),
  device_make: 'Fabricante',
  device_model: 'Modelo',
  hostname: 'Hostname',
  username: 'Usuario',
  observed_user_status: t('Usuario observado'),
  observed_user: t('Usuario resuelto'),
  onprem_status: t('Ubicación'),
  client_config: 'Client config',
  uci_rating: 'Confianza (UCI)',
};
const INVENTORY_FILTER_CHIP_KEYS: NetskopeDeviceFilterKey[] = ['os', 'client_version', 'classification_status', 'user_status', 'company', 'last_seen_event'];

const OBSERVED_USER_STATUS_LABELS: Record<string, string> = { matched: 'Con usuario resuelto', ambiguous: 'Ambiguo', unmatched: t('Sin resolver') };

export const NETSKOPE_CHANGE_LABELS: Record<string, string> = {
  added: t('Nuevos en la última corrida'), upgraded: t('Actualizaron el cliente'), downgraded: t('Bajaron de versión'),
  version_changed: t('Versión no comparable cambiada'), os_changed: t('Cambiaron de SO'), classification_changed: t('Cambiaron de clasificación'),
};
export const NETSKOPE_CLIENT_COMPLIANCE_LABELS: Record<string, string> = { current: t('Al día'), one_behind: t('1 golden atrás'), two_plus_behind: t('2 o más golden atrás'), unrecognized: t('Versión no reconocida') };
export const NETSKOPE_OS_COMPLIANCE_LABELS: Record<string, string> = { supported: 'Soportado', below_minimum: t('Debajo del mínimo'), no_baseline: t('SO sin mínimo configurado'), unrecognized: t('Versión de SO no reconocida') };

/* Keep every inventory criterion visible even when its disclosure is closed.
   The evidence labels come from the evidence component to keep its terminology
   as the single UI source. */
export function netskopeFilterChips(query: NetskopeDeviceQuery, labels: NetskopeFilterChipLabels): NetskopeFilterChip[] {
  const chips: NetskopeFilterChip[] = [];
  if (query.observedUserId) chips.push({ id: 'person', label: t('Usuario exacto · ID {observedUserId}', { observedUserId: query.observedUserId }), clear: { observedUserId: undefined } });
  if (query.deviceObjectId) chips.push({ id: 'device', label: t('Equipo · ID {deviceObjectId}', { deviceObjectId: query.deviceObjectId }), clear: { deviceObjectId: undefined } });
  if (query.evidenceState) chips.push({ id: 'evidence', label: labels.evidenceState[query.evidenceState], clear: { evidenceState: '' } });
  if (query.reviewDiagnosis) chips.push({ id: 'review-diagnosis', label: t('Diagnóstico: {reviewDiagnosis}', { reviewDiagnosis: reviewDiagnosisLabel(query.reviewDiagnosis) }), clear: { reviewDiagnosis: '' } });
  if (query.reviewSuggestion) chips.push({ id: 'review-suggestion', label: STALE_EXPLANATION_LABELS[query.reviewSuggestion] ?? query.reviewSuggestion, clear: { reviewSuggestion: '' } });
  if (query.reviewAttention) chips.push({ id: 'review-attention', label: NETSKOPE_REVIEW_ATTENTION_LABELS[query.reviewAttention] ?? query.reviewAttention, clear: { reviewAttention: '' } });
  if (query.reviewStatus) chips.push({ id: 'review-status', label: `Seguimiento: ${NETSKOPE_REVIEW_STATUS_LABELS[query.reviewStatus] ?? query.reviewStatus}`, clear: { reviewStatus: '' } });
  if (query.change) chips.push({ id: 'change', label: `Cambio: ${labels.change[query.change] ?? query.change}`, clear: { change: '' } });
  if (query.clientCompliance) chips.push({ id: 'client', label: `Cliente: ${labels.clientCompliance[query.clientCompliance] ?? query.clientCompliance}`, clear: { clientCompliance: '' } });
  if (query.osCompliance) chips.push({ id: 'os', label: `SO: ${labels.osCompliance[query.osCompliance] ?? query.osCompliance}`, clear: { osCompliance: '' } });
  if (query.eventAge) {
    const ageLabel = NETSKOPE_EVENT_AGE_OPTIONS.find((option) => option.value === query.eventAge)?.label ?? query.eventAge;
    chips.push({ id: 'event-age', label: t('Antigüedad del evento: {ageLabel}', { ageLabel: ageLabel }), clear: { eventAge: '' } });
  }
  if (query.filters.device_make) chips.push({ id: 'make', label: `Fabricante: ${query.filters.device_make}`, clear: { filter: 'device_make' } });
  if (query.filters.device_model) chips.push({ id: 'model', label: `Modelo: ${query.filters.device_model}`, clear: { filter: 'device_model' } });
  if (query.duplicate) chips.push({ id: 'duplicate', label: query.duplicate === 'hostname' ? 'Posible duplicado: hostname repetido' : t('Posible duplicado: usuario en varios equipos'), clear: { duplicate: '' } });
  if (query.freshness === 'all' && !query.evidenceState && !query.reviewDiagnosis && !query.reviewStatus && !query.reviewAttention && !query.reviewSuggestion && !query.observedUserId && !query.deviceObjectId) chips.push({ id: 'freshness', label: t('Incluye dispositivos sin evento en 7 días'), clear: { freshness: 'recent' } });
  if (query.filters.hostname) chips.push({ id: 'hostname', label: `Hostname: ${query.filters.hostname}`, clear: { filter: 'hostname' } });
  if (query.filters.username) chips.push({ id: 'username', label: t('Usuario: {username}', { username: query.filters.username }), clear: { filter: 'username' } });
  if (query.filters.observed_user_status) chips.push({ id: 'observed-user-status', label: t('Usuario observado: {observed_user_status}', { observed_user_status: OBSERVED_USER_STATUS_LABELS[query.filters.observed_user_status] ?? query.filters.observed_user_status }), clear: { filter: 'observed_user_status' } });
  if (query.filters.onprem_status) chips.push({ id: 'onprem-status', label: t('Ubicación: {onprem_status}', { onprem_status: presenceStatusLabel(query.filters.onprem_status) }), clear: { filter: 'onprem_status' } });
  if (query.filters.uci_rating) chips.push({ id: 'uci-rating', label: `Confianza (UCI): ${uciRatingLabel(query.filters.uci_rating)}`, clear: { filter: 'uci_rating' } });
  if (query.filters.client_config) chips.push({ id: 'client-config', label: `Client config: ${query.filters.client_config}`, clear: { filter: 'client_config' } });
  if (query.filters.observed_user) chips.push({ id: 'observed-user', label: t('Usuario resuelto: {observed_user}', { observed_user: query.filters.observed_user }), clear: { filter: 'observed_user' } });
  if (query.coverageRisk) chips.push({ id: 'coverage-risk', label: t('Último evento: desinstalación o deshabilitación'), clear: { coverageRisk: '' } });
  for (const key of INVENTORY_FILTER_CHIP_KEYS) {
    const value = query.filters[key];
    if (value) chips.push({ id: `filter-${key}`, label: `${DEVICE_FILTER_CHIP_LABELS[key]}: ${value}`, clear: { filter: key } });
  }
  return chips;
}

export function netskopeFilterGroupCounts(query: NetskopeDeviceQuery) {
  const identityKeys: NetskopeDeviceFilterKey[] = ['user_status', 'company', 'classification_status', 'os', 'client_version'];
  return {
    identity: identityKeys.filter((key) => query.filters[key]).length,
    activity: Number(Boolean(query.eventAge)) + Number(Boolean(query.filters.last_seen_event)),
    place: Number(Boolean(query.filters.onprem_status)) + Number(Boolean(query.filters.uci_rating)),
    diagnosis: Number(Boolean(query.reviewDiagnosis)) + Number(Boolean(query.reviewStatus)) + Number(Boolean(query.reviewAttention)) + Number(Boolean(query.reviewSuggestion)),
  };
}
