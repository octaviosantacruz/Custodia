import { Boxes } from 'lucide-react';
import { CopyIdButton } from './copy-id-button';
import { catalogCount, CatalogListPanel } from './catalog-list-panel';
import { fetchSiaResources } from '../lib/sia-resources-api';
import { useSimpleCatalogList } from '../hooks/use-simple-catalog-list';
import type { SiaResourceRow } from '../types/sia';

type SiaResourcesWorkspaceProps = {
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  initialQuery?: string;
};

function fetchRows(search: string, limit: number, offset: number, options: { signal: AbortSignal }) {
  return fetchSiaResources(search, limit, offset, '', options);
}

export function SiaResourcesWorkspace({ authChecked, authenticated, onUnauthorized, onError, initialQuery = '' }: SiaResourcesWorkspaceProps) {
  const { search, setSearch, rows, total, loading, error, loadMore, retry, pageSize } = useSimpleCatalogList<SiaResourceRow>({
    authChecked, authenticated, onUnauthorized, onError, initialQuery,
    fetcher: fetchRows,
    errorFallback: 'No se pudieron cargar los recursos SIA',
  });

  return <CatalogListPanel<SiaResourceRow>
    ariaLabel="Recursos SIA"
    icon={Boxes}
    title="Recursos SIA"
    description="Catálogo de infraestructura VM de Secure Infrastructure Access. Nunca incluye IP, FQDN ni nombre de red."
    countLabel={(count) => catalogCount(count, 'recurso')}
    searchLabel="Buscar recursos SIA"
    searchPlaceholder="Buscar por nombre"
    search={search}
    onSearchChange={setSearch}
    columns={['Recurso', 'Tipo', 'SO', 'Ubicación', 'Motor de descubrimiento', 'Último escaneo']}
    loading={loading}
    error={error}
    loadingTitle="Cargando recursos SIA…"
    errorTitle="No se pudieron cargar los recursos SIA"
    emptyTitle="Todavía no hay recursos SIA sincronizados"
    noResultsTitle="Sin recursos para esta búsqueda"
    rows={rows}
    total={total}
    pageSize={pageSize}
    onLoadMore={loadMore}
    onRetry={retry}
    footerNote="Inventario de sólo lectura; nunca expone IP, FQDN ni nombre de red del recurso."
    renderRow={(resource) => <tr key={resource.object_id}>
      <td><span className="pam-platform-name"><Boxes size={15} aria-hidden /><span><strong>{resource.display_name}</strong><small>{resource.attributes.resource_type || 'Sin tipo'} · {resource.source_id}<CopyIdButton value={resource.source_id} /></small></span></span></td>
      <td>{resource.attributes.resource_type || <span className="muted">—</span>}</td>
      <td>{resource.attributes.os_type || <span className="muted">—</span>}</td>
      <td>{resource.attributes.location_type || <span className="muted">—</span>}</td>
      <td>{resource.attributes.discovery_engine || <span className="muted">—</span>}</td>
      <td>{resource.attributes.scanned_on ? <span className="muted">{resource.attributes.scanned_on}</span> : <span className="muted">Sin escaneo</span>}</td>
    </tr>}
  />;
}
