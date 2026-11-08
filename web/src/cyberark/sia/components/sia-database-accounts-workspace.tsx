import type { ReactNode } from 'react';
import { Database } from 'lucide-react';
import { formatDate, dateTimeHint } from '../../../cross/lib/format';
import { CopyIdButton } from '../../../cross/components/copy-id-button';
import { TagChip } from '../../../cross/components/semantic';
import { catalogCount, CatalogListPanel } from '../../shared/components/catalog-list-panel';
import { fetchSiaDatabaseAccounts } from '../lib/sia-resources-api';
import { ageLabel, daysSince } from '../lib/sia-format';
import { useSimpleCatalogList } from '../../../cross/hooks/use-simple-catalog-list';
import { usePamRefreshKey } from '../../shared/refresh-context';
import type { SiaDatabaseAccountRow } from '../types/sia';
import './sia-workspace.css';

type SiaDatabaseAccountsWorkspaceProps = {
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  initialQuery?: string;
  headerActions?: ReactNode;
};

function ModifiedCell({ value }: { value: string | undefined }) {
  const days = daysSince(value);
  if (!value || days === null) return <span className="muted">Sin registro</span>;
  return <span className="cell-stack">
    <time className="cell-lead" dateTime={value} title={dateTimeHint(value)}>{formatDate(value)}</time>
    <span className="cell-sub">{ageLabel(days)}</span>
  </span>;
}

export function SiaDatabaseAccountsWorkspace({ authChecked, authenticated, onUnauthorized, onError, initialQuery = '', headerActions }: SiaDatabaseAccountsWorkspaceProps) {
  const refreshKey = usePamRefreshKey();
  const { search, setSearch, rows, total, loading, error, loadMore, retry, pageSize } = useSimpleCatalogList<SiaDatabaseAccountRow>({
    refreshKey, authChecked, authenticated, onUnauthorized, onError, initialQuery,
    resourceKey: 'sia-database-accounts', fetcher: fetchSiaDatabaseAccounts,
    errorFallback: 'No se pudieron cargar las cuentas de base de datos SIA',
  });

  return <CatalogListPanel<SiaDatabaseAccountRow>
    embedded
    ariaLabel="Cuentas de base de datos SIA"
    icon={Database}
    title="Cuentas de base de datos SIA"
    description="Inventario de Strong Accounts administradas por Secure Infrastructure Access. Se muestran la plataforma, base de datos, puerto y fechas operativas; nunca nombres de usuario ni credenciales."
    countLabel={(count) => catalogCount(count, 'cuenta')}
    searchLabel="Buscar cuentas de base de datos SIA"
    searchPlaceholder="Buscar por nombre, plataforma o base de datos"
    search={search}
    onSearchChange={setSearch}
    columns={['Cuenta', 'Motor', 'Base de datos · puerto', 'Almacén', 'Última modificación']}
    tableClassName="sia-catalog-table"
    headerActions={headerActions}
    loading={loading}
    error={error}
    loadingTitle="Cargando cuentas de base de datos SIA…"
    errorTitle="No se pudieron cargar las cuentas de base de datos SIA"
    emptyTitle="Todavía no hay cuentas de base de datos SIA sincronizadas"
    noResultsTitle="Sin cuentas para esta búsqueda"
    rows={rows}
    total={total}
    pageSize={pageSize}
    onLoadMore={loadMore}
    onRetry={retry}
    footerNote="Inventario de sólo lectura; no muestra datos de host, nombres de usuario ni credenciales."
    renderRow={(account) => {
      const { platform, database, port, store_type: storeType, modified_at: modifiedAt } = account.attributes;
      return <tr key={account.object_id}>
        <td><span className="sia-record-name">
          <strong title={account.display_name}>{account.display_name}</strong>
          <small>{account.source_id !== account.display_name && <span className="mono">{account.source_id}</span>}<CopyIdButton value={account.source_id} /></small>
        </span></td>
        <td>{platform ? <TagChip label={platform} /> : <span className="muted">—</span>}</td>
        <td>{database || port != null
          ? <span className="sia-db-target">{database ? <strong>{database}</strong> : <span className="muted">Sin base</span>}{port != null ? <span className="mono">:{port}</span> : null}</span>
          : <span className="muted">—</span>}</td>
        <td>{storeType || <span className="muted">—</span>}</td>
        <td><ModifiedCell value={modifiedAt} /></td>
      </tr>;
    }}
  />;
}
