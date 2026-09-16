import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { fetchDashboardPreferences, saveDashboardPreferences } from '../lib/dashboard-preferences-api';
import type { DashboardWidget } from '../lib/dashboard-metrics';

type Options = { onUnauthorized: () => void; onError: (message: string) => void; onNotice: (message: string) => void; includeInternal: boolean };

export function useDashboardPreferences({ onUnauthorized, onError, onNotice, includeInternal }: Options) {
  const [widgets, setWidgets] = useState<DashboardWidget[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchDashboardPreferences(includeInternal);
      setWidgets(Array.isArray(response.widgets) ? response.widgets : []);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onUnauthorized();
      else onError(error instanceof Error ? error.message : 'No se pudo cargar tu panel');
    } finally {
      setLoading(false);
    }
  }, [includeInternal, onError, onUnauthorized]);
  useEffect(() => { void load(); }, [load]);
  const save = async (nextWidgets: DashboardWidget[]) => {
    setSaving(true);
    try {
      const response = await saveDashboardPreferences(nextWidgets, includeInternal);
      setWidgets(response.widgets);
      onNotice('Tu panel quedó actualizado');
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onUnauthorized();
      else onError(error instanceof Error ? error.message : 'No se pudo guardar tu panel');
      return false;
    } finally {
      setSaving(false);
    }
  };
  return { widgets, loading, saving, reload: load, save };
}
