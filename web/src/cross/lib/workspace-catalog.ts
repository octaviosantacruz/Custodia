import { REGISTERED_WORKSPACES, type RegisteredWorkspaceId } from '../../sources.ts';
import type { RegisteredWorkspace, WorkspaceCatalogEntry } from '../../source-contract.ts';

export type { Domain, WorkspaceGate, WorkspaceCatalogEntry } from '../../source-contract.ts';
export type WorkspaceView = RegisteredWorkspaceId;

/** Compatibility facade: all declarations belong to their registered owners. */
export const WORKSPACE_CATALOG = REGISTERED_WORKSPACES;
export const CATALOG_ENTRIES = WORKSPACE_CATALOG;
export const CATALOG_BY_ID = Object.fromEntries(
  CATALOG_ENTRIES.map((entry) => [entry.id, entry]),
) as Record<WorkspaceView, RegisteredWorkspace>;

export function catalogValues<T>(select: (entry: WorkspaceCatalogEntry) => T): Record<WorkspaceView, T> {
  return Object.fromEntries(CATALOG_ENTRIES.map((entry) => [entry.id, select(entry)])) as Record<WorkspaceView, T>;
}
