/**
 * Registro estático único del frontend: reúne los source.ts de cada propietario
 * y deriva catálogos de navegación, sincronización y runtimes. Para incorporar
 * una herramienta, declarar su source.ts y agregarla a FRONTEND_SOURCES.
 */
import type { Domain, DomainRegistration, FrontendRegistration, ManualSyncAction, RegisteredWorkspace, RuntimeRegistration, SyncRegistration } from './source-contract.ts';
import type { WidgetCommandSources } from './cross/lib/command-center.ts';
import { registration as cyberark_pam } from './cyberark/pam/source.ts';
import { registration as cyberark_identity_administration } from './cyberark/identity_administration/source.ts';
import { registration as cyberark_sia } from './cyberark/sia/source.ts';
import { registration as cyberark_access } from './cyberark/access/source.ts';
import { registration as cyberark_risk_management } from './cyberark/risk_management/source.ts';
import { registration as cyberark_connector_manager } from './cyberark/connector_manager/source.ts';
import { registration as cyberark_shared } from './cyberark/shared/source.ts';
import { registration as netskope_sse } from './netskope/sse/source.ts';
import { registration as cross } from './cross/source.ts';

/** The only static composition point. No plugin discovery or eager router imports. */
export const FRONTEND_SOURCES = [
  cyberark_pam,
  cyberark_identity_administration,
  cyberark_sia,
  cyberark_access,
  cyberark_risk_management,
  cyberark_connector_manager,
  cyberark_shared,
  netskope_sse,
  cross,
] as const satisfies readonly FrontendRegistration[];

const registrations: readonly FrontendRegistration[] = FRONTEND_SOURCES;
export type RegisteredWorkspaceId = (typeof FRONTEND_SOURCES)[number]['workspaces'][number]['id'];
export type RegisteredCategoryId = (typeof FRONTEND_SOURCES)[number]['categories'][number]['id'];

export const REGISTERED_WORKSPACES = registrations.flatMap((source) => source.workspaces)
  .sort((left, right) => left.order - right.order) as readonly (RegisteredWorkspace & { id: RegisteredWorkspaceId })[];
export const REGISTERED_CATEGORIES = registrations.flatMap((source) => source.categories)
  .sort((left, right) => left.order - right.order);
export const REGISTERED_DOMAINS = registrations.flatMap((source): DomainRegistration[] => [...source.domains])
  .sort((left, right) => left.order - right.order);
/** Tool labels come from each owner; neutral views keep their declared area. */
export const WORKSPACE_TOOL_LABELS = Object.fromEntries(registrations.flatMap((source) =>
  source.workspaces.map((entry) => [entry.id, source.toolLabel ?? REGISTERED_DOMAINS.find((domain) => domain.id === entry.domain)?.label ?? entry.label]),
)) as Readonly<Record<RegisteredWorkspaceId, string>>;
export const REGISTERED_SYNCS = registrations.flatMap((source): SyncRegistration[] => source.sync ? [source.sync] : []);
export const SYNC_BY_SOURCE: Readonly<Record<string, SyncRegistration>> = Object.fromEntries(REGISTERED_SYNCS.map((sync) => [sync.source, sync]));
export const REGISTERED_RUNTIMES = registrations.flatMap((source): RuntimeRegistration[] => source.runtime ? [source.runtime] : []);
export const RUNTIME_BY_ID: Readonly<Record<string, RuntimeRegistration>> = Object.fromEntries(REGISTERED_RUNTIMES.map((runtime) => [runtime.id, runtime]));

export function runtimeForWorkspace(workspace: RegisteredWorkspaceId): RuntimeRegistration {
  const entry = REGISTERED_WORKSPACES.find((entry) => entry.id === workspace);
  const runtime = entry && RUNTIME_BY_ID[entry.runtime];
  if (!runtime) throw new Error(`Workspace sin runtime registrado: ${workspace}`);
  return runtime;
}

/** Synchronization presentation belongs to the workspace's owning tool. */
export function syncForWorkspace(workspace: RegisteredWorkspaceId): SyncRegistration | undefined {
  return registrations.find(source => source.workspaces.some(entry => entry.id === workspace))?.sync;
}

/** Load tool-owned widget catalogs only when the command palette needs them. */
export async function loadWidgetCommandSources(): Promise<WidgetCommandSources> {
  const [{ DASHBOARD_SHORTCUTS }, { NETSKOPE_DATA_WIDGETS, NETSKOPE_CHART_WIDGETS }] = await Promise.all([
    import('./cyberark/pam/lib/dashboard-metrics.ts'),
    import('./netskope/sse/lib/netskope-dashboard.ts'),
  ]);
  return { cyberarkWidgets: DASHBOARD_SHORTCUTS, netskopeDataWidgets: NETSKOPE_DATA_WIDGETS, netskopeChartWidgets: NETSKOPE_CHART_WIDGETS };
}

const MANUAL_SYNC_ACTIONS = registrations.flatMap((source): ManualSyncAction[] => source.manualSync ? [source.manualSync] : []);

export function manualSyncForArea(domain: Domain): ManualSyncAction {
  const action = MANUAL_SYNC_ACTIONS.find((action) => action.domain === domain)
    ?? MANUAL_SYNC_ACTIONS.find((action) => action.domain === 'admin');
  if (!action) throw new Error('Falta la acción de sincronización transversal');
  return action;
}
