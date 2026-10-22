/* NSK-FLEET-001: pure helpers for the grouped fleet table. A share without a denominator is null
   ("Sin línea base" / "Sin dato"), never 0 %. */
import { EMPTY_NETSKOPE_DEVICE_FILTERS, EMPTY_NETSKOPE_DEVICE_QUERY } from './netskope-device-filters.ts';
import type { NetskopeDeviceQuery, NetskopeFleetCounts, NetskopeFleetGroupBy } from '../types/netskope';

export const FLEET_GROUP_OPTIONS: ReadonlyArray<{ value: NetskopeFleetGroupBy; label: string }> = [
  { value: 'company', label: 'Empresa' },
  { value: 'os', label: 'Sistema operativo' },
  { value: 'client_config', label: 'Client config' },
  { value: 'device_make', label: 'Fabricante' },
  { value: 'onprem_status', label: 'Dónde trabaja' },
  { value: 'uci_rating', label: 'Confianza (UCI)' },
];

const UCI_LABELS: Record<string, string> = { Poor: 'Bajo', Moderate: 'Moderado', 'Sin alerta': 'Sin alerta', 'Sin dato': 'Sin dato' };
export function uciRatingLabel(key: string): string {
  return UCI_LABELS[key] ?? key;
}

const PLACE_LABELS: Record<string, string> = { 'on-prem': 'En oficina', 'off-prem': 'Fuera de oficina', Unknown: 'Sin clasificar', unconfig: 'Detección sin configurar', 'Sin dato': 'Sin dato' };

/** The label of a group key as the table shows it; the key itself stays the exact filter value. */
export function fleetGroupKeyLabel(groupBy: NetskopeFleetGroupBy, key: string): string {
  if (groupBy === 'uci_rating') return uciRatingLabel(key);
  if (groupBy === 'onprem_status') return PLACE_LABELS[key] ?? key;
  return key;
}

/** The shortcut the fleet table offers: office devices whose user has a Poor UCI. */
export const OFFICE_LOW_UCI_DRILL: NetskopeDeviceQuery = { ...EMPTY_NETSKOPE_DEVICE_QUERY, filters: { ...EMPTY_NETSKOPE_DEVICE_FILTERS, onprem_status: 'on-prem', uci_rating: 'Poor' } };

export function fleetGroupLabel(groupBy: NetskopeFleetGroupBy): string {
  return FLEET_GROUP_OPTIONS.find((option) => option.value === groupBy)?.label ?? groupBy;
}

export function fleetShare(count: number, total: number): number | null {
  return total > 0 ? count / total : null;
}

export function fleetPercent(share: number | null): string {
  if (share === null) return 'Sin dato';
  return `${Math.round(share * 100)} %`;
}

export type FleetColumn = 'signal' | 'client' | 'client_one' | 'client_two' | 'os' | 'office' | 'uci';

/** Numerator and denominator of a column; null denominator means the column is not evaluated. */
export function fleetColumn(counts: NetskopeFleetCounts, column: FleetColumn): { count: number; total: number } {
  switch (column) {
    case 'signal': return { count: counts.signal_24h, total: counts.devices };
    case 'client': return { count: counts.client_current, total: counts.client_evaluated };
    case 'client_one': return { count: counts.client_one_behind, total: counts.client_evaluated };
    case 'client_two': return { count: counts.client_two_plus_behind, total: counts.client_evaluated };
    case 'os': return { count: counts.os_supported, total: counts.os_evaluated };
    case 'office': return { count: counts.on_prem, total: counts.location_reported };
    case 'uci': return { count: counts.uci_low, total: counts.uci_evaluated };
  }
}

/** The inventory query a fleet cell opens: the group filter plus the column's own criterion. */
export function fleetDrillQuery(groupBy: NetskopeFleetGroupBy, group: string | null, column?: FleetColumn): NetskopeDeviceQuery {
  const filters = { ...EMPTY_NETSKOPE_DEVICE_FILTERS, ...(group !== null ? { [groupBy]: group } : {}), ...(column === 'office' ? { onprem_status: 'on-prem' } : {}), ...(column === 'uci' ? { uci_rating: 'Poor' } : {}) };
  const criterion: Partial<NetskopeDeviceQuery> = column === 'signal' ? { eventAge: 'lt_24h' }
    : column === 'client' ? { clientCompliance: 'current' }
    : column === 'client_one' ? { clientCompliance: 'one_behind' }
    : column === 'client_two' ? { clientCompliance: 'two_plus_behind' }
    : column === 'os' ? { osCompliance: 'supported' }
    : {};
  return { ...EMPTY_NETSKOPE_DEVICE_QUERY, ...criterion, filters };
}

/** The devices without a signal for 30 days, the same population as the Postura panel. */
export const STALE_DRILL: NetskopeDeviceQuery = { ...EMPTY_NETSKOPE_DEVICE_QUERY, freshness: 'all', eventAge: 'gt_30d' };
