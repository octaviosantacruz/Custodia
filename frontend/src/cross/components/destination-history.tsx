import { useQuery } from '@tanstack/react-query';
import { fetchConnectionHistory } from '../lib/connection-inventory-api';
import { describeChange } from '../lib/connection-work';
import { dateTimeHint, formatDate } from '../lib/format';

/** Who changed what on one destination, newest first; it follows the destination across imports. */
export function DestinationHistory({ inventoryId, stamp }: { inventoryId: number; stamp: string }) {
  const query = useQuery({ queryKey: ['cross', 'connection-history', inventoryId, stamp], queryFn: ({ signal }) => fetchConnectionHistory(inventoryId, signal) });
  if (query.isLoading) return <span className="muted" role="status">Cargando historial…</span>;
  if (query.error) return <span className="muted" role="alert">No se pudo cargar el historial.</span>;
  const events = query.data ?? [];
  if (!events.length) return <span className="muted">Sin cambios manuales registrados.</span>;
  return <ul className="destination-history">
    {events.slice(0, 8).map((event, index) => <li key={`${event.created_at}-${index}`}>
      <span>{describeChange(event.before_data, event.after_data).join(' · ')}</span>
      <span className="muted">{event.actor_id} · <time dateTime={event.created_at} title={dateTimeHint(event.created_at)}>{formatDate(event.created_at)}</time></span>
    </li>)}
  </ul>;
}
