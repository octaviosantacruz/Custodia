import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../../cross/lib/api';
import { fetchFindings, refreshFindings, updateFinding } from '../lib/findings-api';
import type { Finding, FindingSeverity, FindingStatus } from '../types/findings';
import { usePamRefreshKey } from '../../shared/refresh-context';
import { t } from '../../../cross/i18n/index.ts';

export function useFindings({ authChecked, authenticated, includeInternal, onUnauthorized, onError, onNotice }: {
  authChecked: boolean;
  authenticated: boolean;
  includeInternal: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const refreshKey = usePamRefreshKey();
  const [status, setStatusState] = useState<FindingStatus | ''>('');
  const [ruleId, setRuleIdState] = useState('');
  const [severity, setSeverityState] = useState<FindingSeverity | ''>('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);

  const queryKey = ['pam', 'findings', status, ruleId, severity, page, includeInternal, refreshKey];
  const query = useQuery({
    queryKey,
    enabled: authChecked && authenticated,
    queryFn: ({ signal }) => fetchFindings({ status, ruleId, severity, page, includeInternal }, signal),
  });

  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401) { onUnauthorized(); return; }
    onError(query.error ? (query.error instanceof Error ? query.error.message : t('No se pudieron cargar los hallazgos')) : '');
  }, [query.error, onError, onUnauthorized]);

  const setFilter = <T,>(setter: (value: T) => void, value: T) => { setter(value); setPage(0); };

  const changeStatus = async (finding: Finding, nextStatus: FindingStatus, exceptionReason?: string, exceptionUntil?: string) => {
    setBusy(true);
    try {
      await updateFinding(finding.finding_id, {
        status: nextStatus,
        exception_reason: nextStatus === 'excepted' ? exceptionReason || null : null,
        exception_until: nextStatus === 'excepted' ? exceptionUntil || null : null,
      });
      onNotice(t('Estado del hallazgo actualizado'));
      await queryClient.invalidateQueries({ queryKey: ['pam', 'findings'] });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onUnauthorized();
      else onError(error instanceof Error ? error.message : t('No se pudo actualizar el hallazgo'));
      throw error;
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    setBusy(true);
    try {
      const response = await refreshFindings();
      onNotice(`${response.current_findings} hallazgos vigentes evaluados`);
      await queryClient.invalidateQueries({ queryKey: ['pam', 'findings'] });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onUnauthorized();
      else onError(error instanceof Error ? error.message : t('No se pudieron actualizar los hallazgos'));
    } finally {
      setBusy(false);
    }
  };

  return {
    status, setStatus: (value: FindingStatus | '') => setFilter(setStatusState, value),
    ruleId, setRuleId: (value: string) => setFilter(setRuleIdState, value),
    severity, setSeverity: (value: FindingSeverity | '') => setFilter(setSeverityState, value),
    page, setPage,
    rows: query.data?.rows ?? [],
    total: query.data?.total ?? 0,
    loading: query.isLoading || query.isFetching,
    loadError: query.error instanceof Error ? query.error.message : query.error ? t('No se pudieron cargar los hallazgos') : '',
    busy,
    reload: async () => { await query.refetch(); },
    refresh,
    changeStatus,
  };
}
