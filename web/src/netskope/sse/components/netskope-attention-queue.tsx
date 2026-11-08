import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import type { NetskopeAttentionRow } from '../types/netskope';
import { DateTime } from '../../../cross/components/date-time';
import { StateBlock } from '../../../cross/components/state-block';
import { HelpHint } from '../../../cross/components/help-hint';
import { StatusBadge } from '../../../cross/components/semantic';
import { ApiError } from '../../../cross/lib/api';
import { formatNumber } from '../../../cross/lib/format';
import { fetchNetskopeAttention } from '../lib/netskope-api';
import { UCI_EXPLANATION, UCI_SCALE, UCI_CHANGE_EXPLANATION, UCI_RATING_LABELS, uciDelta, uciDeltaLabel } from '../lib/netskope-uci';
import './netskope-attention-queue.css';
import { t } from '../../../cross/i18n/index.ts';

type Props = { company: string; onClearCompany: () => void; enabled: boolean; refreshKey: number; onUnauthorized: () => void; onPick: (row: NetskopeAttentionRow) => void };

/** People with low or moderate UCI, lowest first. Hidden without netskope:uba_read. Performance (ADEM) has its own
    view, Rendimiento: a person listed only for a low score is not a risk signal and does not appear here. */
export function NetskopeAttentionQueue({ company, onClearCompany, enabled, refreshKey, onUnauthorized, onPick }: Props) {
  const query = useQuery({
    queryKey: ['netskope', 'experience', 'attention', refreshKey, company],
    enabled,
    queryFn: ({ signal }) => fetchNetskopeAttention(signal, company),
    retry: false, staleTime: 60_000, refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401) onUnauthorized();
  }, [query.error, onUnauthorized]);

  if (query.isPending) return <StateBlock variant="loading" title={t('Leyendo personas para revisar…')} />;
  if (query.isError) return <StateBlock variant="error" title={t('No se pudieron leer las personas para revisar')} action={<button type="button" className="button subtle" onClick={() => void query.refetch()}>{t('Reintentar revisión')}</button>} />;
  const { rows } = query.data;
  return <section className="list-panel database-surface nsk-attention" aria-label={t('Personas para revisar')}>
    <div className="nsk-attention-head">
      <h2>{t('Personas para revisar')}</h2>
      <HelpHint label={t('Personas para revisar')}><p>Confianza baja primero, luego moderada; dentro de cada una, el menor índice primero. Una señal de riesgo no confirma un incidente.</p><p>El índice de confianza (UCI, User Confidence Index) resume señales de riesgo. {UCI_CHANGE_EXPLANATION}</p><p>{t('El rendimiento de equipos, red y aplicaciones está en la vista «Rendimiento».')}</p></HelpHint>
      {company ? <button type="button" className="button subtle nsk-attention-company" onClick={onClearCompany} aria-label={`Quitar filtro de empresa ${company}`}>Empresa: {company} <X size={12} aria-hidden /></button> : null}
    </div>
    <p className="nsk-attention-explanation">{t('Hasta 50 personas. Última consulta:')} <DateTime value={new Date(query.dataUpdatedAt).toISOString()} />.</p>
    {!rows.length ? <StateBlock compact variant="empty" title={company ? `Sin personas para revisar en ${company}` : 'Sin personas en la lista de revisión'} hint="Netskope no listó personas con confianza baja o moderada; esto no confirma la ausencia de riesgo." /> : <div className="compact-table-wrap"><table className="compact-table">
      <caption className="sr-only">{t('Personas para revisar, menor confianza primero')}</caption>
      <thead><tr><th scope="col">{t('Usuario')}</th><th scope="col">{t('Índice de confianza')} <HelpHint label={t('Índice de confianza')}><p>{UCI_EXPLANATION}</p><p>{UCI_SCALE}</p></HelpHint></th><th scope="col">{t('Cambio de confianza')}</th></tr></thead>
      <tbody>{rows.map((row) => {
        const delta = uciDelta({ score: row.uci_score ?? 0, previous_score: row.uci_previous });
        return <tr key={row.email}>
          <th scope="row"><button type="button" className="nsk-attention-user" onClick={() => onPick(row)}>
            <strong>{row.name || row.email}</strong>{row.name ? <small>{row.email}</small> : null}
          </button></th>
          <td>{row.uci_rating && row.uci_score !== null
            ? <span className="nsk-attention-uci"><StatusBadge tone={row.uci_rating === 'Poor' ? 'danger' : 'warning'}>{UCI_RATING_LABELS[row.uci_rating]}</StatusBadge> {formatNumber(row.uci_score)}</span>
            : <span className="nsk-attention-empty">{t('Sin dato')}</span>}</td>
          <td>{row.uci_score !== null && row.uci_previous !== null ? uciDeltaLabel(delta) : <span className="nsk-attention-empty">{t('Sin dato')}</span>}</td>
        </tr>;
      })}</tbody>
    </table></div>}
  </section>;
}
