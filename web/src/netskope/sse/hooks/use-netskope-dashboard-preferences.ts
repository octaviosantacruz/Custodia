import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../../cross/lib/api';
import { fetchNetskopeDashboardPreferences, saveNetskopeDashboardPreferences } from '../lib/netskope-api';
import { DEFAULT_NETSKOPE_WIDGETS, netskopeChartWidgetIds, netskopeDataWidgetIds, normalizeNetskopeWidgets } from '../lib/netskope-dashboard';
import type { NetskopeWidgetInstance } from '../types/netskope';
import { t } from '../../../cross/i18n/index.ts';

type Options = {
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
};

export function useNetskopeDashboardPreferences({ authChecked, authenticated, onUnauthorized, onError, onNotice }: Options) {
  const queryClient = useQueryClient();
  const queryKey = ['netskope', 'dashboard-preferences'] as const;
  // Saved view before the last save, so "Deshacer" can restore it without
  // another confirmation (VIEW-003). In-memory only: a reload drops it.
  const [undoWidgets, setUndoWidgets] = useState<NetskopeWidgetInstance[] | null>(null);
  const query = useQuery({
    queryKey,
    enabled: authChecked && authenticated,
    queryFn: ({ signal }) => fetchNetskopeDashboardPreferences(signal),
  });
  useEffect(() => {
    if (!query.error) return;
    if (query.error instanceof ApiError && query.error.status === 401) onUnauthorized();
    else onError(query.error instanceof Error ? query.error.message : t('No se pudo cargar tu vista de Netskope'));
  }, [onError, onUnauthorized, query.error]);
  const saveMutation = useMutation({ mutationFn: (widgets: NetskopeWidgetInstance[]) => saveNetskopeDashboardPreferences(widgets) });
  const save = async (nextWidgets: NetskopeWidgetInstance[]) => {
    const previous = query.data ? normalizeNetskopeWidgets(query.data) : null;
    try {
      const response = await saveMutation.mutateAsync(nextWidgets);
      queryClient.setQueryData(queryKey, response);
      if (previous) setUndoWidgets(previous);
      onNotice(t('Tu vista de Netskope quedó actualizada ({nextWidgets} {bloques})', { nextWidgets: nextWidgets.length, bloques: nextWidgets.length === 1 ? 'bloque' : 'bloques' }));
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onUnauthorized();
      else onError(error instanceof Error ? error.message : t('No se pudo guardar tu vista de Netskope'));
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
  const widgets = query.data ? normalizeNetskopeWidgets(query.data) : DEFAULT_NETSKOPE_WIDGETS;
  return {
    widgets,
    dataWidgets: netskopeDataWidgetIds(widgets),
    chartWidgets: netskopeChartWidgetIds(widgets),
    // Cached preferences already define the selection during a refresh.
    loading: query.isLoading,
    saving: saveMutation.isPending,
    canUndo: undoWidgets !== null,
    save,
    undo,
  };
}
