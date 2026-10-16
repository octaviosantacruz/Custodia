import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { NetskopeAttentionRow } from '../types/netskope';
import { DateTime } from '../../../cross/components/date-time';
import { StateBlock } from '../../../cross/components/state-block';
import { PERFORMANCE_EXPLANATION, PERFORMANCE_SCALE } from '../lib/netskope-user-score';
import { HelpHint } from '../../../cross/components/help-hint';
import { StatusBadge } from '../../../cross/components/semantic';
import { ApiError } from '../../../cross/lib/api';
import { formatNumber } from '../../../cross/lib/format';
import { fetchNetskopeAttention } from '../lib/netskope-api';
import { UCI_EXPLANATION, UCI_SCALE, UCI_CHANGE_EXPLANATION, UCI_RATING_LABELS, uciDelta, uciDeltaLabel } from '../lib/netskope-uci';
import './netskope-attention-queue.css';

type Props = { enabled: boolean; refreshKey: number; onUnauthorized: () => void; onPick: (row: NetskopeAttentionRow) => void };

/** Users to look at first: low/moderate UCI and the lowest ADEM scores in one list. Hidden without netskope:uba_read. */
export function NetskopeAttentionQueue({ enabled, refreshKey, onUnauthorized, onPick }: Props) {
  const query = useQuery({
    queryKey: ['netskope', 'experience', 'attention', refreshKey],
    enabled,
    queryFn: ({ signal }) => fetchNetskopeAttention(signal),
    retry: false, staleTime: 60_000, refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401) onUnauthorized();
  }, [query.error, onUnauthorized]);

  if (query.isPending) return <StateBlock variant="loading" title="Leyendo usuarios para revisar…" />;
  if (query.isError) return <StateBlock variant="error" title="No se pudieron leer los usuarios para revisar" action={<button type="button" className="button subtle" onClick={() => void query.refetch()}>Reintentar revisión</button>} />;
  const { rows, adem_available: ademAvailable } = query.data;
  return <section className="list-panel database-surface nsk-attention" aria-label="Usuarios para revisar">
    <div className="nsk-attention-head">
      <h2>Usuarios para revisar</h2>
      <HelpHint label="Usuarios para revisar"><p>Primero aparecen las personas listadas por ambas fuentes, luego confianza baja, moderada y solo rendimiento. Coincidir en ambas fuentes no confirma un incidente.</p><p>El índice de confianza (UCI, User Confidence Index) resume señales de riesgo. {UCI_CHANGE_EXPLANATION}</p><p>El rendimiento viene de ADEM (Autonomous Digital Experience Management). {PERFORMANCE_EXPLANATION}</p></HelpHint>
      {!ademAvailable ? <StatusBadge tone="warning">Rendimiento no disponible</StatusBadge> : null}
    </div>
    <p className="nsk-attention-explanation">Hasta 50 personas para revisar. Rendimiento: últimas 24 h, entre los 100 menores puntajes informados por Netskope; no representa a toda la organización ni confirma una falla. Sin dato significa que la fuente no listó a esa persona.</p>
    <div className="nsk-attention-scales"><p><strong>Índice de confianza.</strong> {UCI_SCALE}</p><p><strong>Rendimiento digital.</strong> {PERFORMANCE_SCALE}</p></div>
    <p className="nsk-attention-explanation">Última consulta: <DateTime value={new Date(query.dataUpdatedAt).toISOString()} />. Confianza: última captura disponible; el cambio compara lecturas separadas por aproximadamente 7 días.</p>
    {!rows.length ? <StateBlock compact variant="empty" title="Sin usuarios en la lista de revisión" hint="Las fuentes consultadas no listaron personas; esto no confirma la ausencia de riesgo o de fallas." /> : <div className="compact-table-wrap"><table className="compact-table">
      <caption className="sr-only">Usuarios para revisar, los que figuran en ambas fuentes primero</caption>
      <thead><tr><th scope="col">Usuario</th><th scope="col">Motivo de revisión</th><th scope="col">Índice de confianza <HelpHint label="Índice de confianza"><p>{UCI_EXPLANATION}</p><p>{UCI_SCALE}</p></HelpHint></th><th scope="col">Cambio de confianza</th><th scope="col">Rendimiento digital <HelpHint label="Rendimiento digital"><p>{PERFORMANCE_EXPLANATION} {PERFORMANCE_SCALE}</p></HelpHint></th></tr></thead>
      <tbody>{rows.map((row) => {
        const delta = uciDelta({ score: row.uci_score ?? 0, previous_score: row.uci_previous });
        return <tr key={row.email}>
          <th scope="row"><button type="button" className="nsk-attention-user" onClick={() => onPick(row)}>
            <strong>{row.name || row.email}</strong>{row.name ? <small>{row.email}</small> : null}
          </button></th>
          <td><span className="nsk-attention-reasons">{row.reasons.includes('uci') ? <span>Confianza {row.uci_rating === 'Poor' ? 'baja' : 'moderada'}</span> : null}{row.reasons.includes('adem') ? <span>Entre los menores puntajes de rendimiento</span> : null}</span></td>
          <td>{row.uci_rating && row.uci_score !== null
            ? <span className="nsk-attention-uci"><StatusBadge tone={row.uci_rating === 'Poor' ? 'danger' : 'warning'}>{UCI_RATING_LABELS[row.uci_rating]}</StatusBadge> {formatNumber(row.uci_score)}</span>
            : <span className="nsk-attention-empty">Sin dato</span>}</td>
          <td>{row.uci_score !== null && row.uci_previous !== null ? uciDeltaLabel(delta) : <span className="nsk-attention-empty">Sin dato</span>}</td>
          <td>{row.adem_score !== null ? formatNumber(Math.round(row.adem_score)) : <span className="nsk-attention-empty">Sin dato</span>}</td>
        </tr>;
      })}</tbody>
    </table></div>}
  </section>;
}
