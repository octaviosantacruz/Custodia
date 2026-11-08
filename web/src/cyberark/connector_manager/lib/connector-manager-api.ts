import { api } from '../../../cross/lib/api';

export type ConnectorCatalog = 'pools' | 'networks';
type CatalogRow = { id: string; name: string; created_at: string | null; updated_at: string | null };
export type PoolRow = CatalogRow & {
  description: string | null; assigned_network_count: number | null; identifiers_count: number | null;
  platform_connectors_count: number | null; access_connectors_count: number | null;
};
export type NetworkRow = CatalogRow & { assigned_pool_count: number | null };
type Evidence = { source_system: 'cyberark_connector_manager'; queried_at: string; total: number };
export type ConnectorCatalogResponse = Evidence & ({ catalog: 'pools'; rows: PoolRow[] } | { catalog: 'networks'; rows: NetworkRow[] });

export function fetchConnectorCatalog(catalog: ConnectorCatalog, signal: AbortSignal): Promise<ConnectorCatalogResponse> {
  return api(`/connector-manager/${catalog}`, { signal });
}
