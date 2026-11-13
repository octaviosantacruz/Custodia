/**
 * Compone las pantallas transversales de usuarios, actividad y ayuda mediante
 * carga diferida. Recibe la sesión y permisos desde la aplicación; la gestión
 * de acceso se valida también en las rutas del backend.
 */
import { lazy, Suspense } from 'react';
import { StateBlock } from '../components/state-block';
import type { WorkspaceView } from '../lib/workspaces';
import { t } from '../i18n/index.ts';

const UsersWorkspace = lazy(() => import('../components/users-workspace').then((module) => ({ default: module.UsersWorkspace })));
const ActivityWorkspace = lazy(() => import('../components/activity-workspace').then((module) => ({ default: module.ActivityWorkspace })));
const HelpWorkspace = lazy(() => import('../components/help-workspace').then((module) => ({ default: module.HelpWorkspace })));

type AdminDomainRouterProps = {
  workspaceView: WorkspaceView;
  authMode?: 'local' | 'oidc' | 'hybrid';
  currentActorId?: string;
  currentUserEmail?: string | null;
  permissions: string[];
  /* DOCS-PORTAL-001 */
  apiDocsEnabled?: boolean;
  guideSection?: string | null;
  onNavigate?: (view: WorkspaceView) => void;
  onUnauthorized?: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
};

/** Administration remains a separate domain from every product inventory. */
export function AdminDomainRouter({
  workspaceView, authMode, currentActorId, currentUserEmail, permissions, apiDocsEnabled, guideSection, onNavigate, onUnauthorized, onError, onNotice,
}: AdminDomainRouterProps) {
  return <Suspense fallback={<StateBlock variant="loading" title={t('Cargando workspace…')} />}>
    {workspaceView === 'users' && <UsersWorkspace
      authMode={authMode}
      currentActorId={currentActorId}
      currentUserEmail={currentUserEmail}
      permissions={permissions}
      onNotice={(message) => { onError(''); onNotice(message); }}
      onError={(message) => { onNotice(''); onError(message); }}
    />}
    {workspaceView === 'activity' && <ActivityWorkspace permissions={permissions} onUnauthorized={onUnauthorized} />}
    {workspaceView === 'help' && <HelpWorkspace
      apiDocsEnabled={apiDocsEnabled === true}
      requestedSection={guideSection ?? null}
      permissions={permissions}
      onNavigate={onNavigate}
    />}
  </Suspense>;
}
