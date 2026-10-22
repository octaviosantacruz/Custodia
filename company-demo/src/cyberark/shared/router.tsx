/**
 * Compone las pantallas CyberArk y su contexto de refresh compartido.
 * Los hubs pueden presentar varias herramientas, pero sus hooks, APIs y permisos
 * conservan la propiedad y el aislamiento de PAM, Identity, SIA y Access.
 */
import { Suspense, useEffect, useState } from 'react';
import { SafeDetailDrawer } from '../pam/components/safe-detail-drawer';
import { SafesWorkspace } from '../pam/components/safes-workspace';
import { PamInfraSubnav } from '../pam/components/pam-infra-subnav';
import { GeneralWorkspace } from '../pam/components/general-workspace';
import { CatalogModal } from '../pam/components/catalog-modal';
import { StateBlock } from '../../cross/components/state-block';
import { useDashboard } from '../pam/hooks/use-dashboard';
import { useSafeFilters } from '../pam/hooks/use-safe-filters';
import { useSafeActions } from '../pam/hooks/use-safe-actions';
import { useCatalogForm } from '../pam/hooks/use-catalog-form';
import { useSafeTableConfig } from '../pam/hooks/use-safe-table-config';
import { nextActionOptions } from '../../cross/lib/format';
import { hasWorkspaceAccess, type WorkspaceView } from '../../cross/lib/workspaces';
import { firstAuthorizedSiaResourceWorkspace } from '../../cross/lib/workspaces';
import { domainOf } from '../../cross/lib/domains';
import { navigateFromWidget, selectSearchResult } from '../pam/lib/widget-navigation';
import type { ConnectionCoverageFilter } from '../../cross/types/connection';
import type { SearchResult } from '../../cross/lib/search-api';
import type { AuthStatus } from '../../cross/types/auth';
import type { IngestionRun } from '../../cross/types/ingestion';
import { PamRefreshContext } from './refresh-context';
import { lazyWithRetry } from '../../cross/lib/lazy-with-retry';
import { PamServiceSubnav } from '../pam/components/pam-service-subnav';
import { PamPostureSubnav } from '../pam/components/pam-posture-subnav';

const ConnectionInventoryWorkspace = lazyWithRetry(() => import('../../cross/components/connection-inventory-workspace').then((module) => ({ default: module.ConnectionInventoryWorkspace })), 'connection-inventory-workspace');
const SiaHubWorkspace = lazyWithRetry(() => import('./components/sia-hub-workspace').then((module) => ({ default: module.SiaHubWorkspace })), 'sia-hub-workspace');
const IdentityWorkspace = lazyWithRetry(() => import('./components/identity-workspace').then((module) => ({ default: module.IdentityWorkspace })), 'identity-workspace');
const PamChainWorkspace = lazyWithRetry(() => import('../pam/components/pam-chain-workspace').then((module) => ({ default: module.PamChainWorkspace })), 'pam-chain-workspace');
const PamRolesWorkspace = lazyWithRetry(() => import('../pam/components/pam-roles-workspace').then((module) => ({ default: module.PamRolesWorkspace })), 'pam-roles-workspace');
const PersonChainsWorkspace = lazyWithRetry(() => import('../../cross/components/person-chains-workspace').then((module) => ({ default: module.PersonChainsWorkspace })), 'person-chains-workspace');
const PamPlatformsWorkspace = lazyWithRetry(() => import('../pam/components/pam-platforms-workspace').then((module) => ({ default: module.PamPlatformsWorkspace })), 'pam-platforms-workspace');
const ConnectorsWorkspace = lazyWithRetry(() => import('./components/connectors-workspace').then((module) => ({ default: module.ConnectorsWorkspace })), 'connectors-workspace');
const PamSystemHealthWorkspace = lazyWithRetry(() => import('../pam/components/pam-system-health').then((module) => ({ default: module.PamSystemHealthWorkspace })), 'pam-system-health');
const PamCleanupWorkspace = lazyWithRetry(() => import('../pam/components/pam-cleanup-workspace').then((module) => ({ default: module.PamCleanupWorkspace })), 'pam-cleanup-workspace');
const PostureWorkspace = lazyWithRetry(() => import('../pam/components/posture-workspace').then((module) => ({ default: module.PostureWorkspace })), 'posture-workspace');

const PAGE_SIZE = 50;

type Props = {
  workspaceView: WorkspaceView;
  refreshKey: number;
  authChecked: boolean;
  authenticated: boolean;
  authStatus: AuthStatus;
  permissions: string[];
  includeInternal: boolean;
  searchResult: SearchResult | null;
  onSearchHandled: () => void;
  catalogOpenRequest: number;
  onNavigate: (view: WorkspaceView) => void;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onDashboardLoad: (load: ((options?: { refreshStatic?: boolean }) => Promise<void>) | null) => void;
  onLatestRun: (run: IngestionRun | null) => void;
};

function isSiaView(view: WorkspaceView): boolean {
  return view === 'sia' || view === 'siaResources' || view === 'siaDatabaseAccounts';
}

function isIdentityView(view: WorkspaceView): boolean {
  return view === 'identity' || view === 'identityUsers' || view === 'identityGroups' || view === 'identityRoles' || view === 'identityFederations';
}

/** Owns the CyberArk product runtime: dashboard, Safe workflow and PAM/Identity/SIA routes. */
export function CyberarkRouter({
  workspaceView, refreshKey, authChecked, authenticated, authStatus, permissions, includeInternal,
  searchResult, onSearchHandled, catalogOpenRequest, onNavigate, onUnauthorized, onError, onNotice, onDashboardLoad, onLatestRun,
}: Props) {
  const hasAccess = (view: WorkspaceView) => hasWorkspaceAccess(view, permissions);
  const canManageAccess = permissions.includes('access:manage');
  const canReadPamCatalogs = canManageAccess || permissions.includes('pam:catalogs_read');
  const canReadIdentityCatalogs = canManageAccess || permissions.includes('identity:catalogs_read');
  const {
    search, includeAccounts, workflowFilter, classificationFilter, accountTypeFilter, inventoryScopeFilter,
    qualityFilter, scopeHintFilter, healthFilter, nextActionFilter, businessUnitFilter,
    responsibleFilter, accountPlatformStatus, page, setSearch, setIncludeAccounts, setWorkflowFilter,
    setClassificationFilter, setAccountTypeFilter, setInventoryScopeFilter, setQualityFilter,
    setScopeHintFilter, setHealthFilter, setNextActionFilter, setBusinessUnitFilter,
    setResponsibleFilter, setAccountPlatformStatus, setPage, apply: applySafeFilters, reset: resetSafeFilters,
  } = useSafeFilters();
  const [siaSeed, setSiaSeed] = useState('');
  const [identitySeed, setIdentitySeed] = useState('');
  const [identitySectionSeed, setIdentitySectionSeed] = useState<'users' | 'cyberarkRoles'>('users');
  const [pamGraphSeed, setPamGraphSeed] = useState('');
  const [pamGraphStandardSeat, setPamGraphStandardSeat] = useState<'' | 'reconciled' | 'unreconciled'>('');
  const [pamRoleSeed, setPamRoleSeed] = useState('');
  const [pamPlatformSeed, setPamPlatformSeed] = useState('');
  const [pamConnectorSeed, setPamConnectorSeed] = useState('');
  const [assetsSeed, setAssetsSeed] = useState<{ search: string; environment: string; coverage: ConnectionCoverageFilter | '' }>({ search: '', environment: '', coverage: '' });
  const [catalogManagerOpen, setCatalogManagerOpen] = useState(false);

  const { summary, catalogs, analytics, accountPlatformCoverage, accountManagementSummary, accountManagementSummaryLoading, accountManagementSummaryError, safes, safeTotal, safeClassificationCounts, loadError, loading, setSafes, loadDashboard } = useDashboard({
    authChecked, authStatus, search, includeAccounts, workflowFilter, classificationFilter, accountTypeFilter,
    inventoryScopeFilter, qualityFilter, scopeHintFilter, healthFilter, nextActionFilter, businessUnitFilter, responsibleFilter, page,
    loadFiltered: workspaceView === 'safes', enabled: domainOf(workspaceView) === 'pam', refreshKey, includeInternal, onUnauthorized, onError,
  });
  const { detail, setDetail, form, setForm, saving, savingSafeNumber, savedSafeNumber, selectSafe, exportSafes, exportAccounts, quickUpdate, saveAssignment, bulkSaveAssignment, saveMetadata } = useSafeActions({
    catalogs, search, includeAccounts, workflowFilter, classificationFilter, accountTypeFilter, inventoryScopeFilter,
    qualityFilter, scopeHintFilter, healthFilter, nextActionFilter, businessUnitFilter, responsibleFilter, accountPlatformStatus, setSafes, loadDashboard, onError, onNotice,
  });
  const { catalogModal, setCatalogModal, catalogDraft, setCatalogDraft, catalogBusy, openCatalogModal, saveCatalogEntry } = useCatalogForm({ loadDashboard, onError, onNotice });

  useEffect(() => {
    onDashboardLoad(loadDashboard);
    return () => onDashboardLoad(null);
  }, [loadDashboard, onDashboardLoad]);
  useEffect(() => { if (catalogOpenRequest) setCatalogManagerOpen(true); }, [catalogOpenRequest]);
  useEffect(() => { onLatestRun(summary?.latest_run || null); }, [onLatestRun, summary?.latest_run]);

  const navigate = (view: WorkspaceView, query?: string, preserveAssetsSeed = false) => {
    if (!hasAccess(view)) return;
    if (view === 'safes' && query !== undefined) setSearch(query);
    if (view === 'sia' && query !== undefined) setSiaSeed(query);
    if (view === 'graph') {
      const standardSeat = query === 'standard-seat:reconciled';
      setPamGraphSeed(standardSeat ? '' : (query || ''));
      setPamGraphStandardSeat(standardSeat ? 'reconciled' : '');
    }
    if (view === 'platforms' && query !== undefined) setPamPlatformSeed(query);
    if (view === 'connectors' && query !== undefined) setPamConnectorSeed(query);
    if ((view === 'identity' || view === 'identityUsers' || view === 'identityGroups' || view === 'identityRoles') && query !== undefined) setIdentitySeed(query);
    if (view === 'roles' && query !== undefined) setPamRoleSeed(query);
    if (view === 'safes') setPage(0);
    if (view === 'assets' && !preserveAssetsSeed) setAssetsSeed((current) => query === undefined ? { search: '', environment: '', coverage: '' } : current);
    setDetail(null);
    setCatalogManagerOpen(false);
    onNavigate(view);
  };

  useEffect(() => {
    if (!searchResult) return;
    const navigation = selectSearchResult(searchResult);
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
    }
    onNavigate(navigation.workspace);
    onSearchHandled();
  }, [applySafeFilters, onNavigate, onSearchHandled, resetSafeFilters, searchResult]);

  useEffect(() => {
    if (!authChecked || !authenticated || hasAccess(workspaceView)) return;
    if (workspaceView === 'identityFederations' && hasAccess('identity')) onNavigate('identity');
    else if (workspaceView === 'siaResources' || workspaceView === 'siaDatabaseAccounts') {
      const fallback = firstAuthorizedSiaResourceWorkspace(permissions);
      onNavigate(fallback || (hasAccess('sia') ? 'sia' : 'general'));
    } else onNavigate('general');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onNavigate and hasAccess are derived from `permissions`/`workspaceView`; re-running on their identity would redirect again with no access change
  }, [authChecked, authenticated, permissions, workspaceView]);

  const tableProps = useSafeTableConfig({
    safes, loading, loadError, onRetry: () => void loadDashboard(), total: safeTotal, classificationCounts: safeClassificationCounts, page, pageSize: PAGE_SIZE, search, workflowFilter,
    classificationFilter, accountTypeFilter, inventoryScopeFilter, qualityFilter, scopeHintFilter, healthFilter, nextActionFilter, businessUnitFilter, responsibleFilter, includeAccounts,
    analytics, catalogs, savingSafeNumber, savedSafeNumber, selectedSafeNumber: detail?.safe.safe_number || null,
    selectSafe, setSearch, setIncludeAccounts, setPage, setWorkflowFilter, setClassificationFilter,
    setAccountTypeFilter, setInventoryScopeFilter, setQualityFilter, setScopeHintFilter, setHealthFilter, setNextActionFilter, setBusinessUnitFilter, setResponsibleFilter, accountPlatformStatus, setAccountPlatformStatus,
    quickUpdate, saveAssignment, bulkSaveAssignment, openCatalogModal,
    canExport: permissions.includes('inventory:export'), exportSafes, exportAccounts,
    canManage: permissions.includes('safes:manage'), onError, setSafes, onNotice,
  });

  const handleWidgetNavigation = (widget: Parameters<typeof navigateFromWidget>[0], bucket?: Parameters<typeof navigateFromWidget>[1]) => {
    const navigation = navigateFromWidget(widget, bucket);
    if (!navigation) return;
    if (navigation.workspace === 'safes') {
      if (navigation.reset !== false) resetSafeFilters();
      applySafeFilters(navigation.filters);
    } else if (navigation.workspace === 'assets') setAssetsSeed(navigation.assetsSeed);
    navigate(navigation.workspace, undefined, navigation.workspace === 'assets');
  };

  return <PamRefreshContext value={refreshKey}>
    {(workspaceView === 'posture' || workspaceView === 'pamCleanup') && <PamPostureSubnav activeView={workspaceView} permissions={permissions} onNavigate={navigate} />}
    {(workspaceView === 'connectors' || workspaceView === 'pamHealth') && <PamServiceSubnav activeView={workspaceView} permissions={permissions} onNavigate={navigate} />}
    {(workspaceView === 'safes' || workspaceView === 'platforms') && <PamInfraSubnav activeView={workspaceView} permissions={permissions} onNavigate={navigate} />}
    {workspaceView === 'general' && <GeneralWorkspace onWidgetNavigate={handleWidgetNavigation} onUnauthorized={onUnauthorized} onError={onError} onNotice={onNotice} includeInternal={includeInternal} permissions={permissions} />}
    <Suspense fallback={<StateBlock variant="loading" title="Cargando workspace…" />}>
      {workspaceView === 'posture' && <PostureWorkspace authChecked={authChecked} authenticated={authenticated} includeInternal={includeInternal} canManage={permissions.includes('findings:manage')} canReadCyberarkRisk={permissions.includes('pam:risk_read')} onUnauthorized={onUnauthorized} onError={onError} onNotice={onNotice} onNavigate={navigate} />}
      {workspaceView === 'graph' && canReadPamCatalogs && <PamChainWorkspace canReadIdentity={canReadIdentityCatalogs} authChecked={authChecked} authenticated={authenticated} onUnauthorized={onUnauthorized} onError={onError} onNavigate={navigate} includeInternal={includeInternal} initialQuery={pamGraphSeed} initialStandardSeat={pamGraphStandardSeat} />}
      {workspaceView === 'person' && hasAccess('person') && <PersonChainsWorkspace authChecked={authChecked} authenticated={authenticated} permissions={permissions} onUnauthorized={onUnauthorized} onError={onError} onNavigate={navigate} />}
      {workspaceView === 'platforms' && hasAccess('platforms') && <PamPlatformsWorkspace key={pamPlatformSeed} authChecked={authChecked} authenticated={authenticated} onUnauthorized={onUnauthorized} onError={onError} onNavigate={navigate} onOpenConnectors={(query) => navigate('connectors', query)} initialQuery={pamPlatformSeed} />}
      {workspaceView === 'connectors' && hasAccess('connectors') && <ConnectorsWorkspace key={pamConnectorSeed} authChecked={authChecked} authenticated={authenticated} onUnauthorized={onUnauthorized} onError={onError} onOpenPlatforms={(query) => navigate('platforms', query)} initialQuery={pamConnectorSeed} />}
      {workspaceView === 'pamHealth' && hasAccess('pamHealth') && <PamSystemHealthWorkspace authChecked={authChecked} authenticated={authenticated} onUnauthorized={onUnauthorized} onError={onError} />}
      {workspaceView === 'pamCleanup' && hasAccess('pamCleanup') && <PamCleanupWorkspace authChecked={authChecked} authenticated={authenticated} onUnauthorized={onUnauthorized} />}
    </Suspense>
    {workspaceView === 'safes' && <SafesWorkspace catalogs={catalogs} catalogManagerOpen={catalogManagerOpen} onOpenCatalogManager={() => setCatalogManagerOpen(true)} onCloseCatalogManager={() => setCatalogManagerOpen(false)} onCatalogChanged={() => loadDashboard({ refreshStatic: true })} onNotice={onNotice} onError={onError} tableProps={tableProps} canManageCatalogs={permissions.includes('catalogs:manage')} summary={summary} healthFilter={healthFilter} onHealthChange={(value) => { setHealthFilter(value); setPage(0); }} accountPlatformCoverage={accountPlatformCoverage} accountManagementSummary={accountManagementSummary} accountManagementSummaryLoading={accountManagementSummaryLoading} accountManagementSummaryError={accountManagementSummaryError} onScopeChange={(scope) => { if (scope === 'retired') setDetail(null); }} />}
    <Suspense fallback={<StateBlock variant="loading" title="Cargando workspace…" />}>
      {isSiaView(workspaceView) && <SiaHubWorkspace authChecked={authChecked} authenticated={authenticated} permissions={permissions} onUnauthorized={onUnauthorized} onError={onError} onNavigate={navigate} initialSection={workspaceView === 'sia' ? 'policies' : 'resources'} initialResourceKind={workspaceView === 'siaDatabaseAccounts' ? 'databaseAccounts' : 'resources'} initialQuery={siaSeed} />}
      {workspaceView === 'assets' && <ConnectionInventoryWorkspace key={`${assetsSeed.search}:${assetsSeed.environment}:${assetsSeed.coverage}`} refreshKey={refreshKey} authChecked={authChecked} authenticated={authenticated} includeInternal={includeInternal} canManage={permissions.includes('coverage:manage')} initialSearch={assetsSeed.search} initialEnvironment={assetsSeed.environment} initialCoverage={assetsSeed.coverage} onUnauthorized={onUnauthorized} onError={onError} onNotice={onNotice} />}
      {workspaceView === 'roles' && <PamRolesWorkspace key={pamRoleSeed} authChecked={authChecked} authenticated={authenticated} onUnauthorized={onUnauthorized} onError={onError} onNavigate={navigate} initialQuery={pamRoleSeed} includeInternal={includeInternal} />}
      {isIdentityView(workspaceView) && <IdentityWorkspace authChecked={authChecked} authenticated={authenticated} permissions={permissions} onUnauthorized={onUnauthorized} onError={onError} onNavigate={navigate} initialSection={workspaceView === 'identityRoles' ? 'identityRoles' : workspaceView === 'identityGroups' ? 'groups' : workspaceView === 'identityUsers' ? 'users' : workspaceView === 'identityFederations' ? 'federations' : identitySectionSeed} initialQuery={identitySeed} />}
    </Suspense>
    {catalogModal && <CatalogModal kind={catalogModal} draft={catalogDraft} busy={catalogBusy} onDraftChange={(updates) => setCatalogDraft((current) => ({ ...current, ...updates }))} onSubmit={saveCatalogEntry} onClose={() => setCatalogModal(null)} />}
    {detail && <SafeDetailDrawer canEdit={permissions.includes('inventory:write')} detail={detail} accounts={detail.accounts} catalogs={catalogs} form={form} saving={saving} audit={detail.audit} onClose={() => setDetail(null)} onFormChange={(updates) => setForm((current) => ({ ...current, ...updates }))} actionOptions={nextActionOptions} onNavigate={navigate} onSave={saveMetadata} onAddBusinessUnit={() => openCatalogModal('unit')} onAddResponsible={() => openCatalogModal('responsible')} />}
  </PamRefreshContext>;
}
