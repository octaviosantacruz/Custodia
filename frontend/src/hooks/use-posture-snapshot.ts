import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { fetchFindings } from '../lib/findings-api';
import type { Finding } from '../types/findings';

export function usePostureSnapshot(refreshKey: unknown) {
  const [rows, setRows] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetchFindings({ status: 'open', ruleId: '', severity: '', page: 0, limit: 6 });
      setRows(Array.isArray(response.rows) ? response.rows : []);
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 401) {
        setError('La sesión ya no es válida');
      } else {
        setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar la postura');
      }
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  return { rows, loading, error, reload: load };
}
