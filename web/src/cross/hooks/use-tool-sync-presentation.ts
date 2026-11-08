import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SyncPresentation, SyncPresentationRegistration } from '../../source-contract';

/** Tool owners provide the resource and wording; shell and views share its cache. */
export function useToolSyncPresentation(registration: SyncPresentationRegistration | undefined, enabled: boolean, refreshKey?: number): SyncPresentation | null {
  const client = useQueryClient();
  const previousRefresh = useRef(refreshKey);
  useEffect(() => {
    if (registration && enabled && previousRefresh.current !== refreshKey) {
      void client.invalidateQueries({ queryKey: registration.queryKey }, { cancelRefetch: false });
    }
    previousRefresh.current = refreshKey;
  }, [client, enabled, refreshKey, registration]);
  const query = useQuery({
    queryKey: registration?.queryKey ?? ['sync-presentation', 'unregistered'],
    enabled: enabled && !!registration,
    queryFn: ({ signal }) => registration!.fetch(signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  if (!registration || !enabled) return null;
  if (query.isError) return { text: 'Sin información de sincronización', running: false };
  return query.data ?? { text: 'Consultando sincronización…', running: false };
}
