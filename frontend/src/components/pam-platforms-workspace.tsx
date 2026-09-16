import { useEffect, useState } from 'react';
import { Cable, Database, ListFilter, Monitor, Network, Search, Server, ShieldCheck } from 'lucide-react';
import { CompactSelect } from './compact-select';
import { formatNumber } from '../lib/format';
import { fetchPamConnectors, fetchPamPlatforms, fetchPlatformCatalogs, fetchPlatformTargets, fetchPsmConnectorTypes } from '../lib/pam-technical-catalogs-api';
import { fetchSiaConnectors } from '../lib/sia-resources-api';
import { useSimpleCatalogList } from '../hooks/use-simple-catalog-list';
import type { WorkspaceView } from '../lib/workspaces';
import { StateBlock } from './state-block';
import { LoadMore } from './load-more';
import { catalogCount, CatalogListPanel } from './catalog-list-panel';
import './pam-chain-workspace.css';
import type {
  PamConnectorRow, PamPlatformRow, PlatformCatalogsResponse, PlatformTargetRow,
} from '../types/pam';
import type { SiaConnectorRow } from '../types/sia';

type SharedProps = {
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  initialQuery?: string;
};

type PlatformProps = SharedProps & {
  onNavigate: (view: WorkspaceView, query?: string) => void;
  onOpenConnectors: (query: string) => void;
};

type ConnectorProps = SharedProps & {
  onOpenPlatforms: (query: string) => void;
};

function PlatformCatalogsSummary({ catalogs }: { catalogs: PlatformCatalogsResponse | null }) {
  if (!catalogs) return null;
  const dependents = Array.isArray(catalogs.dependents) ? catalogs.dependents : [];
  const groups = Array.isArray(catalogs.groups) ? catalogs.groups : [];
  const rotationalGroups = Array.isArray(catalogs.rotational_groups) ? catalogs.rotational_groups : [];
  if (!dependents.length && !groups.length && !rotationalGroups.length) return null;
  return <p className="pam-platforms-note" title="Catálogos técnicos separados de las plataformas destino: dependientes (CPM: servicios/tareas Windows, etc.), agrupadas y rotacionales.">
    <Network size={13} aria-hidden /> Catálogos relacionados: {formatNumber(dependents.length)} dependientes · {formatNumber(groups.length)} agrupadas · {formatNumber(rotationalGroups.length)} rotacionales.
  </p>;
}

function PlatformIdentity({ platform }: { platform: PamPlatformRow }) {
  const hasDistinctIdentifier = platform.source_id && platform.source_id !== platform.display_name;
  return <span className="pam-platform-identity">
    <span className="pam-platform-identity-icon"><Server size={15} aria-hidden /></span>
    <span className="pam-platform-identity-copy">
      <strong>{platform.display_name}</strong>
      {hasDistinctIdentifier ? <small>{platform.source_id}</small> : null}
    </span>
  </span>;
}

function PlatformMetric({ value, label }: { value: number; label: string }) {
  return <span className={'pam-platform-metric' + (value === 0 ? ' is-empty' : '')}>
    <strong>{formatNumber(value)}</strong>
    <small>{label}</small>
  </span>;
}

function PlatformTargetsSection({ authChecked, authenticated, onUnauthorized, onError }: SharedProps) {
  const { search, setSearch, rows, total, loading, error, loadMore, retry, pageSize } = useSimpleCatalogList<PlatformTargetRow>({
    authChecked, authenticated, onUnauthorized, onError,
    fetcher: fetchPlatformTargets,
    errorFallback: 'No se pudo cargar la política de plataformas destino',
  });

  return <CatalogListPanel<PlatformTargetRow>
    ariaLabel="Política de plataformas destino"
    icon={ShieldCheck}
    title="Política por plataforma destino"
    description="Dual control, verify/change/reconcile periódicos y el servidor PSM asignado. Catálogo propio de CyberArk: su identificador no siempre coincide con el de la plataforma base, por eso no se fusiona con la tabla de arriba."
    countLabel={(count) => catalogCount(count, 'plataforma destino', 'plataformas destino')}
    searchLabel="Buscar plataforma destino"
    searchPlaceholder="Buscar por nombre o plataforma base"
    search={search}
    onSearchChange={setSearch}
    columns={['Destino', 'Base', 'Dual control', 'Change / Verify / Reconcile', 'PSM asignado']}
    loading={loading}
    error={error}
    loadingTitle="Cargando política de plataformas destino…"
    errorTitle="No se pudo cargar la política"
    emptyTitle="Todavía no hay plataformas destino sincronizadas"
    noResultsTitle="Sin plataformas destino para esta búsqueda"
    rows={rows}
    total={total}
    pageSize={pageSize}
    onLoadMore={loadMore}
    onRetry={retry}
    footerNote="Catálogo separado de plataformas base; su identificador no siempre coincide."
    renderRow={(target) => <tr key={target.object_id}>
      <td><span className="pam-platform-name"><ShieldCheck size={15} aria-hidden /><span><strong>{target.display_name}</strong><small>{target.source_id}</small></span></span></td>
      <td>{target.platform_base_id || <span className="muted">Sin base</span>}</td>
      <td>{target.dual_control_required ? <span className="status-pill status-active">Requerido</span> : <span className="muted">No requerido</span>}</td>
      <td><span className="muted">
        {target.credentials_change_automatic ? `Change c/${target.credentials_change_interval_days ?? '?'}d` : 'Change manual'}
        {' · '}{target.credentials_verify_automatic ? `Verify c/${target.credentials_verify_interval_days ?? '?'}d` : 'Verify manual'}
        {' · '}{target.credentials_reconcile_automatic ? 'Reconcile automático' : 'Reconcile manual'}
      </span></td>
      <td>{target.psm_server_id ? <span className="muted">{target.psm_server_id}</span> : <span className="muted">Sin PSM</span>}</td>
    </tr>}
  />;
}

export function PamPlatformsWorkspace({
  authChecked, authenticated, onUnauthorized, onError, onNavigate, onOpenConnectors, initialQuery = '',
}: PlatformProps) {
  const [section, setSection] = useState<'inventory' | 'policy'>('inventory');
  const [catalogs, setCatalogs] = useState<PlatformCatalogsResponse | null>(null);
  const { search, setSearch, rows, total, loading, error, loadMore, retry, pageSize } = useSimpleCatalogList<PamPlatformRow>({
    authChecked, authenticated, onUnauthorized, onError, initialQuery,
    fetcher: fetchPamPlatforms,
    errorFallback: 'No se pudieron cargar las plataformas PAM',
  });

  useEffect(() => {
    if (!authChecked || !authenticated) return;
    const controller = new AbortController();
    void fetchPlatformCatalogs({ signal: controller.signal }).then((response) => { if (!controller.signal.aborted) setCatalogs(response); }).catch(() => { /* non-blocking */ });
    return () => controller.abort();
  }, [authChecked, authenticated]);

  return <>
    <section className="list-panel database-surface pam-platforms-panel" aria-label="Plataformas PAM">
      <div className="pam-platforms-heading">
        <div className="pam-platforms-heading-copy">
          <span className="pam-platforms-kicker">CATÁLOGO PAM</span>
          <h3>{section === 'inventory' ? 'Plataformas activas' : 'Política CPM por plataforma'}</h3>
          <p>{section === 'inventory' ? 'Relaciones verificadas con Safes, cuentas y conectores PSM.' : 'Catálogo separado: el identificador no siempre coincide con la plataforma base.'}</p>
        </div>
        <div className="pam-platforms-actions">
          <span className="pam-platforms-count">{section === 'inventory' ? <><strong>{formatNumber(total)}</strong> activas</> : 'Catálogo CPM'}</span>
          <CompactSelect
            className="pam-platforms-section-select"
            value={section}
            ariaLabel="Elegir vista de plataformas"
            options={[{ value: 'inventory', label: 'Inventario activo' }, { value: 'policy', label: 'Política CPM' }]}
            onChange={(value) => setSection(value as 'inventory' | 'policy')}
          />
        </div>
      </div>
      {section === 'inventory' && <>
      <div className="search-row"><label className="search-box"><Search size={16} /><input type="search" aria-label="Buscar plataformas PAM" placeholder="Buscar plataforma activa" value={search} onChange={(event) => setSearch(event.target.value)} /></label><span className="pam-platforms-filter-note"><ListFilter size={14} aria-hidden /> Sólo activas</span></div>
      <div className="compact-table-wrap"><table className="compact-table pam-platforms-table pam-platforms-inventory-table"><caption className="sr-only">Plataformas PAM activas y sus relaciones observadas</caption><thead><tr><th>Plataforma</th><th>Tipo</th><th>Safes permitidos</th><th>Safes</th><th>Cuentas</th><th>Conectores PSM</th></tr></thead><tbody>
        {loading && rows.length === 0 ? <tr><td colSpan={6}><StateBlock variant="loading" title="Cargando plataformas PAM activas…" /></td></tr>
          : error ? <tr><td colSpan={6}><StateBlock variant="error" title="No se pudieron cargar las plataformas PAM" hint={error} action={<button type="button" className="button subtle" onClick={retry}>Reintentar</button>} /></td></tr>
            : rows.length ? rows.map((platform) => <tr key={platform.object_id}>
              <td><button type="button" className="pam-platform-name" title={`Buscar Safes con ${platform.display_name}`} onClick={() => onNavigate('safes', platform.display_name)}><PlatformIdentity platform={platform} /></button></td>
              <td><span className="pam-platform-type">{platform.system_type || 'Sin tipo'}</span></td>
              <td>{platform.allowed_safes_pattern ? <code className="pam-platform-pattern" title={platform.allowed_safes_pattern}>{platform.allowed_safes_pattern}</code> : <span className="muted">Sin patrón</span>}</td>
              <td><PlatformMetric value={platform.safe_count} label={platform.safe_count === 1 ? 'Safe' : 'Safes'} /></td><td><PlatformMetric value={platform.account_count} label={platform.account_count === 1 ? 'Cuenta' : 'Cuentas'} /></td>
              <td>{platform.psms.length
                ? <button type="button" className="pam-platform-related" title={`Ver conectores PSM de ${platform.display_name}`} onClick={() => onOpenConnectors(platform.display_name)}><Monitor size={13} aria-hidden />{formatNumber(platform.psms.length)} {platform.psms.length === 1 ? 'conector' : 'conectores'}</button>
                : <span className="pam-platform-no-psm">Sin conector</span>}</td>
            </tr>) : <tr><td colSpan={6}><StateBlock variant="empty" title={search ? 'Sin plataformas activas para esta búsqueda' : 'Todavía no hay plataformas PAM activas sincronizadas'} action={search ? <button type="button" className="button subtle" onClick={() => setSearch('')}>Limpiar búsqueda</button> : undefined} /></td></tr>}
      </tbody></table></div>
      {!error && <LoadMore loaded={rows.length} total={total} pageSize={pageSize} loading={loading} onLoadMore={loadMore} />}
      <p className="pam-platforms-note"><Database size={13} aria-hidden /> “Safes permitidos” es el patrón configurado por la plataforma, no una garantía de uso. Abrir una plataforma busca Safes asociados; los conectores no son telemetría de capacidad o salud.</p>
      <PlatformCatalogsSummary catalogs={catalogs} />
      <PsmConnectorTypesSection authChecked={authChecked} authenticated={authenticated} onUnauthorized={onUnauthorized} onError={onError} />
      </>}
      {section === 'policy' && <PlatformTargetsSection authChecked={authChecked} authenticated={authenticated} onUnauthorized={onUnauthorized} onError={onError} />}
    </section>
  </>;
}

function PsmConnectorTypesSection({ authChecked, authenticated, onUnauthorized, onError }: SharedProps) {
  const { rows, total, loading, error, loadMore, pageSize } = useSimpleCatalogList({
    authChecked, authenticated, onUnauthorized, onError,
    fetcher: fetchPsmConnectorTypes,
    errorFallback: 'No se pudieron cargar los tipos de conector PSM',
    pageSize: 200,
  });

  if (loading || error || !rows.length) return null;
  return <section className="pam-platform-catalog-section" aria-label="Tipos de conector de sesión PSM">
    <div className="pam-platforms-heading">
      <div><h3>Tipos de conector de sesión</h3><p>Catálogo técnico de conectores PSM (ej. RDP, SSH). No son servidores PSM.</p></div>
      <span className="database-toolbar-count">{formatNumber(total)} tipos</span>
    </div>
    <div className="pam-platform-psms" style={{ padding: '0 16px 14px' }}>
      {rows.map((connector) => <span key={connector.object_id} title={connector.source_id}><Monitor size={13} aria-hidden />{connector.display_name}</span>)}
    </div>
    {rows.length < total && <div className="pam-platform-psms" style={{ padding: '0 16px 14px' }}>
      <button type="button" className="button subtle" onClick={loadMore}>Cargar {formatNumber(Math.min(pageSize, total - rows.length))} más</button>
    </div>}
  </section>;
}

export function PamConnectorsWorkspace({
  authChecked, authenticated, onUnauthorized, onError, onOpenPlatforms, initialQuery = '',
}: ConnectorProps) {
  const [section, setSection] = useState<'psm' | 'sia'>('psm');
  const {
    search: psmSearch, setSearch: setPsmSearch, rows: psmRows, total: psmTotal, loading: psmLoading,
    error: psmError, loadMore: loadMorePsm, retry: retryPsm, pageSize: psmPageSize,
  } = useSimpleCatalogList<PamConnectorRow>({
    authChecked, authenticated, onUnauthorized, onError, initialQuery,
    fetcher: fetchPamConnectors,
    errorFallback: 'No se pudieron cargar los conectores PSM',
  });
  const {
    search: siaSearch, setSearch: setSiaSearch, rows: siaRows, total: siaTotal, loading: siaLoading,
    error: siaError, loadMore: loadMoreSia, retry: retrySia, pageSize: siaPageSize,
  } = useSimpleCatalogList<SiaConnectorRow>({
    authChecked, authenticated, onUnauthorized, onError, initialQuery,
    fetcher: fetchSiaConnectors,
    errorFallback: 'No se pudieron cargar los conectores SIA',
  });

  const search = section === 'psm' ? psmSearch : siaSearch;
  const setSearch = section === 'psm' ? setPsmSearch : setSiaSearch;

  return <>
    <section className="list-panel database-surface pam-platforms-panel" aria-label="Conectores PSM y SIA">
      <div className="pam-platforms-heading">
        <div><h3>Conectores</h3><p>Inventarios separados de conectores PSM y SIA en un único workspace. La pestaña PSM es la vista principal y se actualiza desde la sincronización PAM.</p></div>
        <div className="pam-platforms-actions">
          <span className="database-toolbar-count">{section === 'psm' ? `${formatNumber(psmTotal)} servidores PSM` : `${formatNumber(siaTotal)} conectores SIA`}</span>
          <CompactSelect
            className="pam-platforms-section-select"
            value={section}
            ariaLabel="Elegir inventario de conectores"
            options={[{ value: 'psm', label: 'PSM' }, { value: 'sia', label: 'SIA' }]}
            onChange={(value) => setSection(value as 'psm' | 'sia')}
          />
        </div>
      </div>
      <div className="search-row"><label className="search-box"><Search size={16} /><input type="search" aria-label={section === 'psm' ? 'Buscar conectores PSM' : 'Buscar conectores SIA'} placeholder={section === 'psm' ? 'Buscar conector o plataforma' : 'Buscar por id'} value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
      {section === 'psm' ? <><div className="compact-table-wrap"><table className="compact-table pam-platforms-table pam-connectors-table"><thead><tr><th>Servidor PSM</th><th>Dirección</th><th>Identificador</th><th>Plataformas asociadas</th></tr></thead><tbody>
        {psmLoading && psmRows.length === 0 ? <tr><td colSpan={4}><StateBlock variant="loading" title="Cargando conectores PSM…" /></td></tr>
          : psmError ? <tr><td colSpan={4}><StateBlock variant="error" title="No se pudieron cargar los conectores PSM" hint={psmError} action={<button type="button" className="button subtle" onClick={retryPsm}>Reintentar</button>} /></td></tr>
            : psmRows.length ? psmRows.map((connector) => <tr key={connector.object_id}>
              <td><span className="pam-platform-name"><Monitor size={15} aria-hidden /><span><strong>{connector.display_name}</strong><small>{formatNumber(connector.platform_count)} {connector.platform_count === 1 ? 'plataforma' : 'plataformas'}</small></span></span></td>
              <td>{connector.address ? <code className="pam-platform-pattern" title={connector.address}>{connector.address}</code> : <span className="muted">Sin dirección</span>}</td>
              <td><span className="muted">{connector.source_id}</span></td>
              <td>{connector.platforms.length
                ? <div className="pam-platform-psms">{connector.platforms.map((platform) => <button key={platform.object_id} type="button" title={`Ver plataforma ${platform.display_name}`} onClick={() => onOpenPlatforms(platform.display_name)}><Server size={13} aria-hidden />{platform.display_name}</button>)}</div>
                : <span className="muted">Sin plataformas</span>}</td>
            </tr>) : <tr><td colSpan={4}><StateBlock variant="empty" title={psmSearch ? 'Sin conectores PSM para esta búsqueda' : 'Todavía no hay conectores PSM sincronizados'} action={psmSearch ? <button type="button" className="button subtle" onClick={() => setPsmSearch('')}>Limpiar búsqueda</button> : undefined} /></td></tr>}
      </tbody></table></div>
      {!psmError && <LoadMore loaded={psmRows.length} total={psmTotal} pageSize={psmPageSize} loading={psmLoading} onLoadMore={loadMorePsm} />}
      </> : <><div className="compact-table-wrap"><table className="compact-table pam-platforms-table"><thead><tr><th>Conector</th><th>Estado</th><th>Versión</th><th>Región</th><th>Sesiones activas</th></tr></thead><tbody>
        {siaLoading && siaRows.length === 0 ? <tr><td colSpan={5}><StateBlock variant="loading" title="Cargando conectores SIA…" /></td></tr>
          : siaError ? <tr><td colSpan={5}><StateBlock variant="error" title="No se pudieron cargar los conectores SIA" hint={siaError} action={<button type="button" className="button subtle" onClick={retrySia}>Reintentar</button>} /></td></tr>
            : siaRows.length ? siaRows.map((connector) => <tr key={connector.object_id}>
              <td><span className="pam-platform-name"><Cable size={15} aria-hidden /><span><strong>{connector.display_name}</strong><small>{connector.attributes.os || 'Sin SO'}</small></span></span></td>
              <td><span className={connector.attributes.status === 'connected' ? 'status-pill status-active' : 'status-pill status-warning'}>{connector.attributes.status || 'Sin estado'}</span>{connector.attributes.is_latest_version ? null : <small> · actualización disponible</small>}</td>
              <td>{connector.attributes.version || <span className="muted">—</span>}</td>
              <td>{connector.attributes.region || <span className="muted">—</span>}</td>
              <td>{connector.attributes.active_sessions_count ?? <span className="muted">—</span>}</td>
            </tr>) : <tr><td colSpan={5}><StateBlock variant="empty" title={siaSearch ? 'Sin conectores SIA para esta búsqueda' : 'Todavía no hay conectores SIA sincronizados'} action={siaSearch ? <button type="button" className="button subtle" onClick={() => setSiaSearch('')}>Limpiar búsqueda</button> : undefined} /></td></tr>}
      </tbody></table></div>
      {!siaError && <LoadMore loaded={siaRows.length} total={siaTotal} pageSize={siaPageSize} loading={siaLoading} onLoadMore={loadMoreSia} />}
      </>}
      <p className="pam-platforms-note">{section === 'psm' ? <><Monitor size={13} aria-hidden /> Abrir una plataforma cambia a la sección Plataformas. Usá “Sincronizar datos” en el menú para actualizar PAM, PSM, SIA, Identity y Access en una sola acción.</> : <><Cable size={13} aria-hidden /> Inventario SIA de sólo lectura; no mezcla sus objetos con los servidores PSM.</>}</p>
    </section>
  </>;
}
