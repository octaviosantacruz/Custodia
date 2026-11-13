import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../lib/api';
import { fetchPersonClientCoverageDetail } from '../lib/chains-api';
import { t } from '../i18n/index.ts';

type UsePersonClientCoverageOptions = {
  enabled: boolean;
  authChecked: boolean;
  authenticated: boolean;
  email: string | null;
  onUnauthorized: () => void;
  onError: (message: string) => void;
};

export function usePersonClientCoverage({
  enabled, authChecked, authenticated, email, onUnauthorized, onError,
}: UsePersonClientCoverageOptions) {
  const requestsEnabled = enabled && authChecked && authenticated;
  const detailQuery = useQuery({
    queryKey: ['person-client-coverage', 'detail', email],
    enabled: requestsEnabled && Boolean(email),
    queryFn: ({ signal }) => fetchPersonClientCoverageDetail(email!, signal),
  });

  useEffect(() => {
    const error = detailQuery.error;
    if (!error) return;
    if (error instanceof ApiError && error.status === 401) onUnauthorized();
    else onError(error instanceof Error ? error.message : t('No se pudo consultar la cobertura'));
  }, [detailQuery.error, onError, onUnauthorized]);

  return {
    enabled: requestsEnabled,
    detail: requestsEnabled && detailQuery.data?.email === email ? detailQuery.data : null,
    detailLoading: requestsEnabled && Boolean(email) && (detailQuery.isLoading || detailQuery.isFetching),
    detailError: requestsEnabled && detailQuery.error ? detailQuery.error.message : null,
    retryDetail: () => detailQuery.refetch(),
  };
}
