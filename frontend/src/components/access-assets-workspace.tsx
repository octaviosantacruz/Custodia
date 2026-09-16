import { Fingerprint, Star } from 'lucide-react';
import { CopyIdButton } from './copy-id-button';
import { catalogCount, CatalogListPanel } from './catalog-list-panel';
import { fetchAccessAssets } from '../lib/access-api';
import { useSimpleCatalogList } from '../hooks/use-simple-catalog-list';
import type { AccessAssetRow } from '../types/access';

type AccessAssetsWorkspaceProps = {
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  initialQuery?: string;
};

function fetchRows(search: string, limit: number, offset: number, options: { signal: AbortSignal }) {
  return fetchAccessAssets(search, limit, offset, '', options);
}

export function AccessAssetsWorkspace({ authChecked, authenticated, onUnauthorized, onError, initialQuery = '' }: AccessAssetsWorkspaceProps) {
  const { search, setSearch, rows, total, loading, error, loadMore, retry, pageSize } = useSimpleCatalogList<AccessAssetRow>({
    authChecked, authenticated, onUnauthorized, onError, initialQuery,
    fetcher: fetchRows,
    errorFallback: 'No se pudieron cargar los assets del Access space',
  });

  return <CatalogListPanel<AccessAssetRow>
    ariaLabel="Assets del Access space"
    icon={Fingerprint}
    title="Assets de Access"
    description="Catálogo de activos accesibles vía Access space. Nunca incluye dirección/host ni usuario de cuenta."
    countLabel={(count) => catalogCount(count, 'asset')}
    searchLabel="Buscar assets de Access"
    searchPlaceholder="Buscar por nombre"
    search={search}
    onSearchChange={setSearch}
    columns={['Asset', 'Tipo', 'Protocolo', 'Plataforma PAM', 'Estado']}
    loading={loading}
    error={error}
    loadingTitle="Cargando assets de Access…"
    errorTitle="No se pudieron cargar los assets de Access"
    emptyTitle="Todavía no hay assets de Access sincronizados"
    noResultsTitle="Sin assets para esta búsqueda"
    rows={rows}
    total={total}
    pageSize={pageSize}
    onLoadMore={loadMore}
    onRetry={retry}
    footerNote="Inventario de sólo lectura; la relación con plataformas PAM sólo se muestra cuando el ID coincide exactamente, nunca por nombre."
    renderRow={(asset) => <tr key={asset.object_id}>
      <td><span className="pam-platform-name"><Fingerprint size={15} aria-hidden /><span><strong>{asset.display_name}</strong><small>{asset.attributes.asset_category || 'sin categoría'} · {asset.source_id}<CopyIdButton value={asset.source_id} /></small></span>{asset.attributes.is_favorite ? <Star size={13} aria-label="Favorito" /> : null}</span></td>
      <td>{asset.attributes.asset_type || <span className="muted">Sin tipo</span>}</td>
      <td>{asset.attributes.protocol || <span className="muted">—</span>}</td>
      <td>{asset.platform_name ? <span>{asset.platform_name}</span> : <span className="muted">Sin relación confirmada</span>}</td>
      <td><span className={asset.attributes.workflow_status === 'active' ? 'status-pill status-active' : 'status-pill status-muted'}>{asset.attributes.workflow_status || 'Sin estado'}</span></td>
    </tr>}
  />;
}
