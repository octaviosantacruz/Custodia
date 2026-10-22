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

// Stable component identities preserve the shared CyberArk runtime across its tools.
const ROUTERS = Object.fromEntries(REGISTERED_RUNTIMES.map((runtime) => [runtime.id, lazy(runtime.load)]));

export function RegisteredWorkspaceRouter(props: SourceRouterProps) {
  // Limit this local company scenario to the original flows with synthetic contracts.
  if (!['person', 'safes', 'graph', 'netskopeInventory', 'netskopeDevices', 'netskopeUsers'].includes(props.workspaceView)) {
    return <StateBlock title="Este recorrido todavía no forma parte de la demo" hint="Podés revisar Personas, Safes y Equipos Netskope desde los enlaces de Faro Digital. Las otras pantallas requieren sus propios contratos y datos de ejemplo." />;
  }
  const runtime = runtimeForWorkspace(props.workspaceView);
  if (runtime.gateWorkspace && !hasWorkspaceAccess(props.workspaceView, props.permissions)) return null;
  const Router = ROUTERS[runtime.id];
  const content = <Router {...props} onNotice={runtime.clearErrorOnNotice
    ? (message) => { props.onError(''); props.onNotice(message); }
    : props.onNotice} />;
  return runtime.suspense
    ? <Suspense fallback={<StateBlock variant="loading" title="Cargando workspace…" />}>{content}</Suspense>
    : content;
}
