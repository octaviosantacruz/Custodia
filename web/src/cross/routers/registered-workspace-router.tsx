/**
 * Selecciona y carga el runtime declarado para el workspace en sources.ts.
 * Conserva las identidades de los componentes y aplica el gate de navegación
 * configurado; cada endpoint sigue imponiendo sus permisos en el backend.
 */
import { lazy, Suspense } from 'react';
import { REGISTERED_RUNTIMES, runtimeForWorkspace } from '../../sources.ts';
import type { SourceRouterProps } from '../../source-contract.ts';
import { hasWorkspaceAccess } from '../lib/workspaces.ts';
import { StateBlock } from '../components/state-block';
import { t } from '../i18n/index.ts';

// Stable component identities preserve the shared CyberArk runtime across its tools.
const ROUTERS = Object.fromEntries(REGISTERED_RUNTIMES.map((runtime) => [runtime.id, lazy(runtime.load)]));

export function RegisteredWorkspaceRouter(props: SourceRouterProps) {
  const runtime = runtimeForWorkspace(props.workspaceView);
  if (runtime.gateWorkspace && !hasWorkspaceAccess(props.workspaceView, props.permissions)) return null;
  const Router = ROUTERS[runtime.id];
  const content = <Router {...props} onNotice={runtime.clearErrorOnNotice
    ? (message) => { props.onError(''); props.onNotice(message); }
    : props.onNotice} />;
  return runtime.suspense
    ? <Suspense fallback={<StateBlock variant="loading" title={t('Cargando workspace…')} />}>{content}</Suspense>
    : content;
}
