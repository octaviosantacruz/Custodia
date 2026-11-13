import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../../cross/lib/api';
import { fetchDashboardPreferences, saveDashboardPreferences } from '../lib/dashboard-preferences-api';
import type { DashboardWidget } from '../lib/dashboard-metrics';
import { usePamRefreshKey } from '../../shared/refresh-context';
import { t } from '../../../cross/i18n/index.ts';

type Options = { onUnauthorized: () => void; onError: (message: string) => void; onNotice: (message: string) => void; includeInternal: boolean };

export function useDashboardPreferences({ onUnauthorized, onError, onNotice, includeInternal }: Options) {
  const refreshKey = usePamRefreshKey();
  const queryClient = useQueryClient();
  const queryKey = ['pam', 'dashboard-preferences', includeInternal, refreshKey] as const;
  // Saved view before the last save, so "Deshacer" can restore it without
  // another confirmation (VIEW-003). In-memory only: a reload drops it.
  const [undoWidgets, setUndoWidgets] = useState<DashboardWidget[] | null>(null);
  const query = useQuery({
    queryKey,
    queryFn: () => fetchDashboardPreferences(includeInternal),
  });
  useEffect(() => {
    if (!query.error) return;
    if (query.error instanceof ApiError && query.error.status === 401) onUnauthorized();
    else onError(query.error instanceof Error ? query.error.message : t('No se pudo cargar tu panel'));
  }, [onError, onUnauthorized, query.error]);
  const saveMutation = useMutation({
    mutationFn: (widgets: DashboardWidget[]) => saveDashboardPreferences(widgets, includeInternal),
  });
  const save = async (nextWidgets: DashboardWidget[]) => {
    const previous = Array.isArray(query.data?.widgets) ? query.data.widgets : null;
    try {
      const response = await saveMutation.mutateAsync(nextWidgets);
      queryClient.setQueryData(queryKey, response);
      if (previous) setUndoWidgets(previous);
      onNotice(t('Tu vista de CyberArk quedó actualizada ({nextWidgets} {bloques})', { nextWidgets: nextWidgets.length, bloques: nextWidgets.length === 1 ? 'bloque' : 'bloques' }));
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onUnauthorized();
      else onError(error instanceof Error ? error.message : t('No se pudo guardar tu panel'));
      return false;
    }
  };
  const undo = async () => {
    if (!undoWidgets) return false;
    try {
      const response = await saveMutation.mutateAsync(undoWidgets);
      queryClient.setQueryData(queryKey, response);
      onNotice(`Vista anterior restaurada (${undoWidgets.length} ${undoWidgets.length === 1 ? 'bloque' : 'bloques'})`);
      setUndoWidgets(null);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onUnauthorized();
      else onError(error instanceof Error ? error.message : t('No se pudo restaurar tu vista anterior'));
      return false;
    }
  };
  return {
    widgets: Array.isArray(query.data?.widgets) ? query.data.widgets : [],
    loading: query.isLoading || query.isFetching,
    saving: saveMutation.isPending,
    canUndo: undoWidgets !== null,
    reload: async () => { await query.refetch(); },
    save,
    undo,
  };
}
