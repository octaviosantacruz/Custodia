import type { ReactNode } from 'react';
import { Boxes } from 'lucide-react';
import { CopyIdButton } from '../../../cross/components/copy-id-button';
import { TagChip } from '../../../cross/components/semantic';
import { formatDate, dateTimeHint } from '../../../cross/lib/format.ts';
import { catalogCount, CatalogListPanel } from '../../shared/components/catalog-list-panel';
import { fetchSiaResources } from '../lib/sia-resources-api';
import { ageLabel, daysSince, engineLabel, osLabel } from '../lib/sia-format';
import { useSimpleCatalogList } from '../../../cross/hooks/use-simple-catalog-list';
import { usePamRefreshKey } from '../../shared/refresh-context';
import type { SiaResourceRow } from '../types/sia';
import './sia-workspace.css';

type SiaResourcesWorkspaceProps = {
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  initialQuery?: string;
  headerActions?: ReactNode;
};

/* A scan older than this is flagged so stale discovery stands out; it is a
   freshness hint about SIA's own scan date, not a health verdict. */
const STALE_SCAN_DAYS = 30;

function fetchRows(search: string, limit: number, offset: number, options: { signal: AbortSignal }) {
  return fetchSiaResources(search, limit, offset, '', options);
}

function resourceTypeLabel(value: string | undefined): string {
  if (!value) return t('Sin tipo');
  if (value === 'virtual_machine') return t('Máquina virtual');
  return value.replace(/_/g, ' ');
}

function ScanCell({ value }: { value: string | undefined }) {
  const days = daysSince(value);
  if (!value || days === null) return <span className="muted">{t('Sin escaneo')}</span>;
  return <span className="cell-stack">
    <time className="cell-lead" dateTime={value} title={dateTimeHint(value)}>{formatDate(value)}</time>
    <span className={`cell-sub ${days > STALE_SCAN_DAYS ? 'sia-age-stale' : ''}`.trim()}>{ageLabel(days)}</span>
  </span>;
}

export function SiaResourcesWorkspace({ authChecked, authenticated, onUnauthorized, onError, initialQuery = '', headerActions }: SiaResourcesWorkspaceProps) {
  const refreshKey = usePamRefreshKey();
  const { search, setSearch, rows, total, loading, error, loadMore, retry, pageSize } = useSimpleCatalogList<SiaResourceRow>({
    refreshKey, authChecked, authenticated, onUnauthorized, onError, initialQuery,
    resourceKey: 'sia-resources', fetcher: fetchRows,
    errorFallback: t('No se pudieron cargar los recursos SIA'),
  });

  return <CatalogListPanel<SiaResourceRow>
    embedded
    ariaLabel={t('Máquinas virtuales SIA')}
    icon={Boxes}
    title={t('Máquinas virtuales SIA')}
    description="Consultá las máquinas virtuales registradas en Secure Infrastructure Access. No se muestran direcciones IP, FQDN ni nombres de red."
    countLabel={(count) => catalogCount(count, t('máquina virtual'), t('máquinas virtuales'))}
    searchLabel="Buscar máquinas virtuales SIA"
    searchPlaceholder="Buscar por nombre"
    search={search}
    onSearchChange={setSearch}
    columns={[t('Máquina virtual'), 'Sistema operativo', t('Descubierta por'), t('Último escaneo')]}
    tableClassName="sia-catalog-table"
    headerActions={headerActions}
    loading={loading}
    error={error}
    loadingTitle="Cargando máquinas virtuales SIA…"
    errorTitle="No se pudieron cargar las máquinas virtuales SIA"
    emptyTitle="Todavía no hay máquinas virtuales SIA sincronizadas"
    noResultsTitle="No hay máquinas virtuales que coincidan con esta búsqueda"
    rows={rows}
    total={total}
    pageSize={pageSize}
    onLoadMore={loadMore}
    onRetry={retry}
    footerNote="Inventario de sólo lectura; no muestra direcciones IP, FQDN ni nombres de red."
    renderRow={(resource) => {
      const { resource_type: resourceType, os_type: osType, discovery_engine: engine, location_type: location, scanned_on: scannedOn } = resource.attributes;
      return <tr key={resource.object_id}>
        <td><span className="sia-record-name">
          <strong title={resource.display_name}>{resource.display_name}</strong>
          <small>
            {resource.source_id !== resource.display_name && <span className="mono">{resource.source_id}</span>}
            <CopyIdButton value={resource.source_id} />
            {resourceType && resourceType !== 'virtual_machine' ? <span>{resourceTypeLabel(resourceType)}</span> : null}
          </small>
        </span></td>
        <td>{osType ? <TagChip label={osLabel(osType)} /> : <span className="muted">—</span>}</td>
        <td>{engine
          ? <span className="cell-stack"><span className="cell-lead">{engineLabel(engine)}</span>{location ? <span className="cell-sub">Ubicación: {location}</span> : null}</span>
          : <span className="muted">—</span>}</td>
        <td><ScanCell value={scannedOn} /></td>
      </tr>;
    }}
  />;
}

import { t } from '../../../cross/i18n/index.ts';