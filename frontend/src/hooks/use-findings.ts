import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { fetchFindings, refreshFindings, updateFinding, type FindingFilters } from '../lib/findings-api';
import type { Finding, FindingSeverity, FindingStatus } from '../types/findings';

type UseFindingsOptions = {
  authChecked: boolean;
  authenticated: boolean;
  includeInternal: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
};

export function useFindings({ authChecked, authenticated, includeInternal, onUnauthorized, onError, onNotice }: UseFindingsOptions) {
  const [status, setStatusState] = useState<FindingStatus | ''>('');
  const [ruleId, setRuleIdState] = useState('');
  const [severity, setSeverityState] = useState<FindingSeverity | ''>('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Finding[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const filters: FindingFilters = { status, ruleId, severity, page, includeInternal };
      const response = await fetchFindings(filters);
      setRows(Array.isArray(response.rows) ? response.rows : []);
      setTotal(response.total || 0);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) { onUnauthorized(); return; }
      setRows([]); setTotal(0);
      setLoadError(error instanceof Error ? error.message : 'No se pudieron cargar los hallazgos');
    } finally {
      setLoading(false);
    }
  }, [includeInternal, onUnauthorized, page, ruleId, severity, status]);

  useEffect(() => {
    if (!authChecked || !authenticated) return;
    void load();
  }, [authChecked, authenticated, load]);

  const setFilter = <T,>(setter: (value: T) => void, value: T) => { setter(value); setPage(0); };

  const changeStatus = async (finding: Finding, nextStatus: FindingStatus, exceptionReason?: string, exceptionUntil?: string) => {
    setBusy(true);
    try {
      await updateFinding(finding.finding_id, {
        status: nextStatus,
        exception_reason: nextStatus === 'excepted' ? exceptionReason || null : null,
        exception_until: nextStatus === 'excepted' ? exceptionUntil || null : null,
      });
      onNotice('Estado del hallazgo actualizado');
      await load();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onUnauthorized();
      else onError(error instanceof Error ? error.message : 'No se pudo actualizar el hallazgo');
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
      await load();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onUnauthorized();
      else onError(error instanceof Error ? error.message : 'No se pudieron actualizar los hallazgos');
    } finally {
      setBusy(false);
    }
  };

  return {
    status, setStatus: (value: FindingStatus | '') => setFilter(setStatusState, value),
    ruleId, setRuleId: (value: string) => setFilter(setRuleIdState, value),
    severity, setSeverity: (value: FindingSeverity | '') => setFilter(setSeverityState, value),
    page, setPage, rows, total, loading, loadError, busy, reload: load, refresh, changeStatus,
  };
}
