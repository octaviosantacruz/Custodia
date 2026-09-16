import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ChevronRight, Database, KeyRound, Monitor, Search, Server, X } from 'lucide-react';
import { CompactSelect } from './compact-select';
import { StateBlock } from './state-block';
import { TablePagination } from './table-pagination';
import { formatNumber } from '../lib/format';
import { PAM_USER_PAGE_SIZE } from '../lib/pam-chain-api';
import { usePamChain } from '../hooks/use-pam-chain';
import { useDialogFocusTrap } from '../hooks/use-dialog-focus-trap';
import { StandardSeatBadge } from './standard-seat-badge';
import { classifyPamIdentity, PAM_IDENTITY_KIND_LABELS } from '../lib/pam-identity-classification';
import { aggregateRoleRoutes, chainPathRows, groupRowsByRole, type PamChainPathRow, type PamChainRoleGroup } from '../lib/pam-chain-layout';
import type { WorkspaceView } from '../lib/workspaces';
import './pam-chain-workspace.css';

type PamChainWorkspaceProps = {
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  onNavigate: (view: WorkspaceView, query?: string) => void;
  includeInternal: boolean;
  initialQuery?: string;
};

type ChainNodeKind = 'role' | 'safe' | 'platform' | 'psm';

type ChainNodeDetail = {
  kind: ChainNodeKind;
  name: string;
  identifier: string;
  context: string;
  facts: Array<{ label: string; value: string }>;
  safeName?: string;
  navigateView?: WorkspaceView;
  kindLabel?: string;
};

const NODE_META: Record<ChainNodeKind, { label: string; icon: typeof KeyRound }> = {
  role: { label: 'Rol PAM', icon: KeyRound },
  safe: { label: 'Safe', icon: Database },
  platform: { label: 'Plataforma', icon: Server },
  psm: { label: 'PSM', icon: Monitor },
};

const SAFE_ROUTE_PREVIEW = 4;

function resultLabel(count: number): string {
  return formatNumber(count) + (count === 1 ? ' usuario' : ' usuarios');
}

function ChainPathNode({ detail, onOpen, onActivate, actionTitle }: { detail: ChainNodeDetail; onOpen: (detail: ChainNodeDetail, trigger: HTMLButtonElement) => void; onActivate?: () => void; actionTitle?: string }) {
  const meta = NODE_META[detail.kind];
  const label = detail.kindLabel || meta.label;
  const Icon = meta.icon;
  return <button type="button" className={'pam-chain-path-node is-' + detail.kind} aria-label={`Abrir ${label} ${detail.name}`} title={actionTitle || `Ver detalles de ${label.toLowerCase()} ${detail.name}`} onClick={(event) => onActivate ? onActivate() : onOpen(detail, event.currentTarget)}>
    <span className="pam-chain-path-node-icon"><Icon size={15} aria-hidden /></span>
    <span><small>{label}</small><strong>{detail.name}</strong></span>
  </button>;
}

function RoleSafeRoutes({ group, onOpen }: { group: PamChainRoleGroup; onOpen: (detail: ChainNodeDetail, trigger: HTMLButtonElement) => void }) {
  const [expanded, setExpanded] = useState(false);
  const routes = useMemo(() => aggregateRoleRoutes(group.rows), [group.rows]);
  const visibleSafes = expanded ? routes.safes : routes.safes.slice(0, SAFE_ROUTE_PREVIEW);
  const visiblePlatforms = expanded ? routes.platforms : routes.platforms.slice(0, SAFE_ROUTE_PREVIEW);
  const visiblePsms = expanded ? routes.psms : routes.psms.slice(0, SAFE_ROUTE_PREVIEW);
  const extra = Math.max(0, routes.safes.length - SAFE_ROUTE_PREVIEW)
    + Math.max(0, routes.platforms.length - SAFE_ROUTE_PREVIEW)
    + Math.max(0, routes.psms.length - SAFE_ROUTE_PREVIEW);
  return <>
    <div className="pam-layered-branch">
      <div className="pam-layered-cell">
        {visibleSafes.map((safe) => <ChainPathNode key={safe.object_id} detail={{ kind: 'safe', name: safe.display_name, identifier: safe.safe_number, context: `Safe concedido por el rol ${group.role.display_name}.`, facts: [{ label: 'Cuentas', value: formatNumber(safe.account_count) }, { label: 'Plataformas', value: formatNumber(safe.platform_count) }], safeName: safe.display_name }} onOpen={onOpen} />)}
        {routes.missingSafe ? <span className="pam-layered-stop">Sin Safe</span> : null}
        {extra > 0 ? <button
          type="button"
          className="pam-layered-more"
          aria-expanded={expanded}
          title={expanded ? 'Ocultar nodos adicionales de este rol' : `Mostrar ${formatNumber(extra)} nodos más de este rol`}
          onClick={() => setExpanded((current) => !current)}
        >{expanded ? 'Mostrar menos' : `+ ${formatNumber(extra)} más`}</button> : null}
      </div>
      <div className="pam-layered-cell">
        {visiblePlatforms.map(({ platform, safeNames }) => <ChainPathNode key={platform.object_id} detail={{ kind: 'platform', name: platform.display_name, identifier: platform.source_id, context: `Plataforma utilizada por ${formatNumber(safeNames.length)} ${safeNames.length === 1 ? 'Safe' : 'Safes'} concedidos por el rol ${group.role.display_name}.`, facts: [{ label: 'Safes vinculados', value: formatNumber(safeNames.length) }, { label: 'PSM vinculados', value: formatNumber(platform.psms.length) }], navigateView: 'platforms' }} onOpen={onOpen} />)}
        {routes.missingPlatform ? <span className="pam-layered-stop">Sin plataforma</span> : null}
      </div>
      <div className="pam-layered-cell">
        {visiblePsms.map(({ psm, platformNames }) => <ChainPathNode key={psm.object_id} detail={{ kind: 'psm', name: psm.display_name, identifier: psm.source_id, context: `PSM vinculado a ${formatNumber(platformNames.length)} ${platformNames.length === 1 ? 'plataforma' : 'plataformas'} de este rol.`, facts: [{ label: 'Plataformas vinculadas', value: formatNumber(platformNames.length) }], navigateView: 'connectors' }} onOpen={onOpen} />)}
        {routes.missingPsm ? <span className="pam-layered-stop">Sin PSM</span> : null}
      </div>
    </div>
  </>;
}

function ChainNodeDrawer({ detail, onClose, onNavigate }: { detail: ChainNodeDetail; onClose: () => void; onNavigate: (view: WorkspaceView, query?: string) => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const meta = NODE_META[detail.kind];
  const Icon = meta.icon;
  const label = detail.kindLabel || meta.label;
  const dialogRef = useDialogFocusTrap<HTMLDivElement>({ onClose, initialFocusRef: closeRef });

  return <div ref={dialogRef} className="drawer-layer" role="dialog" aria-modal="true" aria-labelledby="pam-chain-node-title" tabIndex={-1}>
    <button className="drawer-backdrop" type="button" aria-label="Cerrar detalle de la cadena" onClick={onClose} />
    <aside className="detail-drawer pam-chain-node-drawer">
      <div className="detail-title">
        <div className="detail-icon"><Icon size={18} /></div>
        <div className="detail-heading"><p className="eyebrow">{label.toUpperCase()}</p><h2 id="pam-chain-node-title">{detail.name}</h2><p>Relación PAM verificada</p></div>
        <button ref={closeRef} className="icon-button drawer-close" type="button" title="Cerrar el detalle" aria-label="Cerrar el detalle" onClick={onClose}><X size={16} aria-hidden /></button>
      </div>
      <section className="detail-section pam-chain-node-summary">
        <p>{detail.context}</p>
        <dl className="pam-chain-node-facts">
          <div><dt>Identificador</dt><dd className="mono">{detail.identifier}</dd></div>
          {detail.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
        </dl>
        {detail.safeName || detail.navigateView ? <button type="button" className="button secondary pam-chain-node-action" title={`Abrir el inventario de ${detail.name}`} onClick={() => onNavigate(detail.safeName ? 'safes' : detail.navigateView!, detail.safeName || detail.name)}><ArrowUpRight size={14} aria-hidden /> Abrir inventario</button> : null}
      </section>
    </aside>
  </div>;
}

function ChainExplorerEmpty() {
  return <section className="pam-chain-overview" aria-label="Mapa de la cadena PAM">
    <div><p className="eyebrow">RECORRIDO PAM</p><h3>Empezá por una identidad</h3><p>Seleccioná un usuario de la lista. El mapa muestra sólo sus relaciones verificadas y agrupa los nodos compartidos dentro de cada rol.</p></div>
    <div className="pam-chain-overview-track" aria-label="Capas del recorrido PAM">
      <span className="is-source"><KeyRound size={15} aria-hidden />Usuario PAM<small>Elegí uno a la izquierda</small></span><ChevronRight size={16} aria-hidden /><span><KeyRound size={15} aria-hidden />Rol</span><ChevronRight size={16} aria-hidden /><span><Database size={15} aria-hidden />Safe</span><ChevronRight size={16} aria-hidden /><span><Server size={15} aria-hidden />Plataforma</span><ChevronRight size={16} aria-hidden /><span><Monitor size={15} aria-hidden />PSM</span>
    </div>
  </section>;
}

function PamLayeredGraph({ user, rows, onOpen, onNavigate }: { user: { display_name: string; source_id: string }; rows: PamChainPathRow[]; onOpen: (detail: ChainNodeDetail, trigger: HTMLButtonElement) => void; onNavigate: (view: WorkspaceView, query?: string) => void }) {
  const groups = useMemo(() => groupRowsByRole(rows), [rows]);
  return <section className="pam-layered-graph" aria-label="Mapa de relaciones PAM">
    <div className="pam-layered-graph-heading">
      <div><h3>Mapa de acceso de {user.display_name}</h3><p>Las ramas representan relaciones PAM verificadas; cada nodo compartido aparece una sola vez por rol.</p></div>
      <span>{formatNumber(rows.length)} {rows.length === 1 ? 'rama' : 'ramas'}</span>
    </div>
    <div className="pam-layered-legend" aria-hidden><span>Identidad</span><span>Roles</span><span>Safes</span><span>Plataformas</span><span>PSM</span></div>
    <div className="pam-layered-map">
      <button type="button" className="pam-layered-origin" aria-label={`Buscar ${user.display_name} en Identidades`} title={`Buscar ${user.display_name} en Identidades`} onClick={() => onNavigate('identityUsers', user.display_name)}>
        <span>Identidad</span><strong>{user.display_name}</strong><small>{user.source_id}</small>
      </button>
      <div className="pam-layered-branches">
        {groups.map((group) => {
          const roleKind = classifyPamIdentity(group.role.display_name);
          const roleDetail: ChainNodeDetail = { kind: 'role', kindLabel: PAM_IDENTITY_KIND_LABELS[roleKind], name: group.role.display_name, identifier: group.role.source_id, context: `${PAM_IDENTITY_KIND_LABELS[roleKind]} asignado a ${user.display_name}.`, facts: [{ label: 'Safes alcanzables', value: formatNumber(group.role.safe_count) }, { label: 'Ramas visibles', value: formatNumber(group.rows.length) }], navigateView: 'roles' };
          return <div className="pam-layered-role-group" key={group.role.object_id}>
            <div className="pam-layered-role-cell"><ChainPathNode detail={roleDetail} onOpen={onOpen} onActivate={() => onNavigate('roles', group.role.display_name)} actionTitle={`Abrir ${group.role.display_name} en Roles CyberArk`} /><small>{formatNumber(group.rows.length)} {group.rows.length === 1 ? 'rama' : 'ramas'}</small></div>
            <div className="pam-layered-role-routes"><RoleSafeRoutes group={group} onOpen={onOpen} /></div>
          </div>;
        })}
      </div>
    </div>
  </section>;
}

export function PamChainWorkspace({ authChecked, authenticated, onUnauthorized, onError, onNavigate, includeInternal, initialQuery = '' }: PamChainWorkspaceProps) {
  const controller = usePamChain({ authChecked, authenticated, onUnauthorized, onError, includeInternal, enabled: true, initialQuery });
  const rows = useMemo(() => controller.chain ? chainPathRows(controller.chain) : [], [controller.chain]);
  const [selectedNode, setSelectedNode] = useState<ChainNodeDetail | null>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setSelectedNode(null);
  }, [controller.selectedUser?.object_id]);

  const openNode = useCallback((detail: ChainNodeDetail, trigger: HTMLButtonElement) => {
    returnFocusRef.current = trigger;
    setSelectedNode(detail);
  }, []);
  const closeNode = useCallback(() => {
    setSelectedNode(null);
    window.requestAnimationFrame(() => returnFocusRef.current?.focus());
  }, []);

  return <>
    <div className="pam-chain-explorer-intro">
      <div><p className="eyebrow">EXPLORADOR PAM</p><h2>Elegí una identidad y seguí su acceso</h2><p>Las capas muestran únicamente relaciones verificadas. Abrí el inventario correspondiente para revisar el detalle.</p></div>
      <span className="database-toolbar-count">{resultLabel(controller.total)}</span>
    </div>
    <div className="pam-chain-layout">
      <section className="list-panel database-surface pam-chain-user-panel" aria-label="Usuarios PAM">
        <div className="search-row"><label className="search-box"><Search size={16} /><input type="search" aria-label="Buscar usuarios PAM por nombre o identificador" placeholder="Nombre o identificador" value={controller.search} onChange={(event) => controller.setSearch(event.target.value)} /></label><CompactSelect className="inline-select" value={controller.standardSeat} ariaLabel="Filtrar usuarios PAM por conciliación de asiento Standard" options={[{ value: '', label: 'Todos los usuarios' }, { value: 'reconciled', label: 'Asiento Standard conciliado' }, { value: 'unreconciled', label: 'Sin asiento Standard conciliado' }]} onChange={(value) => controller.setStandardSeat(value as '' | 'reconciled' | 'unreconciled')} /><CompactSelect className="inline-select" value={controller.status} ariaLabel="Filtrar usuarios PAM por estado operativo" options={[{ value: '', label: 'Cualquier estado' }, { value: 'suspended', label: 'Suspendidos' }, { value: 'disabled', label: 'Deshabilitados' }]} onChange={(value) => controller.setStatus(value as '' | 'suspended' | 'disabled')} /></div>
        <div className="pam-chain-user-list">
          {controller.loading
            ? <StateBlock variant="loading" title="Cargando usuarios PAM…" />
            : controller.loadError
              ? <StateBlock variant="error" title="No se pudieron cargar los usuarios PAM" hint={controller.loadError} action={<button type="button" className="button subtle" onClick={() => void controller.reload()}>Reintentar</button>} />
              : controller.users.length
                ? controller.users.map((user) => <button
                    key={user.object_id}
                    type="button"
                    className={'pam-chain-user' + (controller.selectedUser?.object_id === user.object_id ? ' selected' : '')}
                    aria-pressed={controller.selectedUser?.object_id === user.object_id}
                    title={`Ver la cadena de acceso de ${user.display_name}`}
                    onClick={() => void controller.selectUser(user)}
                  ><span><strong>{user.display_name}</strong><small>ID {user.source_id}</small></span><span className="pam-chain-user-meta">{user.suspended ? <span className="status-pill status-warning" title="Usuario suspendido en CyberArk">Suspendido</span> : !user.enabled ? <span className="status-pill status-muted" title="Usuario deshabilitado en CyberArk">Deshabilitado</span> : null}<StandardSeatBadge reconciled={user.standard_seat_reconciled} /><span className="pam-chain-user-count">{formatNumber(user.role_count)} roles</span></span></button>)
                : <StateBlock variant="empty" title={controller.search ? 'Sin usuarios para esta búsqueda' : 'Todavía no hay usuarios PAM sincronizados'} action={controller.search ? <button type="button" className="button subtle" onClick={() => controller.setSearch('')}>Limpiar búsqueda</button> : undefined} />}
        </div>
        <TablePagination page={controller.page} pageSize={PAM_USER_PAGE_SIZE} total={controller.total} onPageChange={controller.setPage} />
      </section>

      <section className="pam-chain-detail-panel" aria-label="Detalle de cadena PAM">
        {!controller.selectedUser && <ChainExplorerEmpty />}
        {controller.selectedUser && controller.chainLoading && <StateBlock variant="loading" title={`Armando la cadena de ${controller.selectedUser.display_name}…`} />}
        {controller.selectedUser && controller.chainError && <StateBlock variant="error" title="No se pudo cargar la cadena" hint={controller.chainError} action={<button type="button" className="button subtle" onClick={() => void controller.selectUser(controller.selectedUser!)}>Reintentar</button>} />}
        {controller.selectedUser && controller.chain && <PamLayeredGraph user={controller.selectedUser} rows={rows} onOpen={openNode} onNavigate={onNavigate} />}
      </section>
    </div>
    {selectedNode ? <ChainNodeDrawer detail={selectedNode} onClose={closeNode} onNavigate={onNavigate} /> : null}
  </>;
}
