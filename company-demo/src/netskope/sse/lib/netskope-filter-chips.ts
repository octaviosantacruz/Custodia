import { STALE_EXPLANATION_LABELS, NETSKOPE_REVIEW_ATTENTION_LABELS, NETSKOPE_REVIEW_STATUS_LABELS, reviewDiagnosisLabel } from './netskope-device-review.ts';
import { presenceStatusLabel } from './netskope-presence.ts';
import { uciRatingLabel } from './netskope-fleet-groups.ts';
import type { NetskopeDeviceFilterKey, NetskopeDeviceQuery, NetskopeEventAge } from '../types/netskope';

export const NETSKOPE_EVENT_AGE_OPTIONS: Array<{ value: NetskopeEventAge; label: string }> = [
  { value: '', label: 'Cualquier antigüedad' },
  { value: 'lt_24h', label: 'Evento en las últimas 24 h' },
  { value: 'd1_7', label: 'Evento hace 1 a 7 días' },
  { value: 'd7_30', label: 'Evento hace 7 a 30 días' },
  { value: 'gt_30d', label: 'Sin eventos hace más de 30 días' },
  { value: 'unknown', label: 'Sin dato de evento' },
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
  classification_status: 'Clasificación',
  user_status: 'Estado de usuario',
  company: 'Empresa',
  last_seen_event: 'Último evento',
  device_make: 'Fabricante',
  device_model: 'Modelo',
  hostname: 'Hostname',
  username: 'Usuario',
  observed_user_status: 'Usuario observado',
  observed_user: 'Usuario resuelto',
  onprem_status: 'Ubicación',
  client_config: 'Client config',
  uci_rating: 'Confianza (UCI)',
};
const INVENTORY_FILTER_CHIP_KEYS: NetskopeDeviceFilterKey[] = ['os', 'client_version', 'classification_status', 'user_status', 'company', 'last_seen_event'];

const OBSERVED_USER_STATUS_LABELS: Record<string, string> = { matched: 'Con usuario resuelto', ambiguous: 'Ambiguo', unmatched: 'Sin resolver' };

export const NETSKOPE_CHANGE_LABELS: Record<string, string> = {
  added: 'Nuevos en la última corrida', upgraded: 'Actualizaron el cliente', downgraded: 'Bajaron de versión',
  version_changed: 'Versión no comparable cambiada', os_changed: 'Cambiaron de SO', classification_changed: 'Cambiaron de clasificación',
};
export const NETSKOPE_CLIENT_COMPLIANCE_LABELS: Record<string, string> = { current: 'Al día', one_behind: '1 golden atrás', two_plus_behind: '2 o más golden atrás', unrecognized: 'Versión no reconocida' };
export const NETSKOPE_OS_COMPLIANCE_LABELS: Record<string, string> = { supported: 'Soportado', below_minimum: 'Debajo del mínimo', no_baseline: 'SO sin mínimo configurado', unrecognized: 'Versión de SO no reconocida' };

/* Keep every inventory criterion visible even when its disclosure is closed.
   The evidence labels come from the evidence component to keep its terminology
   as the single UI source. */
export function netskopeFilterChips(query: NetskopeDeviceQuery, labels: NetskopeFilterChipLabels): NetskopeFilterChip[] {
  const chips: NetskopeFilterChip[] = [];
  if (query.observedUserId) chips.push({ id: 'person', label: `Usuario exacto · ID ${query.observedUserId}`, clear: { observedUserId: undefined } });
  if (query.deviceObjectId) chips.push({ id: 'device', label: `Equipo · ID ${query.deviceObjectId}`, clear: { deviceObjectId: undefined } });
  if (query.evidenceState) chips.push({ id: 'evidence', label: labels.evidenceState[query.evidenceState], clear: { evidenceState: '' } });
  if (query.reviewDiagnosis) chips.push({ id: 'review-diagnosis', label: `Diagnóstico: ${reviewDiagnosisLabel(query.reviewDiagnosis)}`, clear: { reviewDiagnosis: '' } });
  if (query.reviewSuggestion) chips.push({ id: 'review-suggestion', label: STALE_EXPLANATION_LABELS[query.reviewSuggestion] ?? query.reviewSuggestion, clear: { reviewSuggestion: '' } });
  if (query.reviewAttention) chips.push({ id: 'review-attention', label: NETSKOPE_REVIEW_ATTENTION_LABELS[query.reviewAttention] ?? query.reviewAttention, clear: { reviewAttention: '' } });
  if (query.reviewStatus) chips.push({ id: 'review-status', label: `Seguimiento: ${NETSKOPE_REVIEW_STATUS_LABELS[query.reviewStatus] ?? query.reviewStatus}`, clear: { reviewStatus: '' } });
  if (query.change) chips.push({ id: 'change', label: `Cambio: ${labels.change[query.change] ?? query.change}`, clear: { change: '' } });
  if (query.clientCompliance) chips.push({ id: 'client', label: `Cliente: ${labels.clientCompliance[query.clientCompliance] ?? query.clientCompliance}`, clear: { clientCompliance: '' } });
  if (query.osCompliance) chips.push({ id: 'os', label: `SO: ${labels.osCompliance[query.osCompliance] ?? query.osCompliance}`, clear: { osCompliance: '' } });
  if (query.eventAge) {
    const ageLabel = NETSKOPE_EVENT_AGE_OPTIONS.find((option) => option.value === query.eventAge)?.label ?? query.eventAge;
    chips.push({ id: 'event-age', label: `Antigüedad del evento: ${ageLabel}`, clear: { eventAge: '' } });
  }
  if (query.filters.device_make) chips.push({ id: 'make', label: `Fabricante: ${query.filters.device_make}`, clear: { filter: 'device_make' } });
  if (query.filters.device_model) chips.push({ id: 'model', label: `Modelo: ${query.filters.device_model}`, clear: { filter: 'device_model' } });
  if (query.duplicate) chips.push({ id: 'duplicate', label: query.duplicate === 'hostname' ? 'Posible duplicado: hostname repetido' : 'Posible duplicado: usuario en varios equipos', clear: { duplicate: '' } });
  if (query.freshness === 'all' && !query.evidenceState && !query.reviewDiagnosis && !query.reviewStatus && !query.reviewAttention && !query.reviewSuggestion && !query.observedUserId && !query.deviceObjectId) chips.push({ id: 'freshness', label: 'Incluye dispositivos sin evento en 7 días', clear: { freshness: 'recent' } });
  if (query.filters.hostname) chips.push({ id: 'hostname', label: `Hostname: ${query.filters.hostname}`, clear: { filter: 'hostname' } });
  if (query.filters.username) chips.push({ id: 'username', label: `Usuario: ${query.filters.username}`, clear: { filter: 'username' } });
  if (query.filters.observed_user_status) chips.push({ id: 'observed-user-status', label: `Usuario observado: ${OBSERVED_USER_STATUS_LABELS[query.filters.observed_user_status] ?? query.filters.observed_user_status}`, clear: { filter: 'observed_user_status' } });
  if (query.filters.onprem_status) chips.push({ id: 'onprem-status', label: `Ubicación: ${presenceStatusLabel(query.filters.onprem_status)}`, clear: { filter: 'onprem_status' } });
  if (query.filters.uci_rating) chips.push({ id: 'uci-rating', label: `Confianza (UCI): ${uciRatingLabel(query.filters.uci_rating)}`, clear: { filter: 'uci_rating' } });
  if (query.filters.client_config) chips.push({ id: 'client-config', label: `Client config: ${query.filters.client_config}`, clear: { filter: 'client_config' } });
  if (query.filters.observed_user) chips.push({ id: 'observed-user', label: `Usuario resuelto: ${query.filters.observed_user}`, clear: { filter: 'observed_user' } });
  if (query.coverageRisk) chips.push({ id: 'coverage-risk', label: 'Último evento: desinstalación o deshabilitación', clear: { coverageRisk: '' } });
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
