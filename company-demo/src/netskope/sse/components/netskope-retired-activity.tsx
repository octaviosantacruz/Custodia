import { useState } from 'react';
import { useNetskopePanel } from '../hooks/use-netskope-panel';
import { fetchNetskopeRetiredActivity } from '../lib/netskope-api';
import { formatNumber, relativeTime } from '../../../cross/lib/format';

/* The console counts a user as active when any reporting device carries their name, even if every
   account was deleted in Netskope. Custodia retires those identities, so they sit outside the card;
   this note keeps the gap visible and lists who they are (exact source_id/email match only). */
export function NetskopeRetiredActivity({ days, enabled, refreshKey, onUnauthorized }: { days: 7 | 14 | 30; enabled: boolean; refreshKey?: number; onUnauthorized: () => void }) {
  const [open, setOpen] = useState(false);
  const panel = useNetskopePanel({ cacheKey: ['retired-activity', days], enabled, refreshKey, onUnauthorized, load: (signal) => fetchNetskopeRetiredActivity(days, signal) });
  const total = panel.data?.total ?? 0;
  if (!total) return null;
  return <div className="netskope-retired-activity">
    <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      +{formatNumber(total)} {total === 1 ? 'usuario dado de baja' : 'usuarios dados de baja'} con equipos activos
    </button>
    {open ? <div className="netskope-retired-activity-list" role="region" aria-label="Usuarios dados de baja con equipos activos">
      <p>Todas sus cuentas están borradas en Netskope, pero sus equipos siguen reportando. La consola los cuenta como activos; el inventario no. Vínculo exacto por usuario o correo.</p>
      <ul>{panel.data?.rows.map((row) => <li key={row.object_id}>
        <strong>{row.display_name || row.source_id || `Usuario ${row.object_id}`}</strong>
        <span>{row.email && row.email !== row.display_name ? `${row.email} · ` : ''}{row.device_count} {row.device_count === 1 ? 'equipo' : 'equipos'}{row.latest_device ? ` · ${row.latest_device}` : ''}{row.latest_event ? ` · ${relativeTime(row.latest_event).toLowerCase()}` : ''}</span>
      </li>)}</ul>
    </div> : null}
  </div>;
}
