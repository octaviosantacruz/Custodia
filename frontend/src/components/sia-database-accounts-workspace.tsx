import { Database } from 'lucide-react';
import { CopyIdButton } from './copy-id-button';
import { catalogCount, CatalogListPanel } from './catalog-list-panel';
import { fetchSiaDatabaseAccounts } from '../lib/sia-resources-api';
import { useSimpleCatalogList } from '../hooks/use-simple-catalog-list';
import type { SiaDatabaseAccountRow } from '../types/sia';

type SiaDatabaseAccountsWorkspaceProps = {
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  initialQuery?: string;
};

export function SiaDatabaseAccountsWorkspace({ authChecked, authenticated, onUnauthorized, onError, initialQuery = '' }: SiaDatabaseAccountsWorkspaceProps) {
  const { search, setSearch, rows, total, loading, error, loadMore, retry, pageSize } = useSimpleCatalogList<SiaDatabaseAccountRow>({
    authChecked, authenticated, onUnauthorized, onError, initialQuery,
    fetcher: fetchSiaDatabaseAccounts,
    errorFallback: 'No se pudieron cargar las cuentas fuertes de base de datos SIA',
  });

  return <CatalogListPanel<SiaDatabaseAccountRow>
    ariaLabel="Cuentas fuertes de base de datos SIA"
    icon={Database}
    title="Cuentas fuertes de base de datos"
    description="Catálogo de Strong Accounts de base de datos de Secure Infrastructure Access. Nunca incluye dirección/host ni usuario de la cuenta."
    countLabel={(count) => catalogCount(count, 'cuenta')}
    searchLabel="Buscar cuentas fuertes de base de datos SIA"
    searchPlaceholder="Buscar por nombre, plataforma o base de datos"
    search={search}
    onSearchChange={setSearch}
    columns={['Cuenta', 'Plataforma', 'Base de datos', 'Puerto', 'Tipo de almacén', 'Última modificación']}
    loading={loading}
    error={error}
    loadingTitle="Cargando cuentas fuertes de base de datos SIA…"
    errorTitle="No se pudieron cargar las cuentas fuertes de base de datos SIA"
    emptyTitle="Todavía no hay cuentas fuertes de base de datos SIA sincronizadas"
    noResultsTitle="Sin cuentas para esta búsqueda"
    rows={rows}
    total={total}
    pageSize={pageSize}
    onLoadMore={loadMore}
    onRetry={retry}
    footerNote="Inventario de sólo lectura; nunca expone dirección/host ni usuario de la cuenta."
    renderRow={(account) => <tr key={account.object_id}>
      <td><span className="pam-platform-name"><Database size={15} aria-hidden /><span><strong>{account.display_name}</strong><small>{account.attributes.store_type || 'Sin tipo'} · {account.source_id}<CopyIdButton value={account.source_id} /></small></span></span></td>
      <td>{account.attributes.platform || <span className="muted">—</span>}</td>
      <td>{account.attributes.database || <span className="muted">—</span>}</td>
      <td>{account.attributes.port ?? <span className="muted">—</span>}</td>
      <td>{account.attributes.store_type || <span className="muted">—</span>}</td>
      <td>{account.attributes.modified_at ? <span className="muted">{account.attributes.modified_at}</span> : <span className="muted">Sin registro</span>}</td>
    </tr>}
  />;
}
