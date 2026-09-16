import { Link2 } from 'lucide-react';
import { CopyIdButton } from './copy-id-button';
import { catalogCount, CatalogListPanel } from './catalog-list-panel';
import { fetchIdentityFederations } from '../lib/identity-admin-api';
import { useSimpleCatalogList } from '../hooks/use-simple-catalog-list';
import type { IdentityFederationRow } from '../types/identity';

type IdentityFederationsWorkspaceProps = {
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  initialQuery?: string;
};

export function IdentityFederationsWorkspace({ authChecked, authenticated, onUnauthorized, onError, initialQuery = '' }: IdentityFederationsWorkspaceProps) {
  const { search, setSearch, rows, total, loading, error, loadMore, retry, pageSize } = useSimpleCatalogList<IdentityFederationRow>({
    authChecked, authenticated, onUnauthorized, onError, initialQuery,
    fetcher: fetchIdentityFederations,
    errorFallback: 'No se pudieron cargar las federaciones de Identity Administration',
  });

  return <CatalogListPanel<IdentityFederationRow>
    ariaLabel="Federaciones de Identity Administration"
    icon={Link2}
    title="Federaciones"
    description="Catálogo de federaciones de Identity Administration. Sólo campos núcleo (tipo/activa/rol/uso); nunca certificados SAML/SSO ni dominios/apps federados."
    countLabel={(count) => catalogCount(count, 'federación', 'federaciones')}
    searchLabel="Buscar federaciones"
    searchPlaceholder="Buscar por nombre o tipo"
    search={search}
    onSearchChange={setSearch}
    columns={['Federación', 'Tipo', 'Estado', 'Rol', 'Uso']}
    loading={loading}
    error={error}
    loadingTitle="Cargando federaciones…"
    errorTitle="No se pudieron cargar las federaciones"
    emptyTitle="Todavía no hay federaciones sincronizadas"
    noResultsTitle="Sin federaciones para esta búsqueda"
    rows={rows}
    total={total}
    pageSize={pageSize}
    onLoadMore={loadMore}
    onRetry={retry}
    footerNote="Inventario de sólo lectura; nunca expone certificados SAML/SSO ni dominios/apps/servicios federados."
    renderRow={(federation) => <tr key={federation.object_id}>
      <td><span className="pam-platform-name"><Link2 size={15} aria-hidden /><span><strong>{federation.display_name}</strong><small>{federation.source_id}<CopyIdButton value={federation.source_id} /></small></span></span></td>
      <td>{federation.attributes.federation_type || <span className="muted">Sin tipo</span>}</td>
      {/* Both branches get a status-pill so "Inactiva" isn't just unstyled
          muted text -- a prior version only applied the pill class to the
          true branch. */}
      <td><span className={federation.attributes.active ? 'status-pill status-active' : 'status-pill status-muted'}>{federation.attributes.active ? 'Activa' : 'Inactiva'}</span></td>
      <td>{federation.attributes.role || <span className="muted">—</span>}</td>
      <td>{federation.attributes.usage || <span className="muted">—</span>}</td>
    </tr>}
  />;
}
