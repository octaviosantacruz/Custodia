import { DateTime } from '../../../cross/components/date-time';
import { useEffect, useState } from 'react';
import { Activity, CheckCircle2, XCircle } from 'lucide-react';
import { ApiError } from '../../../cross/lib/api';
import { epochSecondsToIso, formatNumber, versionListLabel } from '../../../cross/lib/format.ts';
import { fetchPamComponents } from '../lib/pam-technical-catalogs-api';
import { HelpHint } from '../../../cross/components/help-hint';
import { StateBlock } from '../../../cross/components/state-block';
import type { PamComponentRow } from '../types/pam';
import { usePamRefreshKey } from '../../shared/refresh-context';
import './pam-technical-catalog.css';
import { t } from '../../../cross/i18n/index.ts';

type PamSystemHealthProps = {
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
};

const COMPONENT_LABELS: Record<string, string> = {
  'Managed Accounts': 'Cuentas administradas',
  'Concurrent Sessions': t('Sesiones simultáneas'),
  'Active Users': t('Usuarios activos'),
};

export function PamSystemHealthWorkspace({ authChecked, authenticated, onUnauthorized, onError }: PamSystemHealthProps) {
  const refreshKey = usePamRefreshKey();
  const [rows, setRows] = useState<PamComponentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!authChecked || !authenticated) return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true); setError(''); onError('');
      try {
        const response = await fetchPamComponents({ signal: controller.signal });
        setRows(Array.isArray(response.rows) ? response.rows : []);
      } catch (failure) {
        if (controller.signal.aborted) return;
        if (failure instanceof ApiError && failure.status === 401) onUnauthorized();
        else setError(failure instanceof Error ? failure.message : t('No se pudo cargar la salud de componentes PAM'));
      } finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void load();
    return () => controller.abort();
  }, [authChecked, authenticated, onError, onUnauthorized, refreshKey]);

  return <section className="list-panel database-surface pam-platforms-panel" aria-label={t('Salud de componentes PAM')}>
    <div className="pam-platforms-heading">
      <div><div className="pam-health-title"><h3>{t('Salud de componentes')}</h3><HelpHint label={t('Salud de componentes PAM')}><p>Conteos agregados por tipo de componente (Portal, CPM, PSM/SSH); no atribuye IP, usuario técnico ni capacidad de host.</p></HelpHint></div><p>{t('Conectividad y versión de Portal, CPM y PSM/SSH observadas por CyberArk. Sin métricas de host ni secretos.')}</p></div>
      <span className="database-toolbar-count">{formatNumber(rows.length)} {rows.length === 1 ? "componente" : "componentes"}</span>
    </div>
    <div className="pam-health-list">
      {loading ? <StateBlock variant="loading" title={t('Cargando salud de componentes…')} />
        : error ? <StateBlock variant="error" title={t('No se pudo cargar la salud de componentes')} hint={error} />
          : rows.length ? rows.map((component) => {
            const allConnected = component.total_count > 0 && component.connected_count === component.total_count;
            return <article className={`pam-health-item${allConnected ? ' is-healthy' : ' is-attention'}`} key={component.object_id}>
              <div className="pam-health-component"><Activity size={16} aria-hidden /><div><strong>{COMPONENT_LABELS[component.display_name] || component.display_name}</strong><span>{component.description || t('Sin descripción')}</span></div></div>
              <div className="pam-health-fact"><span>{t('Conectividad')}</span>{allConnected ? <strong className="status-pill status-active"><CheckCircle2 size={12} aria-hidden /> {formatNumber(component.connected_count)} de {formatNumber(component.total_count)} conectados</strong> : <strong className="status-pill status-warning"><XCircle size={12} aria-hidden /> {formatNumber(component.connected_count)} de {formatNumber(component.total_count)} conectados</strong>}</div>
              <div className="pam-health-fact"><span>{t('Versiones')}</span><strong>{versionListLabel(component.instance_versions)}</strong></div>
              <div className="pam-health-fact"><span>{t('Última observación')}</span><strong><DateTime value={epochSecondsToIso(component.latest_logon_at)} missing={t('Sin observación registrada')} /></strong></div>
            </article>;
          }) : <StateBlock variant="empty" title={t('Todavía no hay componentes PAM sincronizados')} />}
    </div>
  </section>;
}
