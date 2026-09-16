import { ChevronRight, RefreshCw } from 'lucide-react';
import { ProfileMenu } from './profile-menu';
import { NotificationMenu } from './notification-menu';
import { WorkspaceSwitcher } from './workspace-switcher';
import { ToolSwitcher } from './tool-switcher';
import { GlobalSearch } from './global-search';
import { useAuthContext } from '../context/auth-context';
import { useNotificationContext } from '../context/notification-context';
import { workspaceViews, type WorkspaceView } from '../lib/workspaces';
import { workspaceLabels } from '../lib/workspace-meta';
import { domainMeta, domainOf } from '../lib/domains';
import { DsHubMark } from './home-workspace';
import type { SearchResult } from '../lib/search-api';
import type { CommandCenterCommand } from '../lib/command-center';
import type { WorkspacePreferences } from '../lib/workspace-preferences-api';

export { workspaceViews };
export type { WorkspaceView } from '../lib/workspaces';

type AppHeaderProps = {
  isHome?: boolean;
  theme: 'dark' | 'light';
  onThemeChange: () => void;
  workspaceView: WorkspaceView;
  onWorkspaceChange: (view: WorkspaceView) => void;
  onHome: () => void;
  previewBusy: boolean;
  ingestionBusy: boolean;
  onStartIngestion: () => void;
  includeInternalMetrics: boolean;
  onIncludeInternalMetricsChange: (value: boolean) => void;
  onSearchSelect: (result: SearchResult) => void;
  commandCenterCommands: CommandCenterCommand[];
  workspacePreferences: WorkspacePreferences;
  onWorkspacePreferencesChange: (next: Partial<Pick<WorkspacePreferences, 'visible_workspaces' | 'hidden_workspaces' | 'recent_workspaces'>>) => Promise<void>;
};

export function AppHeader({
  isHome = false, theme, onThemeChange, workspaceView, onWorkspaceChange, onHome,
  previewBusy, ingestionBusy, onStartIngestion,
  includeInternalMetrics, onIncludeInternalMetricsChange, onSearchSelect, commandCenterCommands, workspacePreferences, onWorkspacePreferencesChange,
}: AppHeaderProps) {
  const { authStatus, onLoggedOut, onProfileUpdated } = useAuthContext();
  const { latestRun, latestEvent, unreadEventCount, onEventsSeen, onError, onNotice } = useNotificationContext();
  const busy = ingestionBusy || previewBusy;
  const canSync = authStatus.permissions?.includes('ingestion:run') === true;
  const currentDomain = domainMeta(domainOf(workspaceView));
  return <header className="topbar">
    <div className="topbar-leading">
      <ToolSwitcher
        isHome={isHome}
        workspaceView={workspaceView}
        permissions={authStatus.permissions || []}
        onWorkspaceChange={onWorkspaceChange}
        onHome={onHome}
      />
      <WorkspaceSwitcher
        isHome={isHome}
        workspaceView={workspaceView}
        permissions={authStatus.permissions || []}
        onWorkspaceChange={onWorkspaceChange}
        preferences={workspacePreferences}
        onPreferencesChange={onWorkspacePreferencesChange}
      />
      <button className="brand" type="button" onClick={onHome} aria-label="Ir al inicio de DS Hub" title="Ir al inicio de DS Hub"><span className="brand-mark"><DsHubMark /></span><span className="brand-copy"><strong>DS Hub</strong><small>CyberArk PAM</small></span></button>
      <GlobalSearch includeInternal={includeInternalMetrics} permissions={authStatus.permissions || []} commands={commandCenterCommands} onSelect={onSearchSelect} />
      {!isHome && <div className="topbar-location" aria-label="Ubicación actual"><span>{currentDomain.label}</span><ChevronRight size={14} aria-hidden /><strong>{workspaceLabels[workspaceView]}</strong></div>}
    </div>
    <div className="topbar-actions">
      {!isHome && canSync && <button
        className="button primary"
        type="button"
        disabled={busy}
        title={busy ? (previewBusy ? 'Comparando...' : 'Sincronizando...') : 'Comparar Safes y, al confirmar, sincronizar también catálogos técnicos PAM, Identity Administration, SIA y Access space'}
        onClick={onStartIngestion}
      >
        <RefreshCw size={15} /> {busy ? (previewBusy ? 'Comparando...' : 'Sincronizando...') : 'Sincronizar datos'}
      </button>}
      <NotificationMenu latestRun={latestRun} latestEvent={latestEvent} unreadEventCount={unreadEventCount} onEventsSeen={onEventsSeen} />
      <ProfileMenu
        authStatus={authStatus}
        theme={theme}
        onThemeChange={onThemeChange}
        showInternalScope={!isHome}
        includeInternalMetrics={includeInternalMetrics}
        onIncludeInternalMetricsChange={onIncludeInternalMetricsChange}
        onError={onError}
        onNotice={onNotice}
        onLoggedOut={onLoggedOut}
        onProfileUpdated={onProfileUpdated}
      />
    </div>
  </header>;
}
