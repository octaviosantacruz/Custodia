import { QueryClient } from '@tanstack/react-query';

export const QUERY_STALE_TIME_MS = 30_000;

/* One client for the entire authenticated application. Queries are keyed by
 * domain/resource/filters at the call site, which lets a sync invalidate only
 * its domain instead of forcing a browser reload. Auth failures are never
 * retried: retrying a 401 only creates noise and delays the logout flow. */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: QUERY_STALE_TIME_MS,
        gcTime: 5 * 60_000,
        // Existing Custodia screens expose a deliberate “Reintentar” control.
        // Preserve that visible contract while centralizing cache/cancellation;
        // automatic retries can be introduced per resource only when an API
        // contract defines a safe retry policy.
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export const dshubQueryClient = createQueryClient();
