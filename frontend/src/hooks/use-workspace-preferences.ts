import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { fetchWorkspacePreferences, saveWorkspacePreferences, type WorkspacePreferences } from '../lib/workspace-preferences-api';
import type { WorkspaceView } from '../lib/workspaces';
import { recordRecentWorkspace } from '../lib/command-center';

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
  const [preferences, setPreferences] = useState<WorkspacePreferences>(defaults);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authenticated || !actorId) {
      setPreferences(defaults);
      setLoading(false);
      return;
    }
    let active = true;
    setPreferences(defaults);
    setLoading(true);
    void fetchWorkspacePreferences()
      .then((value) => { if (active) setPreferences(value); })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) onUnauthorized();
        else onError(error instanceof Error ? error.message : 'No se pudieron cargar los accesos rápidos');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [actorId, authenticated, onError, onUnauthorized]);

  const save = useCallback(async (next: Partial<Pick<WorkspacePreferences, 'visible_workspaces' | 'hidden_workspaces' | 'recent_workspaces'>>) => {
    try {
      const saved = await saveWorkspacePreferences(next);
      setPreferences(saved);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onUnauthorized();
      throw error;
    }
  }, [onUnauthorized]);

  const recordRecent = useCallback((view: WorkspaceView) => {
    setPreferences((current) => {
      const recent_workspaces = recordRecentWorkspace(view, current.recent_workspaces);
      const next = { ...current, recent_workspaces };
      void save({ recent_workspaces }).catch((error) => {
        if (!(error instanceof ApiError && error.status === 401)) {
          onError(error instanceof Error ? error.message : 'No se pudieron guardar los recientes');
        }
      });
      return next;
    });
  }, [onError, save]);

  return { preferences, loading, save, recordRecent };
}
