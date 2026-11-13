import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../lib/api';
import { fetchWorkspacePreferences, saveWorkspacePreferences, type WorkspacePreferences } from '../lib/workspace-preferences-api';
import type { WorkspaceView } from '../lib/workspaces';
import { recordRecentWorkspace } from '../lib/command-center';
import { t } from '../i18n/index.ts';

const defaults: WorkspacePreferences = {
  visible_workspaces: ['safes'],
  hidden_workspaces: [],
  recent_workspaces: [],
  updated_at: null,
};

export function useWorkspacePreferences({
  authenticated, actorId, onUnauthorized, onError,
}: {
  authenticated: boolean;
  actorId: string | null | undefined;
  onUnauthorized: () => void;
  onError: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const queryKey = ['pam', 'workspace-preferences', actorId];
  const query = useQuery({
    queryKey,
    enabled: authenticated && Boolean(actorId),
    queryFn: ({ signal }) => fetchWorkspacePreferences(signal),
  });

  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401) { onUnauthorized(); return; }
    if (query.error) onError(query.error instanceof Error ? query.error.message : t('No se pudieron cargar los accesos rápidos'));
  }, [query.error, onError, onUnauthorized]);

  const preferences = authenticated && actorId ? (query.data ?? defaults) : defaults;

  const save = useCallback(async (next: Partial<Pick<WorkspacePreferences, 'visible_workspaces' | 'hidden_workspaces' | 'recent_workspaces'>>) => {
    try {
      const saved = await saveWorkspacePreferences(next);
      queryClient.setQueryData(queryKey, saved);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onUnauthorized();
      throw error;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `queryKey` is derived from `actorId`, which is listed; the remaining inputs are stable
  }, [onUnauthorized, queryClient, actorId]);

  const recordRecent = useCallback((view: WorkspaceView) => {
    const current = queryClient.getQueryData<WorkspacePreferences>(queryKey) ?? defaults;
    const recent_workspaces = recordRecentWorkspace(view, current.recent_workspaces);
    queryClient.setQueryData(queryKey, { ...current, recent_workspaces });
    void save({ recent_workspaces }).catch((error) => {
      if (!(error instanceof ApiError && error.status === 401)) {
        onError(error instanceof Error ? error.message : t('No se pudieron guardar los recientes'));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `queryKey` is derived from `actorId`, which is listed; the remaining inputs are stable
  }, [onError, save, queryClient, actorId]);

  return { preferences, loading: query.isLoading || query.isFetching, save, recordRecent };
}
