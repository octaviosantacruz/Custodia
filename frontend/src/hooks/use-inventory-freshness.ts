import { useCallback, useEffect, useState } from 'react';
import { fetchInventoryFreshness } from '../lib/ingestion-api';
import type { InventoryFreshness } from '../types/dashboard';

/* Loads operational freshness signals (Safe last-modification age, thin or
   stale account inventory). Not credential rotation -- secretManagement
   timestamps are not persisted; see integration-contracts.md. */
export function useInventoryFreshness(refreshKey: unknown = null) {
  const [data, setData] = useState<InventoryFreshness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchInventoryFreshness());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar la frescura del inventario');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  return { data, loading, error, reload: load };
}
