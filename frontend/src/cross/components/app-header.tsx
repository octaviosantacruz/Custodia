import { dateTimeHint } from '../lib/format';
import { useToolSyncPresentation } from '../hooks/use-tool-sync-presentation';
import { ChevronRight } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { ProfileMenu } from './profile-menu';
import { NotificationMenu } from './notification-menu';
import { WorkspaceSwitcher } from './workspace-switcher';
import { ToolSwitcher } from './tool-switcher';
import { GlobalSearch } from './global-search';
import { useAuthContext } from '../context/auth-context';
import { useNotificationContext } from '../context/notification-context';
import type { WorkspaceView } from '../lib/workspaces';
import { workspaceLabels } from '../lib/workspace-meta';
import { syncForWorkspace, WORKSPACE_TOOL_LABELS } from '../../sources';
import { areaOf, domainHasSectionNav } from '../lib/domains';
import { CustodiaMark } from './home-workspace';
import type { SearchResult } from '../lib/search-api';
import type { CommandCenterCommand } from '../lib/command-center';
import type { WorkspacePreferences } from '../lib/workspace-preferences-api';
import { fetchIngestionRuns, INGESTION_RUNS_QUERY_KEY } from '../lib/ingestion-api';
import { syncDomainForSource, syncToolForSource, syncToolLabel } from '../lib/sync-source';
import { syncStatusLabel } from '../lib/sync-status-label';
import './app-header.css';

export type { WorkspaceView } from '../lib/workspaces';

type AppHeaderProps = {
  isHome?: boolean;
  theme: 'dark' | 'light';
  onThemeChange: () => void;
  workspaceView: WorkspaceView;
  onWorkspaceChange: (view: WorkspaceView) => void;
  onHome: () => void;
  syncBusy: boolean;
  ingestionBusy: boolean;
  onRefreshData: () => void;
  includeInternalMetrics: boolean;
  onSearchSelect: (result: SearchResult) => void;
  commandCenterCommands: CommandCenterCommand[];
  workspacePreferences: WorkspacePreferences;
  onWorkspacePreferencesChange: (next: Partial<Pick<WorkspacePreferences, 'visible_workspaces' | 'hidden_workspaces' | 'recent_workspaces'>>) => Promise<void>;
};

/** "CyberArk SIA > SIA" repeats itself: skip the workspace segment when the tool name already ends with it. */
function locationRepeatsTool(tool: string, workspace: string): boolean {
  return tool.trim().toLocaleLowerCase('es').endsWith(workspace.trim().toLocaleLowerCase('es'));
}

export function AppHeader({
  isHome = false, theme, onThemeChange, workspaceView, onWorkspaceChange, onHome,
  syncBusy, ingestionBusy, onRefreshData,
  includeInternalMetrics, onSearchSelect, commandCenterCommands, workspacePreferences, onWorkspacePreferencesChange,
}: AppHeaderProps) {
  const { authStatus, onLoggedOut, onProfileUpdated } = useAuthContext();
  const { latestRun, latestEvent, unreadEventCount, onEventsSeen, onError, onNotice } = useNotificationContext();
  const busy = ingestionBusy || syncBusy;
  const canSync = authStatus.permissions?.includes('ingestion:run') === true;
  const activeDomain = areaOf(workspaceView);
  const presentationRegistration = syncForWorkspace(workspaceView)?.presentation;
  const presentationEnabled = !isHome && !!presentationRegistration?.readPermissions.some(permission => (authStatus.permissions || []).includes(permission));
  const presentation = useToolSyncPresentation(presentationRegistration, presentationEnabled);
  const queryClient = useQueryClient();
  const previousBusy = useRef(busy);
  useEffect(() => {
    if (previousBusy.current && !busy && !isHome && canSync) {
      void queryClient.invalidateQueries({ queryKey: INGESTION_RUNS_QUERY_KEY });
    }
    if (previousBusy.current !== busy && presentationEnabled && presentationRegistration) {
      void queryClient.invalidateQueries({ queryKey: presentationRegistration.queryKey });
    }
    previousBusy.current = busy;
  }, [busy, canSync, isHome, queryClient, presentationEnabled, presentationRegistration]);
  /* Tools without a presentation contract keep their domain run history and
     the router-fed live fallback. Registered presentations own their state. */
  const runsQuery = useQuery({
    queryKey: INGESTION_RUNS_QUERY_KEY,
    enabled: !isHome && canSync,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: ({ signal }) => fetchIngestionRuns(50, signal),
  });
  const domainRun = runsQuery.data?.find((run) => syncDomainForSource(run.source_system) === activeDomain);
  const statusRun = domainRun ?? (latestRun && syncDomainForSource(latestRun.source_system) === activeDomain ? latestRun : null);
  const latestStatus = statusRun?.status;
  const syncState = syncStatusLabel(statusRun, busy, statusRun?.source_system ? syncToolLabel(syncToolForSource(statusRun.source_system)) : undefined);
  const syncLabel = presentation?.text ?? syncState.label;
  return <header className="topbar">
    <div className="topbar-leading">
      <ToolSwitcher
        isHome={isHome}
        workspaceView={workspaceView}
        permissions={authStatus.permissions || []}
        onWorkspaceChange={onWorkspaceChange}
        onHome={onHome}
      />
      {!isHome && <WorkspaceSwitcher
        crossTool={domainHasSectionNav(areaOf(workspaceView))}
        isHome={isHome}
        workspaceView={workspaceView}
        permissions={authStatus.permissions || []}
        onWorkspaceChange={onWorkspaceChange}
        preferences={workspacePreferences}
        onPreferencesChange={onWorkspacePreferencesChange}
      />}
      <button className="brand" type="button" onClick={onHome} aria-label="Ir al inicio de Custodia" title="Ir al inicio de Custodia"><span className="brand-mark"><CustodiaMark /></span><span className="brand-copy"><strong>Custodia</strong></span></button>
      <GlobalSearch includeInternal={includeInternalMetrics} permissions={authStatus.permissions || []} commands={commandCenterCommands} preferences={workspacePreferences} onWorkspaceSelect={onWorkspaceChange} onSelect={onSearchSelect} />
      {!isHome && <div className="topbar-location" role="group" aria-label="Ubicación actual"><span>{WORKSPACE_TOOL_LABELS[workspaceView]}</span>{locationRepeatsTool(WORKSPACE_TOOL_LABELS[workspaceView], workspaceLabels[workspaceView]) ? null : <><ChevronRight size={14} aria-hidden /><strong>{workspaceLabels[workspaceView]}</strong></>}</div>}
    </div>
    <div className="topbar-actions">
      {!isHome && (presentation || canSync) && <div className={'sync-status-control ' + ((presentation ? presentation.running : busy || latestStatus === 'running') ? 'is-running' : '')} role="status" title={presentation?.observedAt ? dateTimeHint(presentation.observedAt) : syncState.title ?? (canSync ? 'El refresco manual está disponible en el menú de usuario' : 'Estado del último intento de sincronización del inventario')}>
        <span className="sync-status-dot" aria-hidden="true" />{syncLabel}
      </div>}
      <NotificationMenu latestRun={latestRun} latestEvent={latestEvent} unreadEventCount={unreadEventCount} onEventsSeen={onEventsSeen} />
      <ProfileMenu
        authStatus={authStatus}
        theme={theme}
        onThemeChange={onThemeChange}
        onRefreshData={onRefreshData}
        refreshSource={isHome ? 'all' : areaOf(workspaceView) === 'dlp' ? 'netskope' : areaOf(workspaceView) === 'pam' ? 'cyberark' : 'all'}
        refreshBusy={busy}
        canSync={canSync}
        onError={onError}
        onNotice={onNotice}
        onNavigate={onWorkspaceChange}
        onLoggedOut={onLoggedOut}
        onProfileUpdated={onProfileUpdated}
      />
    </div>
  </header>;
}
