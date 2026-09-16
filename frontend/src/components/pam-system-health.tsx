import { useEffect, useState } from 'react';
import { Activity, CheckCircle2, XCircle } from 'lucide-react';
import { ApiError } from '../lib/api';
import { formatNumber } from '../lib/format';
import { fetchPamComponents } from '../lib/pam-technical-catalogs-api';
import { StateBlock } from './state-block';
import type { PamComponentRow } from '../types/pam';

type PamSystemHealthProps = {
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
};

function formatLastObserved(value: number | null): string {
  if (!value) return 'Sin observación registrada';
  return new Date(value * 1000).toLocaleString('es-AR');
}

export function PamSystemHealthWorkspace({ authChecked, authenticated, onUnauthorized, onError }: PamSystemHealthProps) {
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
        else setError(failure instanceof Error ? failure.message : 'No se pudo cargar la salud de componentes PAM');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void load();
    return () => controller.abort();
  }, [authChecked, authenticated, onError, onUnauthorized]);

  return <section className="list-panel database-surface pam-platforms-panel" aria-label="Salud de componentes PAM">
    <div className="pam-platforms-heading">
      <div><h3>Salud de componentes</h3><p>Conectividad y versión de Portal, CPM y PSM/SSH observadas por CyberArk. Sin métricas de host ni secretos.</p></div>
      <span className="database-toolbar-count">{formatNumber(rows.length)} componentes</span>
    </div>
    <div className="pam-health-list">
      {loading ? <StateBlock variant="loading" title="Cargando salud de componentes…" />
        : error ? <StateBlock variant="error" title="No se pudo cargar la salud de componentes" hint={error} />
          : rows.length ? rows.map((component) => {
            const allConnected = component.total_count > 0 && component.connected_count === component.total_count;
            return <article className={`pam-health-item${allConnected ? ' is-healthy' : ' is-attention'}`} key={component.object_id}>
              <div className="pam-health-component"><Activity size={16} aria-hidden /><div><strong>{component.display_name}</strong><span>{component.description || 'Sin descripción'}</span></div></div>
              <div className="pam-health-fact"><span>Conectividad</span>{allConnected ? <strong className="status-pill status-active"><CheckCircle2 size={12} aria-hidden /> {formatNumber(component.connected_count)}/{formatNumber(component.total_count)}</strong> : <strong className="status-pill status-warning"><XCircle size={12} aria-hidden /> {formatNumber(component.connected_count)}/{formatNumber(component.total_count)}</strong>}</div>
              <div className="pam-health-fact"><span>Versiones</span><strong>{component.instance_versions.length ? component.instance_versions.join(', ') : 'Sin versión observada'}</strong></div>
              <div className="pam-health-fact"><span>Última observación</span><strong>{formatLastObserved(component.latest_logon_at)}</strong></div>
            </article>;
          }) : <StateBlock variant="empty" title="Todavía no hay componentes PAM sincronizados" />}
    </div>
    <p className="pam-platforms-note"><Activity size={13} aria-hidden /> Conteos agregados por tipo de componente (Portal, CPM, PSM/SSH); no atribuye IP, usuario técnico ni capacidad de host.</p>
  </section>;
}
