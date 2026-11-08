import { catalogValues, type WorkspaceView } from './workspace-catalog.ts';

export const WORKSPACE_DESCRIPTIONS: Record<WorkspaceView, string> = catalogValues((entry) => entry.description);
