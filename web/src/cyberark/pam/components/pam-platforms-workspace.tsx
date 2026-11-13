import { platformTypeLabel } from '../lib/pam-platform-types';
import { useEffect, useState, type ReactNode } from 'react';
import { Cable, Monitor, Network, Search, Server, ShieldCheck } from 'lucide-react';
import { CompactSelect } from '../../../cross/components/compact-select';
import { formatNumber } from '../../../cross/lib/format';
import { fetchPamConnectors, fetchPamPlatforms, fetchPlatformCatalogs, fetchPlatformTargets, fetchPsmConnectorTypes } from '../lib/pam-technical-catalogs-api';
import { fetchSiaConnectors } from '../../sia/lib/sia-resources-api';
import { useSimpleCatalogList } from '../../../cross/hooks/use-simple-catalog-list';
import { usePamRefreshKey } from '../../shared/refresh-context';
import type { WorkspaceView } from '../../../cross/lib/workspaces';
import { StateBlock } from '../../../cross/components/state-block';
import { HelpHint } from '../../../cross/components/help-hint';
import { LoadMore } from '../../../cross/components/load-more';
import { BarCell } from '../../../cross/components/bar-cell';
import { barShare } from '../../../cross/lib/bar-share';
import { catalogCount, CatalogListPanel } from '../../shared/components/catalog-list-panel';
import './pam-technical-catalog.css';
import type {
  PamConnectorRow, PamPlatformRow, PlatformCatalogsResponse, PlatformTargetRow,
} from '../types/pam';
import type { SiaConnectorRow } from '../../sia/types/sia';
import { t } from '../../../cross/i18n/index.ts';

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
  activeSection?: 'psm' | 'sia';
  inventorySelector?: ReactNode;
};

function PlatformCatalogsSummary({ catalogs }: { catalogs: PlatformCatalogsResponse | null }) {
  if (!catalogs) return null;
  const dependents = Array.isArray(catalogs.dependents) ? catalogs.dependents : [];
  const groups = Array.isArray(catalogs.groups) ? catalogs.groups : [];
  const rotationalGroups = Array.isArray(catalogs.rotational_groups) ? catalogs.rotational_groups : [];
  if (!dependents.length && !groups.length && !rotationalGroups.length) return null;
  return <p className="pam-platforms-note" title={t('Catálogos técnicos separados de las plataformas destino: dependientes (CPM: servicios/tareas Windows, etc.), agrupadas y rotacionales.')}>
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

function PlatformMetric({ value, max }: { value: number; max: number }) {
  return <BarCell label={formatNumber(value)} share={barShare(value, max)} muted={value === 0} />;
}

function PlatformTargetsSection({ refreshKey, authChecked, authenticated, onUnauthorized, onError }: SharedProps & { refreshKey: number }) {
  const { search, setSearch, rows, total, loading, error, loadMore, retry, pageSize } = useSimpleCatalogList<PlatformTargetRow>({
    refreshKey, authChecked, authenticated, onUnauthorized, onError,
    resourceKey: 'platform-targets', fetcher: fetchPlatformTargets,
    errorFallback: t('No se pudo cargar la política de plataformas destino'),
  });

  return <CatalogListPanel<PlatformTargetRow>
    ariaLabel={t('Política de plataformas destino')}
    icon={ShieldCheck}
    title={t('Política por plataforma destino')}
    description={t('Dual control, verify/change/reconcile periódicos y el servidor PSM asignado. Catálogo propio de CyberArk: su identificador no siempre coincide con el de la plataforma base, por eso no se fusiona con la tabla de arriba.')}
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
      <td>{target.platform_base_id || <span className="muted">{t('Sin base')}</span>}</td>
      <td>{target.dual_control_required ? <span className="status-pill status-active">{t('Requerido')}</span> : <span className="muted">{t('No requerido')}</span>}</td>
      <td><span className="muted">
        {target.credentials_change_automatic ? `Change c/${target.credentials_change_interval_days ?? '?'}d` : 'Change manual'}
        {' · '}{target.credentials_verify_automatic ? `Verify c/${target.credentials_verify_interval_days ?? '?'}d` : 'Verify manual'}
        {' · '}{target.credentials_reconcile_automatic ? t('Reconcile automático') : t('Reconcile manual')}
      </span></td>
      <td>{target.psm_server_id ? <span className="muted">{target.psm_server_id}</span> : <span className="muted">{t('Sin PSM')}</span>}</td>
    </tr>}
  />;
}

export function PamPlatformsWorkspace({
  authChecked, authenticated, onUnauthorized, onError, onNavigate, onOpenConnectors, initialQuery = '',
}: PlatformProps) {
  const refreshKey = usePamRefreshKey();
  const [section, setSection] = useState<'inventory' | 'policy'>('inventory');
  const [catalogs, setCatalogs] = useState<PlatformCatalogsResponse | null>(null);
  const { search, setSearch, rows, total, loading, error, loadMore, retry, pageSize } = useSimpleCatalogList<PamPlatformRow>({
    refreshKey, authChecked, authenticated, onUnauthorized, onError, initialQuery,
    resourceKey: 'platforms', fetcher: fetchPamPlatforms,
    errorFallback: t('No se pudieron cargar las plataformas PAM'),
  });

  const maxSafes = Math.max(0, ...rows.map((platform) => platform.safe_count));
  const maxAccounts = Math.max(0, ...rows.map((platform) => platform.account_count));

  useEffect(() => {
    if (!authChecked || !authenticated) return;
    const controller = new AbortController();
    void fetchPlatformCatalogs({ signal: controller.signal }).then((response) => { if (!controller.signal.aborted) setCatalogs(response); }).catch(() => { /* non-blocking */ });
    return () => controller.abort();
  }, [authChecked, authenticated]);

  return <>
    <section className="list-panel database-surface pam-platforms-panel" aria-label={t('Plataformas PAM')}>
      <div className="pam-platforms-heading">
        <div className="pam-platforms-heading-copy">
          {section === 'policy' && <h2>{t('Política CPM por plataforma')}</h2>}
        </div>
        <div className="pam-platforms-actions">
          <span className="pam-platforms-count">{section === 'inventory' ? <><strong>{formatNumber(total)}</strong> activas</> : t('Catálogo CPM')}</span>
          <CompactSelect
            className="pam-platforms-section-select"
            value={section}
            ariaLabel={t('Elegir vista de plataformas')}
            options={[{ value: 'inventory', label: t('Inventario activo') }, { value: 'policy', label: t('Política CPM') }]}
            onChange={(value) => setSection(value as 'inventory' | 'policy')}
          />
        </div>
      </div>
      {section === 'inventory' && <>
      <div className="search-row"><label className="search-box"><Search size={16} /><input type="search" aria-label={t('Buscar plataformas PAM')} placeholder={t('Buscar plataforma activa')} value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
      <div className="compact-table-wrap"><table className="compact-table pam-platforms-table pam-platforms-inventory-table"><caption className="sr-only">{t('Plataformas PAM activas y sus relaciones observadas')}</caption><thead><tr><th>{t('Plataforma')}</th><th>{t('Tipo')}</th><th>{t('Safes permitidos')}</th><th>{t('Safes')}</th><th>{t('Cuentas')}</th><th>{t('Conectores PSM')}</th></tr></thead><tbody>
        {loading && rows.length === 0 ? <tr><td colSpan={6}><StateBlock variant="loading" title={t('Cargando plataformas PAM activas…')} /></td></tr>
          : error ? <tr><td colSpan={6}><StateBlock variant="error" title={t('No se pudieron cargar las plataformas PAM')} hint={error} action={<button type="button" className="button subtle" onClick={retry}>{t('Reintentar')}</button>} /></td></tr>
            : rows.length ? rows.map((platform) => <tr key={platform.object_id}>
              <td><button type="button" className="pam-platform-name" title={t('Buscar Safes con {display_name}', { display_name: platform.display_name })} onClick={() => onNavigate('safes', platform.display_name)}><PlatformIdentity platform={platform} /></button></td>
              <td><span className="pam-platform-type" title={platformTypeLabel(platform.system_type).raw ?? undefined}>{platformTypeLabel(platform.system_type).label}</span></td>
              <td>{platform.allowed_safes_pattern ? <code className="pam-platform-pattern" title={platform.allowed_safes_pattern}>{platform.allowed_safes_pattern}</code> : <span className="muted">{t('Sin patrón')}</span>}</td>
              <td><PlatformMetric value={platform.safe_count} max={maxSafes} /></td><td><PlatformMetric value={platform.account_count} max={maxAccounts} /></td>
              <td>{platform.psms.length
                ? <button type="button" className="pam-platform-related" title={t('Ver conectores PSM de {display_name}', { display_name: platform.display_name })} onClick={() => onOpenConnectors(platform.display_name)}><Monitor size={13} aria-hidden />{formatNumber(platform.psms.length)} {platform.psms.length === 1 ? 'conector' : 'conectores'}</button>
                : <span className="pam-platform-no-psm">{t('Sin conector')}</span>}</td>
            </tr>) : <tr><td colSpan={6}><StateBlock variant="empty" title={search ? t('Sin plataformas activas para esta búsqueda') : t('Todavía no hay plataformas PAM activas sincronizadas')} action={search ? <button type="button" className="button subtle" onClick={() => setSearch('')}>{t('Limpiar búsqueda')}</button> : undefined} /></td></tr>}
      </tbody></table></div>
      {!error && <LoadMore loaded={rows.length} total={total} pageSize={pageSize} loading={loading} onLoadMore={loadMore} />}
      <div className="pam-platforms-note">{t('Cómo leer esta tabla')}<HelpHint label={t('Cómo leer Plataformas')}><p>“Safes permitidos” es el patrón configurado por la plataforma, no una garantía de uso. Abrir una plataforma busca Safes asociados; los conectores no son telemetría de capacidad o salud.</p></HelpHint></div>
      <PlatformCatalogsSummary catalogs={catalogs} />
       <PsmConnectorTypesSection refreshKey={refreshKey} authChecked={authChecked} authenticated={authenticated} onUnauthorized={onUnauthorized} onError={onError} />
      </>}
      {section === 'policy' && <PlatformTargetsSection refreshKey={refreshKey} authChecked={authChecked} authenticated={authenticated} onUnauthorized={onUnauthorized} onError={onError} />}
    </section>
  </>;
}

function PsmConnectorTypesSection({ refreshKey, authChecked, authenticated, onUnauthorized, onError }: SharedProps & { refreshKey: number }) {
  const { rows, total, loading, error, loadMore, pageSize } = useSimpleCatalogList({
    refreshKey, authChecked, authenticated, onUnauthorized, onError,
    resourceKey: 'psm-connector-types', fetcher: fetchPsmConnectorTypes,
    errorFallback: t('No se pudieron cargar los tipos de conector PSM'),
    pageSize: 200,
  });

  if (loading || error || !rows.length) return null;
  return <section className="pam-platform-catalog-section" aria-label={t('Tipos de conector de sesión PSM')}>
    <div className="pam-platforms-heading">
      <div><h2>{t('Tipos de conector de sesión')}</h2><p>{t('Catálogo técnico de conectores PSM (ej. RDP, SSH). No son servidores PSM.')}</p></div>
      <span className="database-toolbar-count">{formatNumber(total)} tipos</span>
    </div>
    <div className="pam-platform-psms" style={{ padding: '0 16px 14px' }}>
      {rows.map((connector) => <span key={connector.object_id} title={connector.source_id}><Monitor size={13} aria-hidden />{connector.display_name}</span>)}
    </div>
    {rows.length < total && <div className="pam-platform-psms" style={{ padding: '0 16px 14px' }}>
      <button type="button" className="button subtle" onClick={loadMore}>{t('Cargar {rows} más', { rows: formatNumber(Math.min(pageSize, total - rows.length)) })}</button>
    </div>}
  </section>;
}

export function PamConnectorsWorkspace({
  authChecked, authenticated, onUnauthorized, onError, onOpenPlatforms, initialQuery = '', activeSection, inventorySelector,
}: ConnectorProps) {
  const refreshKey = usePamRefreshKey();
  const [localSection, setSection] = useState<'psm' | 'sia'>('psm');
  const section = activeSection ?? localSection;
  const {
    search: psmSearch, setSearch: setPsmSearch, rows: psmRows, total: psmTotal, loading: psmLoading,
    error: psmError, loadMore: loadMorePsm, retry: retryPsm, pageSize: psmPageSize,
  } = useSimpleCatalogList<PamConnectorRow>({
    refreshKey, authChecked, authenticated, onUnauthorized, onError, initialQuery,
    resourceKey: 'pam-connectors', fetcher: fetchPamConnectors,
    errorFallback: t('No se pudieron cargar los conectores PSM'),
  });
  const {
    search: siaSearch, setSearch: setSiaSearch, rows: siaRows, total: siaTotal, loading: siaLoading,
    error: siaError, loadMore: loadMoreSia, retry: retrySia, pageSize: siaPageSize,
  } = useSimpleCatalogList<SiaConnectorRow>({
    refreshKey, authChecked, authenticated, onUnauthorized, onError, initialQuery,
    resourceKey: 'sia-connectors', fetcher: fetchSiaConnectors,
    errorFallback: t('No se pudieron cargar los conectores SIA'),
  });

  const search = section === 'psm' ? psmSearch : siaSearch;
  const setSearch = section === 'psm' ? setPsmSearch : setSiaSearch;

  return <>
    <section className="list-panel database-surface pam-platforms-panel" aria-label={t('Conectores PSM y SIA')}>
      <div className="pam-platforms-heading">
        <div className="pam-platforms-actions">
          <span className="database-toolbar-count">{section === 'psm' ? `${formatNumber(psmTotal)} servidores PSM` : `${formatNumber(siaTotal)} conectores SIA`}</span>
          {inventorySelector ?? <CompactSelect
            className="pam-platforms-section-select"
            value={section}
            ariaLabel={t('Elegir inventario de conectores')}
            options={[{ value: 'psm', label: 'PSM' }, { value: 'sia', label: 'SIA' }]}
            onChange={(value) => setSection(value as 'psm' | 'sia')}
          />}
        </div>
      </div>
      <div className="search-row"><label className="search-box"><Search size={16} /><input type="search" aria-label={section === 'psm' ? t('Buscar conectores PSM') : t('Buscar conectores SIA')} placeholder={section === 'psm' ? t('Buscar conector o plataforma') : t('Buscar por id')} value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
      {section === 'psm' ? <><div className="compact-table-wrap"><table className="compact-table pam-platforms-table pam-connectors-table"><thead><tr><th>{t('Servidor PSM')}</th><th>{t('Dirección')}</th><th>{t('Identificador')}</th><th>{t('Plataformas asociadas')}</th></tr></thead><tbody>
        {psmLoading && psmRows.length === 0 ? <tr><td colSpan={4}><StateBlock variant="loading" title={t('Cargando conectores PSM…')} /></td></tr>
          : psmError ? <tr><td colSpan={4}><StateBlock variant="error" title={t('No se pudieron cargar los conectores PSM')} hint={psmError} action={<button type="button" className="button subtle" onClick={retryPsm}>{t('Reintentar')}</button>} /></td></tr>
            : psmRows.length ? psmRows.map((connector) => <tr key={connector.object_id}>
              <td><span className="pam-platform-name"><Monitor size={15} aria-hidden /><span><strong title={connector.display_name}>{connector.display_name}</strong><small>{formatNumber(connector.platform_count)} {connector.platform_count === 1 ? 'plataforma' : 'plataformas'}</small></span></span></td>
              <td>{connector.address ? <code className="pam-platform-pattern" title={connector.address}>{connector.address}</code> : <span className="muted">{t('Sin dirección')}</span>}</td>
              <td>{connector.source_id !== connector.display_name ? <span className="muted pam-connector-id" title={connector.source_id}>{connector.source_id}</span> : <span className="muted">—</span>}</td>
              <td>{connector.platforms.length
                ? <ConnectorPlatforms platforms={connector.platforms} name={connector.display_name} onOpen={onOpenPlatforms} />
                : <span className="muted">{t('Sin plataformas')}</span>}</td>
            </tr>) : <tr><td colSpan={4}><StateBlock variant="empty" title={psmSearch ? t('Sin conectores PSM para esta búsqueda') : t('Todavía no hay conectores PSM sincronizados')} action={psmSearch ? <button type="button" className="button subtle" onClick={() => setPsmSearch('')}>{t('Limpiar búsqueda')}</button> : undefined} /></td></tr>}
      </tbody></table></div>
      {!psmError && <LoadMore loaded={psmRows.length} total={psmTotal} pageSize={psmPageSize} loading={psmLoading} onLoadMore={loadMorePsm} />}
      </> : <><div className="compact-table-wrap"><table className="compact-table pam-platforms-table sia-connectors-table"><thead><tr><th>{t('Conector')}</th><th>{t('Estado')}</th><th>{t('Versión')}</th><th>{t('Región')}</th><th>{t('Sesiones activas')}</th></tr></thead><tbody>
        {siaLoading && siaRows.length === 0 ? <tr><td colSpan={5}><StateBlock variant="loading" title={t('Cargando conectores SIA…')} /></td></tr>
          : siaError ? <tr><td colSpan={5}><StateBlock variant="error" title={t('No se pudieron cargar los conectores SIA')} hint={siaError} action={<button type="button" className="button subtle" onClick={retrySia}>{t('Reintentar')}</button>} /></td></tr>
            : siaRows.length ? siaRows.map((connector) => <tr key={connector.object_id}>
              <td><span className="pam-platform-name"><Cable size={15} aria-hidden /><span><strong title={connector.display_name}>{connector.display_name}</strong><small>{connector.attributes.os || t('Sin SO')}</small></span></span></td>
              <td><span className={connector.attributes.status === 'connected' ? 'status-pill status-active' : 'status-pill status-warning'}>{connector.attributes.status || t('Sin estado')}</span>{connector.attributes.is_latest_version ? null : <small> {t('· actualización disponible')}</small>}</td>
              <td className="pam-connector-version">{connector.attributes.version || <span className="muted">—</span>}</td>
              <td>{connector.attributes.region || <span className="muted">—</span>}</td>
              <td>{connector.attributes.active_sessions_count ?? <span className="muted">—</span>}</td>
            </tr>) : <tr><td colSpan={5}><StateBlock variant="empty" title={siaSearch ? t('Sin conectores SIA para esta búsqueda') : t('Todavía no hay conectores SIA sincronizados')} action={siaSearch ? <button type="button" className="button subtle" onClick={() => setSiaSearch('')}>{t('Limpiar búsqueda')}</button> : undefined} /></td></tr>}
      </tbody></table></div>
      {!siaError && <LoadMore loaded={siaRows.length} total={siaTotal} pageSize={siaPageSize} loading={siaLoading} onLoadMore={loadMoreSia} />}
      </>}
      <div className="pam-platforms-note">{section === 'psm' ? t('Cómo leer los conectores') : t('Inventario SIA de sólo lectura')}<HelpHint label={section === 'psm' ? t('Cómo leer los conectores PSM') : t('Acerca del inventario SIA')}><p>{section === 'psm' ? t('Abrir una plataforma cambia a la sección Plataformas. Usá “Actualizar datos” en el menú de usuario para actualizar PAM, PSM, SIA, Identity y Access en una sola acción.') : t('Inventario SIA de sólo lectura; no mezcla sus objetos con los servidores PSM.')}</p></HelpHint></div>
    </section>
  </>;
}


const CONNECTOR_PLATFORM_PREVIEW = 2;

/** FE-AUD-007: two platforms per PSM and a keyboard-reachable expansion for the rest, so rows stay comparable. */
function ConnectorPlatforms({ platforms, name, onOpen }: { platforms: { object_id: number; display_name: string }[]; name: string; onOpen: (platformName: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const hidden = platforms.length - CONNECTOR_PLATFORM_PREVIEW;
  const visible = expanded || hidden <= 0 ? platforms : platforms.slice(0, CONNECTOR_PLATFORM_PREVIEW);
  return <div className="pam-platform-psms">
    {visible.map((platform) => <button key={platform.object_id} type="button" title={t('Ver plataforma {display_name}', { display_name: platform.display_name })} onClick={() => onOpen(platform.display_name)}><Server size={13} aria-hidden /><span>{platform.display_name}</span></button>)}
    {hidden > 0 ? <button type="button" className="pam-platform-psms-more" aria-expanded={expanded} aria-label={expanded ? t('Mostrar menos plataformas de {name}', { name: name }) : t('Mostrar {hidden} plataformas más de {name}', { hidden: hidden, name: name })} onClick={() => setExpanded(!expanded)}>{expanded ? 'Menos' : t('+{hidden} más', { hidden: hidden })}</button> : null}
  </div>;
}
