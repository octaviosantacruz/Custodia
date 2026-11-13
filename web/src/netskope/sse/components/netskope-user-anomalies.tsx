import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from '../../../cross/components/date-time';
import { HelpHint } from '../../../cross/components/help-hint';
import { StateBlock } from '../../../cross/components/state-block';
import { StatusBadge } from '../../../cross/components/semantic';
import { ApiError } from '../../../cross/lib/api';
import { formatNumber } from '../../../cross/lib/format';
import { fetchNetskopeUserAnomalies } from '../lib/netskope-api';
import { ANOMALY_SEVERITIES, ANOMALY_SEVERITY_LABELS, ANOMALY_SEVERITY_TONES, scenarioLabel } from '../lib/netskope-anomalies';
import './netskope-user-anomalies.css';
import { t } from '../../../cross/i18n/index.ts';

type Props = { userId: number; refreshKey?: number; onUnauthorized?: () => void };

/** UEBA anomalies of the selected user, most severe first. Hidden without netskope:uba_read. */
export function NetskopeUserAnomalies({ userId, refreshKey = 0, onUnauthorized }: Props) {
  const query = useQuery({
    queryKey: ['netskope', 'experience', 'user-anomalies', userId, refreshKey],
    queryFn: ({ signal }) => fetchNetskopeUserAnomalies(userId, signal),
    retry: false, staleTime: 60_000, refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401) onUnauthorized?.();
  }, [query.error, onUnauthorized]);

  if (query.isError && query.error instanceof ApiError && query.error.status === 403) return null;
  if (query.isPending) return <StateBlock compact variant="loading" title={t('Leyendo anomalías del usuario…')} />;
  if (query.isError) return <StateBlock compact variant="error" title={t('No se pudieron leer las anomalías')} action={<button type="button" className="button subtle" onClick={() => void query.refetch()}>{t('Reintentar')}</button>} />;
  const data = query.data;
  return <section className="nsk-user-anomalies" aria-label={t('Anomalías del usuario')}>
    <div className="nsk-user-anomalies-head">
      <h3>{t('Anomalías')}</h3>
      <span className="nsk-user-anomalies-window">{t('{window_days} días', { window_days: data.window_days })}</span>
      <HelpHint label={t('Anomalías')}><p>Detecciones UEBA de Netskope para este usuario. Netskope entrega hasta 30 días y 1000 filas; no se guardan en Custodia.</p></HelpHint>
    </div>
    {data.total === 0 ? <p className="nsk-user-anomalies-empty">{t('Sin anomalías en {window_days} días.', { window_days: data.window_days })}</p> : <>
      <ul className="nsk-user-anomalies-counts" aria-label={t('Anomalías por severidad')}>
        {ANOMALY_SEVERITIES.filter((key) => data.by_severity[key] > 0).map((key) => <li key={key}>
          <StatusBadge tone={ANOMALY_SEVERITY_TONES[key]}>{ANOMALY_SEVERITY_LABELS[key]}</StatusBadge> <strong>{formatNumber(data.by_severity[key])}</strong>
        </li>)}
      </ul>
      {data.truncated ? <p className="nsk-user-anomalies-note" role="status">{t('Se analizan {returned} de {total}.', { returned: formatNumber(data.returned), total: formatNumber(data.total) })}</p> : null}
      <div className="compact-table-wrap"><table className="compact-table">
        <caption className="sr-only">{t('Anomalías más graves y recientes')}</caption>
        <thead><tr><th scope="col">{t('Severidad')}</th><th scope="col">{t('Escenario')}</th><th scope="col">{t('Regla')}</th><th scope="col">{t('Actividad')}</th><th scope="col">{t('Cuándo')}</th></tr></thead>
        <tbody>{data.recent.map((item, index) => <tr key={index}>
          <td><StatusBadge tone={ANOMALY_SEVERITY_TONES[item.severity]}>{ANOMALY_SEVERITY_LABELS[item.severity]}</StatusBadge></td>
          <td>{scenarioLabel(item.scenario, item.sub_scenario)}</td>
          <td>{item.rule || <span className="nsk-user-anomalies-empty">{t('Sin dato')}</span>}</td>
          <td>{item.activity || <span className="nsk-user-anomalies-empty">{t('Sin dato')}</span>}</td>
          <td>{item.time ? <DateTime value={item.time} /> : <span className="nsk-user-anomalies-empty">{t('Sin dato')}</span>}</td>
        </tr>)}</tbody>
      </table></div>
    </>}
  </section>;
}
