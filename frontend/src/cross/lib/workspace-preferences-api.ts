import { api } from './api';
import type { WorkspaceView } from './workspaces';

export const MAX_QUICK_ACCESS_PER_DOMAIN = 6;

export type WorkspacePreferences = {
  visible_workspaces: WorkspaceView[];
  hidden_workspaces: WorkspaceView[];
  recent_workspaces: WorkspaceView[];
  updated_at: string | null;
};

export function fetchWorkspacePreferences(signal?: AbortSignal): Promise<WorkspacePreferences> {
  return api('/workspaces/preferences', { signal });
}

export function saveWorkspacePreferences(
  preferences: Partial<Pick<WorkspacePreferences, 'visible_workspaces' | 'hidden_workspaces' | 'recent_workspaces'>>,
): Promise<WorkspacePreferences> {
  return api('/workspaces/preferences', { method: 'PUT', body: JSON.stringify(preferences) });
}
