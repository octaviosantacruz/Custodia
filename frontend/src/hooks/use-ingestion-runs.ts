import { useCallback, useEffect, useState } from 'react';
import { fetchIngestionRuns } from '../lib/ingestion-api';
import type { IngestionRun } from '../types/ingestion';

/* Loads the recent CyberArk sync history for the read-only history panel.
   Self-contained: the general workspace owns it the same way the SIA and
   Identity workspaces own their own section loads. */
export function useIngestionRuns(refreshKey: unknown = null) {
  const [runs, setRuns] = useState<IngestionRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRuns(await fetchIngestionRuns());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar el historial de sincronizaciones');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  return { runs, loading, error, reload: load };
}
