import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { CATALOG_ENTRIES, catalogValues, type WorkspaceCatalogEntry, type WorkspaceView } from './workspace-catalog.ts';

/* Navigation presentation (labels, details, icons) derived from the workspace
   catalog, so a workspace is declared once. */

export const WORKSPACE_ICONS: Record<WorkspaceView, LucideIcon> = catalogValues((entry) => entry.icon);

const ENTRIES: readonly WorkspaceCatalogEntry[] = CATALOG_ENTRIES;

export const WORKSPACE_META: Record<WorkspaceView, { label: string; detail: string; icon: ReactNode }> = Object.fromEntries(
  ENTRIES.map((entry) => {
    const Icon = entry.icon;
    return [entry.id, { label: entry.label, detail: entry.detail, icon: <Icon size={16} /> }];
  }),
) as Record<WorkspaceView, { label: string; detail: string; icon: ReactNode }>;

export const workspaceLabels: Record<WorkspaceView, string> = Object.fromEntries(
  (Object.keys(WORKSPACE_META) as WorkspaceView[]).map((view) => [view, WORKSPACE_META[view].label]),
) as Record<WorkspaceView, string>;
