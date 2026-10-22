import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../../../cross/lib/api';
import { fetchCyberarkRiskAllFindings, fetchCyberarkRiskFindings, fetchCyberarkRiskOverview } from '../lib/cyberark-risk-api';

export function useCyberarkRisk({ enabled, groupedEnabled = false, onUnauthorized }: {
  enabled: boolean;
  /** Reads every finding once for the grouped view; the paged query stays as fallback. */
  groupedEnabled?: boolean;
  onUnauthorized: () => void;
}) {
  const [page, setPage] = useState(0);
  const overview = useQuery({
    queryKey: ['pam', 'cyberark-risk', 'overview'],
    enabled,
    queryFn: ({ signal }) => fetchCyberarkRiskOverview(signal),
    staleTime: 60_000,
  });
  const findings = useQuery({
    queryKey: ['pam', 'cyberark-risk', 'findings', page],
    enabled,
    queryFn: ({ signal }) => fetchCyberarkRiskFindings(page, signal),
    placeholderData: (previous) => previous,
    staleTime: 60_000,
  });

  const allFindings = useQuery({
    queryKey: ['pam', 'cyberark-risk', 'findings', 'all'],
    enabled: enabled && groupedEnabled,
    queryFn: ({ signal }) => fetchCyberarkRiskAllFindings(signal),
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    if ((overview.error instanceof ApiError && overview.error.status === 401)
      || (findings.error instanceof ApiError && findings.error.status === 401)
      || (allFindings.error instanceof ApiError && allFindings.error.status === 401)) onUnauthorized();
  }, [allFindings.error, findings.error, onUnauthorized, overview.error]);

  return { overview, findings, allFindings, page, setPage };
}
