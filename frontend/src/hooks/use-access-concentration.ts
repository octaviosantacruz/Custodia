import { useCallback, useEffect, useState } from 'react';
import { fetchAccessConcentration } from '../lib/ingestion-api';
import type { AccessConcentration } from '../types/dashboard';

const EMPTY: AccessConcentration = { users: [], roles: [], totals: { users: 0, roles: 0, safes: 0 } };

/* Loads the read-only access-concentration ranking for the landing panel.
   Over the cyberark PAM graph only; never fed into coverage or any KPI. */
export function useAccessConcentration(refreshKey: unknown = null) {
  const [data, setData] = useState<AccessConcentration>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchAccessConcentration());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar la concentración de acceso');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  return { data, loading, error, reload: load };
}
