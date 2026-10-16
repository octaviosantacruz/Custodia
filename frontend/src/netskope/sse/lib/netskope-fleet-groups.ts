/* NSK-FLEET-001: pure helpers for the grouped fleet table. A share without a denominator is null
   ("Sin línea base" / "Sin dato"), never 0 %. */
import { EMPTY_NETSKOPE_DEVICE_FILTERS, EMPTY_NETSKOPE_DEVICE_QUERY } from './netskope-device-filters.ts';
import type { NetskopeDeviceQuery, NetskopeFleetCounts, NetskopeFleetGroupBy } from '../types/netskope';

export const FLEET_GROUP_OPTIONS: ReadonlyArray<{ value: NetskopeFleetGroupBy; label: string }> = [
  { value: 'company', label: 'Empresa' },
  { value: 'os', label: 'Sistema operativo' },
  { value: 'client_config', label: 'Client config' },
  { value: 'device_make', label: 'Fabricante' },
];

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

export type FleetColumn = 'signal' | 'client' | 'os' | 'office';

/** Numerator and denominator of a column; null denominator means the column is not evaluated. */
export function fleetColumn(counts: NetskopeFleetCounts, column: FleetColumn): { count: number; total: number } {
  switch (column) {
    case 'signal': return { count: counts.signal_24h, total: counts.devices };
    case 'client': return { count: counts.client_current, total: counts.client_evaluated };
    case 'os': return { count: counts.os_supported, total: counts.os_evaluated };
    case 'office': return { count: counts.on_prem, total: counts.location_reported };
  }
}

/** The inventory query a fleet cell opens: the group filter plus the column's own criterion. */
export function fleetDrillQuery(groupBy: NetskopeFleetGroupBy, group: string | null, column?: FleetColumn): NetskopeDeviceQuery {
  const filters = { ...EMPTY_NETSKOPE_DEVICE_FILTERS, ...(group !== null ? { [groupBy]: group } : {}), ...(column === 'office' ? { onprem_status: 'on-prem' } : {}) };
  const criterion: Partial<NetskopeDeviceQuery> = column === 'signal' ? { eventAge: 'lt_24h' }
    : column === 'client' ? { clientCompliance: 'current' }
    : column === 'os' ? { osCompliance: 'supported' }
    : {};
  return { ...EMPTY_NETSKOPE_DEVICE_QUERY, ...criterion, filters };
}

/** The devices without a signal for 30 days, the same population as the Postura panel. */
export const STALE_DRILL: NetskopeDeviceQuery = { ...EMPTY_NETSKOPE_DEVICE_QUERY, freshness: 'all', eventAge: 'gt_30d' };

