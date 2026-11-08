/**
 * Dirige los workspaces SSE a inventario, métricas, políticas, experiencia y alertas DLP.
 * Los alias históricos conservan su destino; DLP mantiene su permiso específico.
 * Las consultas y componentes Netskope permanecen dentro de esta herramienta.
 */
import { lazyWithRetry } from '../../cross/lib/lazy-with-retry';
import { NetskopeWorkspace } from './components/netskope-workspace';
import type { NetskopeView } from './hooks/use-netskope-inventory';
import type { WorkspaceView } from '../../cross/lib/workspaces';

type NetskopeDomainRouterProps = {
  workspaceView: WorkspaceView;
  refreshKey: number;
  permissions: string[];
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onNavigate: (view: WorkspaceView) => void;
};

const NetskopeDlpWorkspace = lazyWithRetry(() => import('./components/netskope-dlp-alerts').then((module) => ({ default: module.NetskopeDlpWorkspace })), 'netskope-dlp-alerts');
const NetskopeAdminsWorkspace = lazyWithRetry(() => import('./components/netskope-admins-workspace').then((module) => ({ default: module.NetskopeAdminsWorkspace })), 'netskope-admins-workspace');
const NetskopeOfficeWorkspace = lazyWithRetry(() => import('./components/netskope-office-workspace').then((module) => ({ default: module.NetskopeOfficeWorkspace })), 'netskope-office-workspace');
const NetskopeUciWorkspace = lazyWithRetry(() => import('./components/netskope-uci-workspace').then((module) => ({ default: module.NetskopeUciWorkspace })), 'netskope-uci-workspace');
const NetskopePostureWorkspace = lazyWithRetry(() => import('./components/netskope-posture-workspace').then((module) => ({ default: module.NetskopePostureWorkspace })), 'netskope-posture-workspace');
const NetskopeExperienceWorkspace = lazyWithRetry(() => import('./components/netskope-experience-workspace').then((module) => ({ default: module.NetskopeExperienceWorkspace })), 'netskope-experience-workspace');

const VIEW_BY_WORKSPACE: Partial<Record<WorkspaceView, NetskopeView>> = {
  netskope: 'metrics',
  netskopeOperations: 'operations',
  netskopeInventory: 'inventory',
  netskopeChains: 'inventory',
  netskopeDevices: 'devices',
  netskopeUsers: 'users',
};

const WORKSPACE_BY_VIEW: Record<NetskopeView, WorkspaceView> = {
  metrics: 'netskope',
  operations: 'netskopeOperations',
  inventory: 'netskopeInventory',
  devices: 'netskopeDevices',
  users: 'netskopeUsers',
};

/** Netskope owns the summary, device-status view and unified inventory. */
export function NetskopeDomainRouter({
  workspaceView, refreshKey, permissions, authChecked, authenticated, onUnauthorized, onError, onNotice, onNavigate,
}: NetskopeDomainRouterProps) {
  if (workspaceView === 'netskopeDlp') {
    /* NSK-DLP-001: strict workspace, unlocked only by netskope:dlp_read. */
    return <NetskopeDlpWorkspace
      refreshKey={refreshKey}
      authChecked={authChecked}
      authenticated={authenticated}
      onUnauthorized={onUnauthorized}
      onError={onError}
      onNotice={onNotice}
    />;
  }
  if (workspaceView === 'netskopeAdmins') {
    /* NSK-RBAC-001: strict workspace, unlocked only by netskope:admin_inventory_read. */
    return <NetskopeAdminsWorkspace refreshKey={refreshKey} authChecked={authChecked} authenticated={authenticated} onUnauthorized={onUnauthorized} />;
  }
  if (workspaceView === 'netskopeOfficeExperience') {
    /* NSK-EXP-OFFICE-001: strict workspace, unlocked only by netskope:uba_read. */
    return <NetskopeOfficeWorkspace refreshKey={refreshKey} authChecked={authChecked} authenticated={authenticated} onUnauthorized={onUnauthorized} />;
  }
  if (workspaceView === 'netskopeUci') {
    /* NSK-UBA-002: strict workspace, unlocked only by netskope:uba_read. */
    return <NetskopeUciWorkspace refreshKey={refreshKey} authChecked={authChecked} authenticated={authenticated} onUnauthorized={onUnauthorized} />;
  }
  if (workspaceView === 'netskopePosture') {
    /* NSK-POSTURE-001: each group drills into the inventory with its exact filters. */
    return <NetskopePostureWorkspace refreshKey={refreshKey} authChecked={authChecked} authenticated={authenticated} onUnauthorized={onUnauthorized} onNavigate={onNavigate} />;
  }
  if (workspaceView === 'netskopeDemSites') {
    return <NetskopeExperienceWorkspace refreshKey={refreshKey} authChecked={authChecked} authenticated={authenticated} canReadUba={permissions.includes('netskope:uba_read')} onUnauthorized={onUnauthorized} onError={onError} onNavigate={onNavigate} />;
  }
  return <NetskopeWorkspace
    view={VIEW_BY_WORKSPACE[workspaceView] ?? 'metrics'}
    refreshKey={refreshKey}
    permissions={permissions}
    authChecked={authChecked}
    authenticated={authenticated}
    onUnauthorized={onUnauthorized}
    onError={onError}
    onNotice={onNotice}
    onNavigate={(nextView) => onNavigate(WORKSPACE_BY_VIEW[nextView])}
    onOpenPosture={(checks) => {
      onNavigate('netskopePosture');
      // Postura opens the rows named in ?open= of the entry the navigation just created.
      if (window.location.pathname === '/netskope/posture') window.history.replaceState(window.history.state, '', `/netskope/posture?open=${checks.join(',')}`);
    }}
  />;
}
