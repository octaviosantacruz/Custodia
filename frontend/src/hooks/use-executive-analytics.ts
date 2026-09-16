import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { fetchExecutiveAnalytics } from '../lib/connection-inventory-api';
import type { ExecutiveAnalytics } from '../types/connection';

export function useExecutiveAnalytics({ includeInternal, onUnauthorized }: { includeInternal: boolean; onUnauthorized: () => void }) {
  const [data, setData] = useState<ExecutiveAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchExecutiveAnalytics(includeInternal));
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 401) { onUnauthorized(); return; }
      setData(null);
      setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar la lectura ejecutiva');
    } finally {
      setLoading(false);
    }
  }, [includeInternal, onUnauthorized]);

  useEffect(() => { void load(); }, [load]);
  return { data, loading, error, reload: load };
}
