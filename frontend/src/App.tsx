/**
 * Compone la sesión, navegación, preferencias y sincronización de la aplicación.
 * Delega los workspaces al router registrado y pasa su contexto explícitamente.
 * Las consultas y pantallas de cada herramienta pertenecen a su propio módulo.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AuthProvider } from './cross/context/auth-context';
import { NotificationProvider } from './cross/context/notification-context';
import { useAuth } from './cross/hooks/use-auth';
import { AppHeader } from './cross/components/app-header';
import { AuthView } from './cross/components/auth-view';
import { useIngestion } from './cross/hooks/use-ingestion';
import { WorkspaceIntro } from './cross/components/workspace-intro';
import { StaleDataBanner } from './cross/components/stale-data-banner';
import { useSyncFreshness } from './cross/hooks/use-sync-freshness';
import { staleTasksForSources } from './cross/lib/sync-freshness';
import { HomeWorkspace } from './cross/components/home-workspace';
import { usePresence } from './cross/hooks/use-presence';
import { AppNotifications, TOAST_EXIT_MS } from './cross/components/app-notifications';
import { SyncToast } from './cross/components/sync-toast';
import { canonicalRecentWorkspace, firstAuthorizedSiaResourceWorkspace, hasWorkspaceAccess } from './cross/lib/workspaces';
import { firstAccessibleDomainWorkspace } from './cross/lib/domains';
import { CATALOG_BY_ID } from './cross/lib/workspace-catalog';
import { areaOf, domainOf } from './cross/lib/domains';
import { workspaceLabels } from './cross/lib/workspace-meta';
import { WORKSPACE_DESCRIPTIONS } from './cross/lib/workspace-registry';

import { RegisteredWorkspaceRouter } from './cross/routers/registered-workspace-router';
import { REGISTERED_RUNTIMES, manualSyncForArea } from './sources.ts';
import { useWorkspaceRoute } from './cross/hooks/use-workspace-route';
import { useWorkspaceTransition } from './cross/hooks/use-workspace-transition';
import { useTheme } from './cross/hooks/use-theme';
import { useActivityEvents } from './cross/hooks/use-activity-events';
import { useWorkspacePreferences } from './cross/hooks/use-workspace-preferences';
import { guideCommands, navigationCommands, type CommandCenterCommand } from './cross/lib/command-center';
import type { SearchResult } from './cross/lib/search-api';
import { selectSearchResult } from './cyberark/pam/lib/widget-navigation';
import { fetchIngestionRun } from './cross/lib/ingestion-api';
import { automaticSyncBatchNotice, refreshKeyForVisibleWorkspace, refreshVisibleWorkspaceForSources, syncSourceForArea } from './cross/lib/sync-source';
import type { ActivityEvent } from './cross/lib/activity-events-api';
import type { IngestionRun } from './cross/types/ingestion';

import type { WorkspaceView } from './cross/lib/workspaces';
import './App.css';

// Stable fallback: a fresh `[]` each render would recreate `hasAccess` and re-run its effects.
const NO_PERMISSIONS: string[] = [];


export function App() {
  const queryClient = useQueryClient();
  const { theme, toggleTheme } = useTheme();
  const { workspaceView, navigateWorkspace, navigateHome, isHome } = useWorkspaceRoute();
  const workspaceTransitionClass = useWorkspaceTransition(workspaceView);
  const workspaceViewRef = useRef(workspaceView);
  workspaceViewRef.current = workspaceView;
  const [error, setError] = useState('');
  const [notice, setNoticeText] = useState('');
  const [noticeSource, setNoticeSource] = useState<string | null>(null);
  /* A notice raised by a CyberArk or Netskope workspace carries that tool's logo even when its text names none;
     Custodia-level notices (account, activity, administration) keep the neutral mark. */
  const areaSourceRef = useRef<string | null>(null);
  areaSourceRef.current = isHome ? null : syncSourceForArea(areaOf(workspaceView));
  const setNotice = useCallback((message: string) => { setNoticeSource(null); setNoticeText(message); }, []);
  const setWorkspaceNotice = useCallback((message: string) => { setNoticeSource(message ? areaSourceRef.current : null); setNoticeText(message); }, []);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [catalogOpenRequest, setCatalogOpenRequest] = useState(0);
  /* DOCS-PORTAL-001: the section Command-K asked the guide to open; the
     workspace restores it from the URL on deep links too. */
  const [guideSection, setGuideSection] = useState<string | null>(null);
  const [latestRun, setLatestRun] = useState<IngestionRun | null>(null);
  const [domainRefreshKeys, setDomainRefreshKeys] = useState<Record<string, number>>(() => Object.fromEntries(REGISTERED_RUNTIMES.flatMap((runtime) => runtime.refreshDomain ? [[runtime.refreshDomain, 0]] : [])));
  /* The "Incluir internos" switch was removed from the user menu: the scope is fixed to the
     historical default (internal Safes included) and any stored preference is ignored. */
  const includeInternalMetrics = true;

  const auth = useAuth({ onError: setError, onNotice: setNotice, onSessionExpired: navigateHome });
  const {
    authStatus, setAuthStatus, authChecked,
  } = auth;
  const isAuthenticated = Boolean(authStatus?.authenticated);
  const actorId = authStatus?.user?.actor_id ?? null;
  const previousActorId = useRef<string | null>(actorId);
  useLayoutEffect(() => {
    if (previousActorId.current === actorId) return;
    // Query data belongs to an authenticated operator. Do not let a new
    // session reuse cached inventory, even briefly, from the prior account.
    // Clear before query subscriptions start, so authentication does not
    // cancel the first reads and force every observer to request them again.
    queryClient.clear();
    previousActorId.current = actorId;
  }, [actorId, queryClient]);
  const actorPermissions = authStatus?.permissions ?? NO_PERMISSIONS;
  const syncSchedules = useSyncFreshness(isAuthenticated);
  const staleTasks = staleTasksForSources(syncSchedules, CATALOG_BY_ID[workspaceView]?.refreshSources);
  const hasAccess = useCallback((view: WorkspaceView) => hasWorkspaceAccess(view, actorPermissions), [actorPermissions]);

  const handleLoggedOut = useCallback(() => {
    navigateHome();
    setAuthStatus((current) => current ? { ...current, authenticated: false, user: null } : current);
  }, [navigateHome, setAuthStatus]);

  const onUnauthorized = useCallback(
    () => {
      navigateHome();
      setAuthStatus((current) => current ? { ...current, authenticated: false, user: null } : current);
    },
    [navigateHome, setAuthStatus],
  );
  const handleProfileUpdated = useCallback((name: string) => {
    setAuthStatus((current) => current ? { ...current, user: current.user ? { ...current.user, name } : current.user } : current);
  }, [setAuthStatus]);
  const {
    preferences: workspacePreferences, loading: workspacePreferencesLoading,
    save: saveWorkspacePreferences, recordRecent,
  } = useWorkspacePreferences({
    authenticated: isAuthenticated,
    actorId: authStatus?.user?.actor_id,
    onUnauthorized,
    onError: setError,
  });
  useEffect(() => {
    if (isAuthenticated && !workspacePreferencesLoading && workspaceView !== 'general') recordRecent(canonicalRecentWorkspace(workspaceView));
  }, [isAuthenticated, recordRecent, workspacePreferencesLoading, workspaceView]);
  const dashboardLoadRef = useRef<(options?: { refreshStatic?: boolean }) => Promise<void>>(async () => {});
  const setPamDashboardLoad = useCallback((load: ((options?: { refreshStatic?: boolean }) => Promise<void>) | null) => {
    dashboardLoadRef.current = load || (async () => {});
  }, []);
  const { syncBusy, ingestionBusy, syncToast, syncElapsedSeconds, formatElapsed, requestRefresh, requestSourceRefresh } = useIngestion({
    loadDashboard: (options) => dashboardLoadRef.current(options),
    onError: setError,
    onCompleted: (domain) => setDomainRefreshKeys((current) => ({ ...current, [domain]: current[domain] + 1 })),
  });
  const manualSync = manualSyncForArea(isHome ? 'admin' : areaOf(workspaceView));
  const refreshCurrentTool = () => manualSync.kind === 'direct'
    ? requestSourceRefresh(manualSync)
    : requestRefresh(manualSync.scope);
  const syncToastPresence = usePresence(syncToast, TOAST_EXIT_MS);
  const handleExternalEvents = useCallback(async (events: ActivityEvent[]) => {
    const latest = events[events.length - 1];
    const automaticSyncEvents = events.filter((event) => event.actor_id === 'system:scheduler' && event.kind === 'sync');
    const latestAutomaticSync = automaticSyncEvents[automaticSyncEvents.length - 1];
    if (latestAutomaticSync) {
      const runIds = [...new Set(automaticSyncEvents.map((event) => event.run_id).filter((runId): runId is string => Boolean(runId)))];
      const runs = (await Promise.all(runIds.map((runId) => fetchIngestionRun(runId).catch(() => null)))).filter((run): run is IngestionRun => Boolean(run));
      const fallbackRuns = runs.length ? runs : (latestAutomaticSync.source_system ? [{ source_system: latestAutomaticSync.source_system, status: 'completed' } as IngestionRun] : []);
      // Do not show a generic Custodia toast when the event has no source and
      // its run cannot be loaded. It has no useful identity or result, and
      // was the source of the logo-less "Sincronización automática finalizada"
      // notification. The activity menu still retains the event.
      const notice = automaticSyncBatchNotice(fallbackRuns);
      if (notice) setNotice(notice);
      const eventSources = automaticSyncEvents.map((event) => event.source_system);
      const activeDomain = refreshVisibleWorkspaceForSources(workspaceViewRef.current, eventSources)
        ? refreshKeyForVisibleWorkspace(workspaceViewRef.current, eventSources)
        : null;
      if (activeDomain) {
        setDomainRefreshKeys((current) => ({ ...current, [activeDomain]: current[activeDomain] + 1 }));
      }
    } else {
      const isScheduler = latest.actor_id === 'system:scheduler';
      setNotice(isScheduler ? 'Nueva actividad automática registrada' : `Nueva actividad registrada por ${latest.actor_name}`);
      // Non-sync events (classification, catalog changes) carry no source to
      // scope by, so the visible PAM dashboard still reloads its static data.
      if (domainOf(workspaceViewRef.current) === 'pam') await dashboardLoadRef.current({ refreshStatic: true });
    }
  }, [setNotice]);
  const { unreadCount, latestEvent, markEventsSeen } = useActivityEvents({
    authenticated: isAuthenticated,
    currentActorId: authStatus?.user?.actor_id,
    onExternalEvents: handleExternalEvents,
  });

  useEffect(() => {
    if (!authChecked || !isAuthenticated || hasAccess(workspaceView)) return;
    if (domainOf(workspaceView) === 'dlp') {
      const fallback = firstAccessibleDomainWorkspace('dlp', actorPermissions);
      setNotice('No tenés acceso a esta vista. Te llevamos a una sección de Netskope disponible para tu perfil.');
      navigateWorkspace(fallback ?? 'general', { replace: true });
      return;
    }
    if (workspaceView === 'identityFederations' && hasAccess('identity')) {
      navigateWorkspace('identity', { replace: true });
      return;
    }
    if (workspaceView === 'siaResources' || workspaceView === 'siaDatabaseAccounts') {
      const fallback = firstAuthorizedSiaResourceWorkspace(actorPermissions);
      if (fallback) {
        navigateWorkspace(fallback, { replace: true });
        return;
      }
      if (hasAccess('sia')) {
        navigateWorkspace('sia', { replace: true });
        return;
      }
    }
    navigateWorkspace('general', { replace: true });
  }, [actorPermissions, authChecked, hasAccess, isAuthenticated, navigateWorkspace, setNotice, workspaceView]);



  // IF-019: memoized above the `!authStatus` early return below (not after
  // it, where these used to sit as plain object literals) -- React hooks
  // must run in the same order on every render, and a plain conditional
  // return between the component's other hooks and these two would have
  // called useMemo zero times while auth is still loading and once it
  // finishes checking, tripping "Rendered fewer hooks than expected"
  // (verified: this exact bug reached a real browser as React error #310
  // during manual testing of this change). authStatus is asserted non-null
  // here because this value is only ever actually consumed by <AuthProvider>
  // after the early return below has already confirmed it.
  const authContextValue = useMemo(() => ({ authStatus: authStatus!, onLoggedOut: handleLoggedOut, onProfileUpdated: handleProfileUpdated }), [authStatus, handleLoggedOut, handleProfileUpdated]);
  const notificationContextValue = useMemo(() => ({
    latestRun: latestRun || null, latestEvent, unreadEventCount: unreadCount, onEventsSeen: markEventsSeen, onError: setError, onNotice: setNotice,
  }), [latestRun, latestEvent, unreadCount, markEventsSeen, setNotice]);

  if (!authChecked || !authStatus || auth.authError || !authStatus.authenticated || authStatus.user?.must_change_password) {
    return <AuthView auth={auth} error={error} />;
  }
  const selectWorkspace = (view: WorkspaceView) => {
    const canonicalView = view === 'siaConnectors' ? 'connectors' : view;
    if (!hasAccess(canonicalView)) return;
    navigateWorkspace(canonicalView);
    setError('');
    setNotice('');
  };

  const handleSearchResult = (result: SearchResult) => {
    setError('');
    setNotice('');
    const navigation = selectSearchResult(result);
    selectWorkspace(navigation.workspace);
    setSearchResult(domainOf(navigation.workspace) === 'pam' ? result : null);
  };

  /* UX-SEARCH-001: navigable commands derive from the workspace catalog and
     its explicit Command-K metadata; only the imperative actions stay here,
     each with the same kind/platform metadata so filters and ranking apply.
     Widget commands are loaded lazily by GlobalSearch itself (bundle-size
     follow-up): the PAM/Netskope widget catalogs never need to be in the
     entry bundle just because the command center might search them.
     DOCS-PORTAL-001: guide sections come from the editorial index and open
     the help workspace at their stable section deep link. */
  const commandCenterCommands: CommandCenterCommand[] = [
    ...navigationCommands(actorPermissions),
    ...guideCommands().map((command) => ({
      ...command,
      run: () => { setGuideSection(command.sectionId ?? null); navigateWorkspace('help'); },
    })),
    {
      id: 'action-sync', kind: 'action', platform: 'custodia',
      label: manualSync.label,
      detail: manualSync.detail,
      aliases: ['sync', 'sincronizar', 'ingesta', 'datos', 'actualizar'], priority: 40,
      permission: 'ingestion:run', run: () => void refreshCurrentTool(),
    },
    {
      id: 'action-catalogs', kind: 'action', platform: 'cyberark',
      label: 'Administrar catálogos', detail: 'Unidades y responsables operativos',
      aliases: ['catalogos', 'unidades', 'responsables'], priority: 41,
      permission: 'catalogs:manage',
      run: () => { selectWorkspace('safes'); setCatalogOpenRequest((current) => current + 1); },
    },
  ];

  if (isHome) return <div className="app-shell"><AuthProvider value={authContextValue}><NotificationProvider value={notificationContextValue}><AppHeader
    isHome
    theme={theme} onThemeChange={toggleTheme} workspaceView={workspaceView} onWorkspaceChange={selectWorkspace}
    onHome={navigateHome}
    syncBusy={syncBusy} ingestionBusy={ingestionBusy}
    onRefreshData={() => void refreshCurrentTool()}
    includeInternalMetrics={includeInternalMetrics}
      onSearchSelect={handleSearchResult}
    commandCenterCommands={commandCenterCommands}
    workspacePreferences={workspacePreferences}
    onWorkspacePreferencesChange={saveWorkspacePreferences}
  /></NotificationProvider></AuthProvider><HomeWorkspace authStatus={authStatus} onNavigate={selectWorkspace} />
    {syncToastPresence.current && <SyncToast state={syncToastPresence.current} leaving={syncToastPresence.leaving} elapsedSeconds={syncElapsedSeconds} formatElapsed={formatElapsed} onOpenActivity={() => navigateWorkspace('activity')} />}
  </div>;

  return <div className="app-shell">
    <AuthProvider value={authContextValue}><NotificationProvider value={notificationContextValue}><AppHeader
      theme={theme}
      onThemeChange={toggleTheme}
      workspaceView={workspaceView}
      onWorkspaceChange={selectWorkspace}
      onHome={navigateHome}
      syncBusy={syncBusy}
      ingestionBusy={ingestionBusy}
      onRefreshData={() => void refreshCurrentTool()}
      includeInternalMetrics={includeInternalMetrics}
      onSearchSelect={handleSearchResult}
      commandCenterCommands={commandCenterCommands}
      workspacePreferences={workspacePreferences}
      onWorkspacePreferencesChange={saveWorkspacePreferences}
    /></NotificationProvider></AuthProvider>
    <main className="workspace-shell">
      <div className={'workspace-content' + workspaceTransitionClass}>
        <WorkspaceIntro
          key={workspaceView}
          title={workspaceLabels[workspaceView]}
          description={WORKSPACE_DESCRIPTIONS[workspaceView]}
          help={CATALOG_BY_ID[workspaceView].introHelp}
          latestRun={latestRun || null}
          showRunSummary={workspaceView === 'safes'}
        />
        <StaleDataBanner tasks={staleTasks} onOpenActivity={workspaceView === 'activity' ? undefined : () => navigateWorkspace('activity')} />
        <AppNotifications error={error} notice={notice} noticeSource={noticeSource} onDismissError={() => setError('')} onDismissNotice={() => setNotice('')} />

        <RegisteredWorkspaceRouter
          workspaceView={workspaceView}
          refreshKey={domainRefreshKeys[domainOf(workspaceView)] ?? 0}
          authChecked={authChecked}
          authenticated={isAuthenticated}
          authStatus={authStatus}
          permissions={actorPermissions}
          includeInternal={includeInternalMetrics}
          searchResult={searchResult}
          onSearchHandled={() => setSearchResult(null)}
          catalogOpenRequest={catalogOpenRequest}
          onNavigate={selectWorkspace}
          onUnauthorized={onUnauthorized}
          onError={setError}
          onNotice={setWorkspaceNotice}
          onDashboardLoad={setPamDashboardLoad}
          onLatestRun={setLatestRun}
          authMode={authStatus?.mode}
          currentActorId={authStatus?.user?.actor_id}
          currentUserEmail={authStatus?.user?.email}
          apiDocsEnabled={authStatus?.api_docs_enabled === true}
          guideSection={guideSection}
        />
      </div>
    </main>
    {syncToastPresence.current && <SyncToast state={syncToastPresence.current} leaving={syncToastPresence.leaving} elapsedSeconds={syncElapsedSeconds} formatElapsed={formatElapsed} onOpenActivity={() => navigateWorkspace('activity')} />}
  </div>;
}
