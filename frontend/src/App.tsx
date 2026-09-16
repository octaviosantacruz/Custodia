import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { SafeDetailDrawer } from './components/safe-detail-drawer';
import { AuthProvider } from './context/auth-context';
import { NotificationProvider } from './context/notification-context';
import { StateBlock } from './components/state-block';
import { useAuth } from './hooks/use-auth';
import { AppHeader } from './components/app-header';
import { AuthView } from './components/auth-view';
import { useDashboard } from './hooks/use-dashboard';
import { useIngestion } from './hooks/use-ingestion';
import { useSafeActions } from './hooks/use-safe-actions';
import { useCatalogForm } from './hooks/use-catalog-form';
import { SafesWorkspace } from './components/safes-workspace';
import { PamInfraSubnav } from './components/pam-infra-subnav';
import { GeneralWorkspace } from './components/general-workspace';
import { CatalogModal } from './components/catalog-modal';
import { WorkspaceIntro } from './components/workspace-intro';
import { HomeWorkspace } from './components/home-workspace';
import { AppNotifications } from './components/app-notifications';
import { SyncToast } from './components/sync-toast';
import { useSafeTableConfig } from './hooks/use-safe-table-config';
import { useSafeFilters } from './hooks/use-safe-filters';
import { nextActionOptions } from './lib/format';
import { canonicalRecentWorkspace, firstAuthorizedSiaResourceWorkspace, hasWorkspaceAccess } from './lib/workspaces';
import { workspaceLabels } from './lib/workspace-meta';
import { SyncPreview } from './components/sync-preview';

/* Route-based code splitting: every workspace below is only rendered once
   the operator navigates to it (or, for the access:manage-gated ones, only
   if they even hold that permission), so none of them belongs in the
   initial bundle. GeneralWorkspace and SafesWorkspace stay eager -- they're
   the default landing view and the most-visited one, so lazy-loading them
   would trade a flash-of-fallback on first paint for a bundle win nobody
   would notice. */
const UsersWorkspace = lazy(() => import('./components/users-workspace').then((m) => ({ default: m.UsersWorkspace })));
const ActivityWorkspace = lazy(() => import('./components/activity-workspace').then((m) => ({ default: m.ActivityWorkspace })));
const SiaHubWorkspace = lazy(() => import('./components/sia-hub-workspace').then((m) => ({ default: m.SiaHubWorkspace })));
const IdentityWorkspace = lazy(() => import('./components/identity-workspace').then((m) => ({ default: m.IdentityWorkspace })));
const PamChainWorkspace = lazy(() => import('./components/pam-chain-workspace').then((m) => ({ default: m.PamChainWorkspace })));
const PamPlatformsWorkspace = lazy(() => import('./components/pam-platforms-workspace').then((m) => ({ default: m.PamPlatformsWorkspace })));
const PamConnectorsWorkspace = lazy(() => import('./components/pam-platforms-workspace').then((m) => ({ default: m.PamConnectorsWorkspace })));
const PamSystemHealthWorkspace = lazy(() => import('./components/pam-system-health').then((m) => ({ default: m.PamSystemHealthWorkspace })));
const PamAimApplicationsWorkspace = lazy(() => import('./components/pam-aim-applications').then((m) => ({ default: m.PamAimApplicationsWorkspace })));
const PostureWorkspace = lazy(() => import('./components/posture-workspace').then((m) => ({ default: m.PostureWorkspace })));
const NetskopeWorkspace = lazy(() => import('./components/netskope-workspace').then((m) => ({ default: m.NetskopeWorkspace })));
import { useWorkspaceRoute } from './hooks/use-workspace-route';
import { useTheme } from './hooks/use-theme';
import { useActivityEvents } from './hooks/use-activity-events';
import { useWorkspacePreferences } from './hooks/use-workspace-preferences';
import type { CommandCenterCommand } from './lib/command-center';
import type { ConnectionCoverageFilter } from './types/connection';
import type { SearchResult } from './lib/search-api';
import { navigateFromWidget, selectSearchResult } from './lib/widget-navigation';

const PAGE_SIZE = 50;
import type { WorkspaceView } from './lib/workspaces';


export function App() {
  const { theme, toggleTheme } = useTheme();
  const { workspaceView, navigateWorkspace, navigateHome, isHome } = useWorkspaceRoute();
  const {
    search, workflowFilter, classificationFilter, accountTypeFilter, inventoryScopeFilter,
    qualityFilter, scopeHintFilter, healthFilter, nextActionFilter, businessUnitFilter,
    responsibleFilter, accountPlatformStatus, page, setSearch, setWorkflowFilter,
    setClassificationFilter, setAccountTypeFilter, setInventoryScopeFilter, setQualityFilter,
    setScopeHintFilter, setHealthFilter, setNextActionFilter, setBusinessUnitFilter,
    setResponsibleFilter, setAccountPlatformStatus, setPage, apply: applySafeFilters, reset: resetSafeFilters,
  } = useSafeFilters();
  const [siaSeed, setSiaSeed] = useState('');
  const [identitySeed, setIdentitySeed] = useState('');
  const [identitySectionSeed, setIdentitySectionSeed] = useState<'users' | 'cyberarkRoles'>('users');
  const [pamGraphSeed, setPamGraphSeed] = useState('');
  const [pamRoleSeed, setPamRoleSeed] = useState('');
  const [pamPlatformSeed, setPamPlatformSeed] = useState('');
  const [pamConnectorSeed, setPamConnectorSeed] = useState('');
  const [assetsSeed, setAssetsSeed] = useState<{ search: string; environment: string; coverage: ConnectionCoverageFilter | '' }>({ search: '', environment: '', coverage: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [catalogManagerOpen, setCatalogManagerOpen] = useState(false);
  const [workspaceRefreshKey, setWorkspaceRefreshKey] = useState(0);
  const [includeInternalMetrics, setIncludeInternalMetrics] = useState(() => {
    try { return window.localStorage.getItem('dshub.include-internal-metrics') !== 'false'; } catch { return true; }
  });
  const changeInternalMetricScope = useCallback((value: boolean) => {
    setIncludeInternalMetrics(value);
    try { window.localStorage.setItem('dshub.include-internal-metrics', String(value)); } catch { /* storage unavailable */ }
  }, []);

  const auth = useAuth({ onError: setError, onNotice: setNotice, onSessionExpired: navigateHome });
  const {
    authStatus, setAuthStatus, authChecked,
  } = auth;
  const isAuthenticated = Boolean(authStatus?.authenticated);
  const actorPermissions = authStatus?.permissions ?? [];
  const canManageAccess = actorPermissions.includes('access:manage');
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
  const { summary, catalogs, analytics, accountPlatformCoverage, safes, safeTotal, loading, setSafes, loadDashboard } = useDashboard({
    authChecked, authStatus, search, workflowFilter, classificationFilter, accountTypeFilter,
    inventoryScopeFilter, qualityFilter, scopeHintFilter, healthFilter, nextActionFilter, businessUnitFilter, responsibleFilter, page,
    loadFiltered: workspaceView === 'safes',
    includeInternal: includeInternalMetrics,
    onUnauthorized,
    onError: setError,
  });
  const { syncPreview, setSyncPreview, previewBusy, ingestionBusy, syncToast, setSyncToast, syncElapsedSeconds, formatElapsed, applyIngestion, startIngestion } = useIngestion({
    loadDashboard,
    onError: setError,
    onNotice: setNotice,
    onCompleted: () => setWorkspaceRefreshKey((current) => current + 1),
  });
  const { detail, setDetail, form, setForm, saving, savingSafeNumber, savedSafeNumber, selectSafe, exportSafes, exportAccounts, quickUpdate, saveAssignment, bulkSaveAssignment, saveMetadata } = useSafeActions({
    catalogs, search, workflowFilter, classificationFilter, accountTypeFilter, inventoryScopeFilter,
    qualityFilter, scopeHintFilter, healthFilter, nextActionFilter, businessUnitFilter, responsibleFilter, accountPlatformStatus, setSafes, loadDashboard, onError: setError, onNotice: setNotice,
  });
  const { catalogModal, setCatalogModal, catalogDraft, setCatalogDraft, catalogBusy, openCatalogModal, saveCatalogEntry } = useCatalogForm({ loadDashboard, onError: setError, onNotice: setNotice });
  const handleExternalEvents = useCallback((events: { actor_name: string }[]) => {
    const latest = events[events.length - 1];
    setNotice(`Datos actualizados por ${latest.actor_name}`);
    void loadDashboard({ refreshStatic: true });
    setWorkspaceRefreshKey((current) => current + 1);
  }, [loadDashboard]);
  const { unreadCount, latestEvent, markEventsSeen } = useActivityEvents({
    authenticated: isAuthenticated,
    currentActorId: authStatus?.user?.actor_id,
    onExternalEvents: handleExternalEvents,
  });



  useEffect(() => {
    if (!authChecked || !isAuthenticated || hasAccess(workspaceView)) return;
    // IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §6: a direct link to
    // Federaciones without identity:catalogs_read/access:manage should
    // land the actor on the first authorized Identidades tab, not bounce
    // them out of Identidades entirely -- they may well have plain
    // Usuarios/Grupos/Roles access (those never require access:manage).
    if (workspaceView === 'identityFederations' && hasAccess('identity')) {
      navigateWorkspace('identity', { replace: true });
      return;
    }
    // Same rule for the SIA hub's Recursos sub-views: a direct link to a
    // specific resource kind the actor can't see (each keeps its own
    // narrow permission -- §6) lands them on whichever *other* resource
    // kind they do hold (if any), not unconditionally on Políticas.
    if (workspaceView === 'siaResources' || workspaceView === 'siaDatabaseAccounts' || workspaceView === 'accessAssets') {
      const permissions = authStatus?.permissions || [];
      const fallbackResourceView = firstAuthorizedSiaResourceWorkspace(permissions);
      if (fallbackResourceView) {
        navigateWorkspace(fallbackResourceView, { replace: true });
        return;
      }
      if (hasAccess('sia')) {
        navigateWorkspace('sia', { replace: true });
        return;
      }
    }
    navigateWorkspace('general', { replace: true });
  }, [authChecked, authStatus, hasAccess, isAuthenticated, navigateWorkspace, workspaceView]);


  const safeTableProps = useSafeTableConfig({
    safes, loading, total: safeTotal, page, pageSize: PAGE_SIZE, search, workflowFilter,
    classificationFilter, accountTypeFilter, inventoryScopeFilter, qualityFilter, scopeHintFilter, healthFilter, nextActionFilter, businessUnitFilter, responsibleFilter,
    analytics, catalogs, savingSafeNumber, savedSafeNumber, selectedSafeNumber: detail?.safe.safe_number || null,
    selectSafe, setSearch, setPage, setWorkflowFilter, setClassificationFilter,
    setAccountTypeFilter, setInventoryScopeFilter, setQualityFilter, setScopeHintFilter, setHealthFilter, setNextActionFilter, setBusinessUnitFilter, setResponsibleFilter, accountPlatformStatus, setAccountPlatformStatus,
    quickUpdate, saveAssignment, bulkSaveAssignment, openCatalogModal,
    canExport: Boolean(authStatus?.permissions?.includes('inventory:export')), exportSafes, exportAccounts,
    canManage: Boolean(authStatus?.permissions?.includes('safes:classify')), onError: setError,
    setSafes,
    onNotice: setNotice,
  });


  const latestRun = summary?.latest_run;
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
  }), [latestRun, latestEvent, unreadCount, markEventsSeen]);

  if (!authChecked || !authStatus || auth.authError || !authStatus.authenticated || authStatus.user?.must_change_password) {
    return <AuthView auth={auth} error={error} />;
  }
  const selectWorkspace = (view: WorkspaceView, options: { preserveAssetsSeed?: boolean } = {}) => {
    const canonicalView = view === 'siaConnectors' ? 'connectors' : view;
    if (!hasAccess(canonicalView)) return;
    navigateWorkspace(canonicalView);
    setError('');
    setNotice('');
    setDetail(null);
    setCatalogManagerOpen(false);
    if (canonicalView === 'safes') setPage(0);
    if (canonicalView === 'assets' && !options.preserveAssetsSeed) setAssetsSeed({ search: '', environment: '', coverage: '' });
  };

  // Cross-domain jump from the Identity drawer: seed the target workspace's
  // search, then navigate. No data join — the match is by name only.
  const navigateFromIdentity = (view: WorkspaceView, query?: string) => {
    if (view === 'safes' && query !== undefined) setSearch(query);
    if (view === 'sia' && query !== undefined) setSiaSeed(query);
    if (view === 'platforms' && query !== undefined) setPamPlatformSeed(query);
    if (view === 'connectors' && query !== undefined) setPamConnectorSeed(query);
    if ((view === 'identity' || view === 'identityUsers' || view === 'identityGroups' || view === 'identityRoles') && query !== undefined) setIdentitySeed(query);
    if (view === 'roles' && query !== undefined) setPamRoleSeed(query);
    selectWorkspace(view);
  };

  const handleSearchResult = (result: SearchResult) => {
    setError('');
    setNotice('');
    const navigation = selectSearchResult(result);
    if (navigation.workspace === 'safes') {
      resetSafeFilters();
      applySafeFilters(navigation.filters);
    } else if (navigation.workspace === 'sia') setSiaSeed(navigation.query);
    else if (navigation.workspace === 'graph') setPamGraphSeed(navigation.query);
    else if (navigation.workspace === 'roles') setPamRoleSeed(navigation.query);
    else if (navigation.workspace === 'identity') {
      setIdentitySectionSeed(navigation.identitySection === 'roles' ? 'cyberarkRoles' : 'users');
      setIdentitySeed(navigation.query);
    } else if (navigation.workspace === 'assets') {
      setAssetsSeed(navigation.assetsSeed);
      selectWorkspace(navigation.workspace, { preserveAssetsSeed: true });
      return;
    }
    selectWorkspace(navigation.workspace);
  };

  const commandCenterCommands: CommandCenterCommand[] = [
    ...workspacePreferences.recent_workspaces
      .filter((view) => hasAccess(view))
      .map((view) => ({ id: `recent-${view}`, group: 'recent' as const, label: workspaceLabels[view], detail: 'Abierto recientemente', keywords: [view], workspace: view, run: () => selectWorkspace(view) })),
    { id: 'tool-metrics', group: 'tools', label: 'Abrir Métricas', detail: 'Cobertura y decisiones pendientes', keywords: ['inicio', 'dashboard'], permission: 'inventory:read', workspace: 'general' as const, run: () => selectWorkspace('general') },
    { id: 'tool-safes', group: 'tools', label: 'Abrir Safes', detail: 'Inventario y clasificación de Safes', keywords: ['inventario', 'pam', 'safe'], permission: 'inventory:read', workspace: 'safes' as const, run: () => selectWorkspace('safes') },
    { id: 'tool-posture', group: 'tools', label: 'Abrir Postura', detail: 'Hallazgos y evidencia accionable', keywords: ['findings', 'riesgo'], permission: 'inventory:read', workspace: 'posture' as const, run: () => selectWorkspace('posture') },
    { id: 'tool-chains', group: 'tools', label: 'Abrir Cadenas', detail: 'Explorador visual de acceso PAM', keywords: ['pam', 'roles', 'acceso', 'grafo'], permission: 'access:manage', workspace: 'graph' as const, run: () => selectWorkspace('graph') },
    { id: 'tool-platforms', group: 'tools', label: 'Abrir Plataformas', detail: 'Safes y cuentas por plataforma PAM', keywords: ['pam', 'plataformas', 'cuentas'], permission: ['access:manage', 'pam:catalogs_read'], workspace: 'platforms' as const, run: () => selectWorkspace('platforms') },
    { id: 'tool-connectors', group: 'tools', label: 'Abrir Conectores PSM y SIA', detail: 'Inventarios PSM y SIA en un único workspace', keywords: ['pam', 'psm', 'sia', 'conectores'], permission: ['access:manage', 'pam:catalogs_read'], workspace: 'connectors' as const, run: () => selectWorkspace('connectors') },
    { id: 'tool-pam-roles', group: 'tools', label: 'Abrir Roles CyberArk', detail: 'Roles nativos y su alcance', keywords: ['pam', 'grupos'], permission: 'inventory:read', workspace: 'roles' as const, run: () => selectWorkspace('roles') },
    { id: 'tool-sia', group: 'tools', label: 'Abrir SIA', detail: 'Políticas, recursos y cobertura de Secure Infrastructure Access', keywords: ['políticas', 'access policy', 'ip', 'activos', 'conexiones', 'coverage', 'recursos', 'vm', 'strong accounts', 'base de datos', 'access', 'assets'], permission: 'inventory:read', workspace: 'sia' as const, run: () => selectWorkspace('sia') },
    { id: 'tool-identity', group: 'tools', label: 'Abrir Identidades', detail: 'Directorio, grupos, roles y federaciones de Identity Administration', keywords: ['usuarios', 'roles', 'scim', 'grupos', 'federaciones', 'saml', 'sso', 'okta'], permission: 'inventory:read', workspace: 'identity' as const, run: () => selectWorkspace('identity') },
    { id: 'tool-access', group: 'tools', label: 'Administrar acceso', detail: 'Personas, roles y permisos de DS Hub', keywords: ['usuarios', 'roles custom', 'permisos'], permission: 'access:manage', workspace: 'users' as const, run: () => selectWorkspace('users') },
    { id: 'tool-activity', group: 'tools', label: 'Abrir Actividad', detail: 'Bitácora administrativa', keywords: ['auditoría', 'cambios'], permission: 'access:manage', workspace: 'activity' as const, run: () => selectWorkspace('activity') },
    { id: 'tool-pam-health', group: 'tools', label: 'Abrir Salud PAM', detail: 'Conectividad de Portal, CPM y PSM', keywords: ['salud', 'componentes', 'conectividad'], permission: ['access:manage', 'pam:catalogs_read'], workspace: 'pamHealth' as const, run: () => selectWorkspace('pamHealth') },
    { id: 'action-sync', group: 'actions', label: 'Sincronizar datos', detail: 'Compara Safes y, al confirmar, actualiza PAM/PSM, Identity Administration, SIA y Access space', keywords: ['sync', 'ingesta', 'datos', 'safes', 'psm', 'sia', 'identity', 'access'], permission: 'ingestion:run', run: () => void startIngestion() },
    { id: 'action-catalogs', group: 'actions', label: 'Administrar catálogos', detail: 'Unidades y responsables operativos', keywords: ['unidades', 'responsables'], permission: 'catalogs:manage', run: () => { selectWorkspace('safes'); setCatalogManagerOpen(true); } },
  ];

  const handleWidgetNavigation = (widget: Parameters<typeof navigateFromWidget>[0], bucket?: Parameters<typeof navigateFromWidget>[1]) => {
    const navigation = navigateFromWidget(widget, bucket);
    if (!navigation) return;
    if (navigation.workspace === 'safes') {
      if (navigation.reset !== false) resetSafeFilters();
      applySafeFilters(navigation.filters);
    } else if (navigation.workspace === 'assets') {
      setAssetsSeed(navigation.assetsSeed);
      selectWorkspace(navigation.workspace, { preserveAssetsSeed: true });
      return;
    }
    selectWorkspace(navigation.workspace);
  };


  if (isHome) return <div className="app-shell"><AuthProvider value={authContextValue}><NotificationProvider value={notificationContextValue}><AppHeader
    isHome
    theme={theme} onThemeChange={toggleTheme} workspaceView={workspaceView} onWorkspaceChange={selectWorkspace}
    onHome={navigateHome}
    previewBusy={previewBusy} ingestionBusy={ingestionBusy}
    onStartIngestion={() => void startIngestion()}
    includeInternalMetrics={includeInternalMetrics} onIncludeInternalMetricsChange={changeInternalMetricScope}
      onSearchSelect={handleSearchResult}
    commandCenterCommands={commandCenterCommands}
    workspacePreferences={workspacePreferences}
    onWorkspacePreferencesChange={saveWorkspacePreferences}
  /></NotificationProvider></AuthProvider><HomeWorkspace authStatus={authStatus} onNavigate={selectWorkspace} /></div>;

  return <div className="app-shell">
    <AuthProvider value={authContextValue}><NotificationProvider value={notificationContextValue}><AppHeader
      theme={theme}
      onThemeChange={toggleTheme}
      workspaceView={workspaceView}
      onWorkspaceChange={selectWorkspace}
      onHome={navigateHome}
      previewBusy={previewBusy}
      ingestionBusy={ingestionBusy}
      onStartIngestion={() => void startIngestion()}
      includeInternalMetrics={includeInternalMetrics}
      onIncludeInternalMetricsChange={changeInternalMetricScope}
    onSearchSelect={handleSearchResult}
      commandCenterCommands={commandCenterCommands}
      workspacePreferences={workspacePreferences}
      onWorkspacePreferencesChange={saveWorkspacePreferences}
    /></NotificationProvider></AuthProvider>
    <main key={`${workspaceView}:${workspaceRefreshKey}`} className="workspace-shell">
      <div className="workspace-content">
        <WorkspaceIntro
          title={workspaceView === 'general' && authStatus.user?.name ? `Bienvenido, ${authStatus.user.name}` : workspaceLabels[workspaceView]}
          description={workspaceView === 'general' ? 'Tu selección personal de señales PAM.' : workspaceView === 'posture' ? 'Revisá señales verificables del inventario y convertí cada hallazgo en una decisión.' : workspaceView === 'graph' ? 'Explorá relaciones PAM verificadas desde una identidad hasta el conector PSM.' : workspaceView === 'platforms' ? 'Inventario de plataformas PAM, Safes y cuentas asociadas.' : workspaceView === 'connectors' ? 'Inventario unificado de conectores PSM y SIA. Usá “Sincronizar datos” para actualizar todas las fuentes.' : workspaceView === 'pamHealth' ? 'Conectividad y versión de Portal, CPM y PSM observadas por CyberArk.' : workspaceView === 'aimApplications' ? 'Catálogo de aplicaciones registradas para Application Identity Manager.' : workspaceView === 'accessAssets' ? 'Catálogo de assets accesibles vía Access space. La relación con plataformas PAM sólo se muestra cuando el ID coincide exactamente.' : workspaceView === 'siaConnectors' ? 'Catálogo de conectores de Secure Infrastructure Access. Nunca incluye dirección/host ni red del conector.' : workspaceView === 'siaResources' ? 'Infraestructura VM de Secure Infrastructure Access. Nunca incluye IP, FQDN ni nombre de red.' : workspaceView === 'siaDatabaseAccounts' ? 'Strong Accounts de base de datos de Secure Infrastructure Access. Nunca incluye dirección/host ni usuario de la cuenta.' : workspaceView === 'identityFederations' ? 'Federaciones de Identity Administration. Sólo campos núcleo; nunca certificados SAML/SSO ni dominios/apps federados.' : workspaceView === 'netskope' ? 'Espacio habilitado para Netskope DLP. Todavía no hay una fuente configurada ni datos sincronizados.' : workspaceView === 'safes' ? 'Revisá Safes, miembros, cuentas y asignaciones.' : workspaceView === 'assets' ? 'Buscá un activo o conexión importada y revisá su cobertura observada en PAM y SIA.' : workspaceView === 'roles' ? 'Explorá los roles nativos de CyberArk y su acceso sobre usuarios, Safes y cuentas.' : workspaceView === 'identityUsers' ? 'Identidades PAM reconocidas por correo electrónico; revisá sus cadenas de acceso.' : workspaceView === 'identityGroups' ? 'Grupos federados de Okta reconocidos por el prefijo sg_; revisá su alcance efectivo.' : workspaceView === 'identityRoles' ? 'Roles actuales de Identity Administration.' : workspaceView === 'sia' ? 'Políticas de acceso y objetos administrados por Secure Infrastructure Access.' : workspaceView === 'identity' ? 'Directorio SCIM de Identity Administration, sincronizado como fuente independiente de PAM.' : workspaceView === 'users' ? 'Gestioná el acceso de las personas a DS Hub.' : workspaceView === 'activity' ? 'Registro de cambios administrativos del sistema.' : 'Administración de unidades y responsables del inventario.'}
          latestRun={latestRun || null}
          showRunSummary={workspaceView === 'safes'}
        />
        <AppNotifications error={error} notice={notice} onDismissError={() => setError('')} onDismissNotice={() => setNotice('')} />

        {(workspaceView === 'safes' || workspaceView === 'platforms' || workspaceView === 'connectors' || workspaceView === 'pamHealth') && <PamInfraSubnav activeView={workspaceView} permissions={authStatus?.permissions || []} onNavigate={navigateFromIdentity} />}

        {workspaceView === 'general' && <GeneralWorkspace onWidgetNavigate={handleWidgetNavigation} onUnauthorized={onUnauthorized} onError={setError} onNotice={setNotice} includeInternal={includeInternalMetrics} />}
        <Suspense fallback={<StateBlock variant="loading" title="Cargando workspace…" />}>
        {workspaceView === 'posture' && <PostureWorkspace
          authChecked={authChecked}
          authenticated={isAuthenticated}
          includeInternal={includeInternalMetrics}
          canManage={Boolean(authStatus?.permissions?.includes('findings:manage'))}
          onUnauthorized={onUnauthorized}
          onError={setError}
          onNotice={setNotice}
          onNavigate={navigateFromIdentity}
        />}

        {workspaceView === 'graph' && canManageAccess && <PamChainWorkspace authChecked={authChecked} authenticated={isAuthenticated} onUnauthorized={onUnauthorized} onError={setError} onNavigate={navigateFromIdentity} includeInternal={includeInternalMetrics} initialQuery={pamGraphSeed} />}
        {workspaceView === 'platforms' && hasAccess('platforms') && <PamPlatformsWorkspace key={pamPlatformSeed} authChecked={authChecked} authenticated={isAuthenticated} onUnauthorized={onUnauthorized} onError={setError} onNavigate={navigateFromIdentity} onOpenConnectors={(query) => navigateFromIdentity('connectors', query)} initialQuery={pamPlatformSeed} />}
        {workspaceView === 'connectors' && hasAccess('connectors') && <PamConnectorsWorkspace key={pamConnectorSeed} authChecked={authChecked} authenticated={isAuthenticated} onUnauthorized={onUnauthorized} onError={setError} onOpenPlatforms={(query) => navigateFromIdentity('platforms', query)} initialQuery={pamConnectorSeed} />}
        {workspaceView === 'pamHealth' && hasAccess('pamHealth') && <PamSystemHealthWorkspace authChecked={authChecked} authenticated={isAuthenticated} onUnauthorized={onUnauthorized} onError={setError} />}
        {workspaceView === 'aimApplications' && hasAccess('aimApplications') && <PamAimApplicationsWorkspace authChecked={authChecked} authenticated={isAuthenticated} onUnauthorized={onUnauthorized} onError={setError} />}
        </Suspense>

        {workspaceView === 'safes' && <SafesWorkspace
          catalogs={catalogs}
          catalogManagerOpen={catalogManagerOpen}
          onOpenCatalogManager={() => setCatalogManagerOpen(true)}
          onCloseCatalogManager={() => setCatalogManagerOpen(false)}
          onCatalogChanged={() => loadDashboard({ refreshStatic: true })}
          onNotice={setNotice}
          onError={setError}
          tableProps={safeTableProps}
          canManageCatalogs={Boolean(authStatus?.permissions?.includes('catalogs:manage'))}
          summary={summary}
          healthFilter={healthFilter}
          onHealthChange={(value) => { setHealthFilter(value); setPage(0); }}
          accountPlatformCoverage={accountPlatformCoverage}
        />}

        <Suspense fallback={<StateBlock variant="loading" title="Cargando workspace…" />}>
        {(workspaceView === 'sia' || workspaceView === 'siaResources' || workspaceView === 'siaDatabaseAccounts' || workspaceView === 'accessAssets' || workspaceView === 'assets') && <SiaHubWorkspace
          key={`${assetsSeed.search}:${assetsSeed.environment}:${assetsSeed.coverage}`}
          authChecked={authChecked}
          authenticated={isAuthenticated}
          permissions={authStatus?.permissions || []}
          includeInternal={includeInternalMetrics}
          canManageAssets={Boolean(authStatus?.permissions?.includes('connections:import'))}
          onUnauthorized={onUnauthorized}
          onError={setError}
          onNotice={setNotice}
          onNavigate={navigateFromIdentity}
          initialSection={workspaceView === 'assets' ? 'coverage' : workspaceView === 'siaResources' || workspaceView === 'siaDatabaseAccounts' || workspaceView === 'accessAssets' ? 'resources' : 'policies'}
          initialResourceKind={workspaceView === 'siaDatabaseAccounts' ? 'databaseAccounts' : workspaceView === 'accessAssets' ? 'accessAssets' : 'resources'}
          initialQuery={siaSeed}
          assetsSeed={assetsSeed}
        />}

        {(workspaceView === 'identity' || workspaceView === 'identityUsers' || workspaceView === 'identityGroups' || workspaceView === 'identityRoles' || workspaceView === 'identityFederations' || workspaceView === 'roles') && <IdentityWorkspace
          authChecked={authChecked}
          authenticated={isAuthenticated}
          permissions={authStatus?.permissions || []}
          onUnauthorized={onUnauthorized}
          onError={setError}
          onNavigate={navigateFromIdentity}
          includeInternal={includeInternalMetrics}
          initialSection={workspaceView === 'roles' || workspaceView === 'identityRoles' ? 'cyberarkRoles' : workspaceView === 'identityGroups' ? 'groups' : workspaceView === 'identityUsers' ? 'users' : workspaceView === 'identityFederations' ? 'federations' : identitySectionSeed}
          initialQuery={workspaceView === 'roles' ? pamRoleSeed : identitySeed}
        />}

        {workspaceView === 'users' && canManageAccess && <UsersWorkspace currentActorId={authStatus?.user?.actor_id} currentUserEmail={authStatus?.user?.email} onNotice={(message) => { setError(''); setNotice(message); }} onError={(message) => { setNotice(''); setError(message); }} />}

        {workspaceView === 'activity' && canManageAccess && <ActivityWorkspace />}

        {workspaceView === 'netskope' && hasAccess('netskope') && <NetskopeWorkspace />}
        </Suspense>

        {syncPreview && <SyncPreview preview={syncPreview} busy={previewBusy} onConfirm={() => void applyIngestion()} onCancel={() => { setSyncPreview(null); setSyncToast(null); }} />}
        {catalogModal && <CatalogModal kind={catalogModal} draft={catalogDraft} busy={catalogBusy} onDraftChange={(updates) => setCatalogDraft((current) => ({ ...current, ...updates }))} onSubmit={saveCatalogEntry} onClose={() => setCatalogModal(null)} />}
        {detail && <SafeDetailDrawer detail={detail} accounts={detail.accounts} catalogs={catalogs} form={form} saving={saving} audit={detail.audit} onClose={() => setDetail(null)} onFormChange={(updates) => setForm((current) => ({ ...current, ...updates }))} actionOptions={nextActionOptions} onNavigate={navigateFromIdentity} onSave={saveMetadata} onAddBusinessUnit={() => openCatalogModal('unit')} onAddResponsible={() => openCatalogModal('responsible')} />}
      </div>
    </main>
    {syncToast && <SyncToast state={syncToast} elapsedSeconds={syncElapsedSeconds} formatElapsed={formatElapsed} />}
  </div>;
}
