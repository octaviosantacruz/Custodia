import './netskope-uci.css';
import { DateTime } from '../../../cross/components/date-time';
import { BarCell } from '../../../cross/components/bar-cell';
import { HelpHint } from '../../../cross/components/help-hint';
import { StateBlock } from '../../../cross/components/state-block';
import { formatNumber } from '../../../cross/lib/format';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../../../cross/lib/api';
import { fetchNetskopeUciCompanies } from '../lib/netskope-api';
import { UCI_EXPLANATION, UCI_SCALE, uciRiskChange, uciRiskChangeLabel, uciRiskLabel, uciRiskShare } from '../lib/netskope-uci';
import { t, localeTag } from '../../../cross/i18n/index.ts';

type Props = { refreshKey: number; enabled: boolean; onUnauthorized: () => void; onReview: (company: string) => void };

/** Which companies have the largest share of users with a Poor or Moderate UCI. */
export function NetskopeUciCompanies({ refreshKey, enabled, onUnauthorized, onReview }: Props) {
  const panel = useQuery({ queryKey: ['netskope', 'uci', 'companies', refreshKey], enabled,
    queryFn: ({ signal }) => fetchNetskopeUciCompanies(signal), retry: false, staleTime: 60_000, refetchOnWindowFocus: false });
  useEffect(() => { if (panel.error instanceof ApiError && panel.error.status === 401) onUnauthorized(); }, [panel.error, onUnauthorized]);
  const data = panel.data;
  if (!data) {
    return panel.error
      ? <StateBlock compact variant="error" title={t('No se pudo leer el riesgo por empresa')} action={<button type="button" className="button subtle" onClick={() => void panel.refetch()}>{t('Reintentar')}</button>} />
      : <StateBlock compact variant="loading" title={t('Leyendo riesgo por empresa…')} />;
  }
  if (!data.companies?.length) return <StateBlock compact variant="empty" title={t('Sin empresas para comparar')} hint="No hay usuarios activos con correo en la consulta." />;
  return <section className="netskope-uci-companies" aria-label={t('Riesgo por empresa')}>
    <div className="section-title"><h2>{t('Usuarios con señales de riesgo por empresa')}</h2><HelpHint label={t('Por empresa')}><p>Proporción de usuarios activos con correo y confianza baja o moderada según Netskope. Es el porcentaje de usuarios a revisar, no un promedio de puntaje. La variación compara con el conteo semanal guardado (solo cantidades por empresa). Se expresa en puntos porcentuales (pp): si aumenta, hay una mayor proporción de cuentas a revisar.</p><p>{UCI_EXPLANATION} {UCI_SCALE}</p></HelpHint></div>
    <p className="netskope-uci-note">{t('Usuarios con confianza baja o moderada sobre el total de usuarios activos con correo. No es un promedio de puntaje.')}</p>
    <p className="netskope-uci-note">{t('Consulta actual:')} <DateTime value={new Date(panel.dataUpdatedAt).toISOString()} /> · Comparación: {data.previous_week ? <>{t('semana del')} <time dateTime={data.previous_week}>{new Intl.DateTimeFormat(localeTag(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${data.previous_week}T00:00:00Z`))}</time></> : 'Sin semana previa disponible'}.</p>
    <table className="compact-table">
      <thead><tr><th scope="col">{t('Empresa')}</th><th scope="col">{t('Usuarios')}</th><th scope="col">{t('Confianza baja')}</th><th scope="col">{t('Confianza moderada')}</th><th scope="col">{t('A revisar')}</th><th scope="col">{t('Cambio de la proporción a revisar')}</th></tr></thead>
      <tbody>{data.companies.map((company) => {
        const change = uciRiskChange(company);
        return <tr key={company.company}>
        <th scope="row"><span className="cell-lead">{company.company}</span></th>
        <td>{formatNumber(company.users)}</td>
        <td>{formatNumber(company.poor)}</td>
        <td>{formatNumber(company.moderate)}</td>
        <td>{company.poor + company.moderate > 0
          ? <button type="button" className="netskope-uci-review" aria-label={`Revisar a las ${formatNumber(company.poor + company.moderate)} personas de ${company.company}`} onClick={() => onReview(company.company)}>
            <BarCell label={`${formatNumber(company.poor + company.moderate)} de ${formatNumber(company.users)} · ${uciRiskLabel(company)}`} share={uciRiskShare(company)} />
          </button>
          : <BarCell label={`0 de ${formatNumber(company.users)} · ${uciRiskLabel(company)}`} share={uciRiskShare(company)} />}</td>
        <td className={change === null ? 'netskope-uci-empty' : undefined}>{change === null || change === 0 ? uciRiskChangeLabel(change) : `${change > 0 ? t('Aumenta') : t('Disminuye')} ${uciRiskChangeLabel(change)}`}</td>
      </tr>;
      })}</tbody>
    </table>
    {panel.isError ? <p className="netskope-uci-note" role="status">No se pudo actualizar la comparación; se conserva la consulta anterior. <button className="button subtle" type="button" onClick={() => void panel.refetch()}>{t('Reintentar')}</button></p> : null}
    {data.omitted_users > 0 ? <p className="netskope-uci-note">Otras empresas: {formatNumber(data.omitted_users)} usuarios.</p> : null}
  </section>;
}
