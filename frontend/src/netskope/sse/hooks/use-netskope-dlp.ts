import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../../../cross/lib/api';
import { errorDetailsFrom, type ErrorDetails } from '../../../cross/lib/error-details';
import { fetchNetskopeDlpAlerts, fetchNetskopeDlpPolicies } from '../lib/netskope-api';
import { NETSKOPE_DLP_DRILL_SIZE } from '../lib/netskope-dlp';

type Options = {
  authChecked: boolean;
  authenticated: boolean;
  refreshKey?: number;
  onUnauthorized: () => void;
  onError: (message: string) => void;
};

function queryError(error: unknown, fallback: string): { message: string; details: ErrorDetails | null } {
  if (!error) return { message: '', details: null };
  return { message: error instanceof Error ? error.message : fallback, details: errorDetailsFrom(error, fallback) };
}

/** Server state for the DLP-by-policy screen: one row per policy name. */
export function useNetskopeDlp({ authChecked, authenticated, refreshKey = 0, onUnauthorized, onError }: Options) {
  const enabled = authChecked && authenticated;
  const policies = useQuery({
    queryKey: ['netskope', 'dlp', 'policies', refreshKey],
    enabled,
    queryFn: ({ signal }) => fetchNetskopeDlpPolicies(signal),
  });

  useEffect(() => {
    if (policies.error instanceof ApiError && policies.error.status === 401) {
      onUnauthorized();
      return;
    }
    if (policies.error) onError(queryError(policies.error, 'No se pudieron cargar las políticas DLP').message);
  }, [onError, onUnauthorized, policies.error]);

  const error = queryError(policies.error, 'No se pudieron cargar las políticas DLP');
  return {
    policies: policies.data ?? null,
    loading: policies.isLoading,
    refreshing: policies.isFetching,
    error: error.message,
    errorInfo: error.details,
    reload: async () => { await policies.refetch(); },
  };
}

/** The few most recent incidents of one policy, fetched only when its row is opened. */
export function useNetskopeDlpPolicyIncidents(policy: string, refreshKey = 0) {
  const incidents = useQuery({
    queryKey: ['netskope', 'dlp', 'policy-incidents', policy, refreshKey],
    queryFn: ({ signal }) => fetchNetskopeDlpAlerts({ policy }, 0, NETSKOPE_DLP_DRILL_SIZE, signal),
  });
  const error = queryError(incidents.error, 'No se pudieron cargar los incidentes');
  return {
    rows: Array.isArray(incidents.data?.rows) ? incidents.data.rows : [],
    total: incidents.data?.total ?? 0,
    loading: incidents.isLoading,
    error: error.message,
    retry: () => { void incidents.refetch(); },
  };
}
