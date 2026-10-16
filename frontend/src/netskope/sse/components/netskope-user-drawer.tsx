import { useEffect, useRef, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UserRound, X } from 'lucide-react';
import { useDialogFocusTrap } from '../../../cross/hooks/use-dialog-focus-trap';
import { ApiError } from '../../../cross/lib/api';
import { DateTime } from '../../../cross/components/date-time';
import { StateBlock } from '../../../cross/components/state-block';
import { fetchNetskopeUci, fetchNetskopeUsers } from '../lib/netskope-api';
import { EMPTY_NETSKOPE_USERS_FILTERS } from '../lib/netskope-device-filters';
import { UCI_EXPLANATION, UCI_SCALE, UCI_RATING_LABELS, uciDelta, uciDeltaLabel } from '../lib/netskope-uci';
import { NetskopeUserDevices } from './netskope-user-devices';
import { NetskopeUserAnomalies } from './netskope-user-anomalies';
import './netskope-user-drawer.css';

export type NetskopeUserSelection = { userId: number | null; email: string; name: string };
type Props = { user: NetskopeUserSelection; refreshKey: number; canReadUba: boolean; onUnauthorized: () => void; onClose: () => void; fallbackFocusRef: RefObject<HTMLInputElement | null> };

export function NetskopeUserDrawer({ user, refreshKey, canReadUba, onUnauthorized, onClose, fallbackFocusRef }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogFocusTrap<HTMLDivElement>({ onClose, fallbackFocusRef, initialFocusRef: closeRef });
  const resolved = useQuery({
    queryKey: ['netskope', 'experience', 'exact-user', user.email, refreshKey],
    enabled: user.userId === null,
    queryFn: ({ signal }) => fetchNetskopeUsers(user.email, 0, EMPTY_NETSKOPE_USERS_FILTERS, signal),
    retry: false, staleTime: 60_000, refetchOnWindowFocus: false,
  });
  const confidence = useQuery({
    queryKey: ['netskope', 'uci', refreshKey], enabled: canReadUba,
    queryFn: ({ signal }) => fetchNetskopeUci(signal), retry: false, staleTime: 60_000, refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if ([resolved.error, confidence.error].some((error) => error instanceof ApiError && error.status === 401)) onUnauthorized();
  }, [resolved.error, confidence.error, onUnauthorized]);
  // A search can return names and partial emails. Only a complete, unique exact email is a usable identity.
  const matches = resolved.data?.rows.filter((row) => String(row.attributes.email || '').trim().toLowerCase() === user.email.trim().toLowerCase()) ?? [];
  const userId = user.userId ?? (resolved.data && resolved.data.total <= resolved.data.rows.length && matches.length === 1 ? matches[0].object_id : null);
  const reading = confidence.data?.rows?.find((row) => row.email.trim().toLowerCase() === user.email.trim().toLowerCase());
  return <div ref={dialogRef} className="drawer-layer" role="dialog" aria-modal="true" aria-labelledby="nsk-user-drawer-title" tabIndex={-1}>
    <button className="drawer-backdrop" type="button" aria-label="Cerrar ficha del usuario" onClick={onClose} />
    <aside className="detail-drawer nsk-user-drawer">
      <div className="detail-title">
        <div className="detail-icon"><UserRound size={18} aria-hidden /></div>
        <div className="detail-heading"><p className="eyebrow">FICHA DEL USUARIO</p><h2 id="nsk-user-drawer-title">{user.name}</h2><p>{user.email || 'Sin correo informado'}</p></div>
        <button ref={closeRef} type="button" className="icon-button" aria-label="Cerrar ficha" onClick={onClose}><X size={18} aria-hidden /></button>
      </div>
      {canReadUba ? <section className="detail-section nsk-user-confidence" aria-label="Índice de confianza del usuario">
        <h3>Índice de confianza</h3><p>{UCI_EXPLANATION} <strong>{UCI_SCALE}</strong></p>
        {confidence.isPending ? <StateBlock compact variant="loading" title="Leyendo el índice de confianza…" />
          : confidence.isError ? <StateBlock compact variant="error" title="No se pudo consultar el índice de confianza" action={<button className="button subtle" type="button" onClick={() => void confidence.refetch()}>Reintentar confianza</button>} />
          : reading ? <><p className="nsk-user-confidence-score"><strong>{reading.score} / 1000</strong> · Confianza {UCI_RATING_LABELS[reading.rating].toLowerCase()} · {uciDeltaLabel(uciDelta(reading))}</p>
            <p>Lectura: <DateTime value={reading.scored_at} /> · Cambio respecto de hace aproximadamente 7 días.</p></>
          : <p>Sin lectura de confianza para esta persona en la lista consultada. Su ausencia no confirma que esté libre de riesgo.</p>}
      </section> : null}
      {userId !== null ? <>
        <NetskopeUserDevices userId={userId} refreshKey={refreshKey} onUnauthorized={onUnauthorized} />
        {canReadUba ? <NetskopeUserAnomalies userId={userId} refreshKey={refreshKey} onUnauthorized={onUnauthorized} /> : null}
      </> : resolved.isPending ? <StateBlock variant="loading" title="Buscando la identidad exacta del usuario…" />
        : resolved.isError ? <StateBlock variant="error" title="No se pudo consultar la identidad" action={<button className="button subtle" type="button" onClick={() => void resolved.refetch()}>Reintentar identidad</button>} />
        : <StateBlock variant="empty" title="Sin una identidad única en el inventario" hint="No se pueden atribuir equipos o anomalías sin una coincidencia exacta y única por correo." />}
    </aside>
  </div>;
}
