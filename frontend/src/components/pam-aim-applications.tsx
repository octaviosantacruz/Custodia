import { ShieldCheck } from 'lucide-react';
import { CopyIdButton } from './copy-id-button';
import { catalogCount, CatalogListPanel } from './catalog-list-panel';
import { fetchAimApplications } from '../lib/pam-technical-catalogs-api';
import { useSimpleCatalogList } from '../hooks/use-simple-catalog-list';
import type { AimApplicationRow } from '../types/pam';

type PamAimApplicationsProps = {
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  initialQuery?: string;
};

export function PamAimApplicationsWorkspace({ authChecked, authenticated, onUnauthorized, onError, initialQuery = '' }: PamAimApplicationsProps) {
  const { search, setSearch, rows, total, loading, error, loadMore, retry, pageSize } = useSimpleCatalogList<AimApplicationRow>({
    authChecked, authenticated, onUnauthorized, onError, initialQuery,
    fetcher: fetchAimApplications,
    errorFallback: 'No se pudieron cargar las aplicaciones AIM',
  });

  return <CatalogListPanel<AimApplicationRow>
    ariaLabel="Aplicaciones AIM"
    icon={ShieldCheck}
    title="Aplicaciones AIM"
    description="Catálogo de aplicaciones registradas para Application Identity Manager. Nunca incluye datos del propietario de negocio."
    countLabel={(count) => catalogCount(count, 'aplicación', 'aplicaciones')}
    searchLabel="Buscar aplicaciones AIM"
    searchPlaceholder="Buscar por nombre o AppID"
    search={search}
    onSearchChange={setSearch}
    columns={['Aplicación', 'Estado', 'Vencimiento', 'Ubicación']}
    loading={loading}
    error={error}
    loadingTitle="Cargando aplicaciones AIM…"
    errorTitle="No se pudieron cargar las aplicaciones AIM"
    emptyTitle="Todavía no hay aplicaciones AIM sincronizadas"
    noResultsTitle="Sin aplicaciones para esta búsqueda"
    rows={rows}
    total={total}
    pageSize={pageSize}
    onLoadMore={loadMore}
    onRetry={retry}
    footerNote="Inventario de sólo lectura; no expone métodos de autenticación ni datos del propietario de negocio."
    renderRow={(application) => <tr key={application.object_id}>
      <td><span className="pam-platform-name"><ShieldCheck size={15} aria-hidden /><span><strong>{application.description || application.source_id}</strong><small>{application.source_id}<CopyIdButton value={application.source_id} /></small></span></span></td>
      <td><span className={application.disabled ? 'status-pill status-muted' : 'status-pill status-active'}>{application.disabled ? 'Deshabilitada' : 'Habilitada'}</span></td>
      <td>{application.expiration_date ? <span className="muted">{application.expiration_date}</span> : <span className="muted">Sin vencimiento</span>}</td>
      <td>{application.location ? <code className="pam-platform-pattern" title={application.location}>{application.location}</code> : <span className="muted">Raíz</span>}</td>
    </tr>}
  />;
}
