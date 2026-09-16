import { useEffect, useState } from 'react';
import { AlertCircle, Bell, Check } from 'lucide-react';
import { usePopover } from '../hooks/use-popover';
import { formatNumber } from '../lib/format';
import type { IngestionRun } from '../types/ingestion';
import type { ActivityEvent } from '../lib/activity-events-api';

type NotificationMenuProps = {
  latestRun: IngestionRun | null;
  latestEvent: ActivityEvent | null;
  unreadEventCount: number;
  onEventsSeen: () => void;
};

const LAST_SEEN_RUN_KEY = 'dshub-notification:last-seen-run:v1';
const LEGACY_LAST_SEEN_RUN_KEY = 'openpam-last-seen-run-id';

function readLastSeenRunId(): string | null {
  try {
    const current = window.localStorage.getItem(LAST_SEEN_RUN_KEY);
    if (current) return current;
    const legacy = window.localStorage.getItem(LEGACY_LAST_SEEN_RUN_KEY);
    if (legacy) {
      window.localStorage.setItem(LAST_SEEN_RUN_KEY, legacy);
      window.localStorage.removeItem(LEGACY_LAST_SEEN_RUN_KEY);
    }
    return legacy;
  } catch {
    return null;
  }
}

function relativeTime(value: string | null): string {
  if (!value) return 'Sin actividad registrada';
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return 'Hace menos de un minuto';
  if (minutes < 60) return 'Hace ' + minutes + ' min';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return 'Hace ' + hours + (hours === 1 ? ' hora' : ' horas');
  const days = Math.floor(hours / 24);
  return 'Hace ' + days + (days === 1 ? ' día' : ' días');
}

export function NotificationMenu({
  latestRun,
  latestEvent,
  unreadEventCount,
  onEventsSeen,
}: NotificationMenuProps) {
  const { open, setOpen, ref } = usePopover<HTMLDivElement>();
  const completed = latestRun?.status === 'completed';
  const [lastSeenRunId, setLastSeenRunId] = useState<string | null>(readLastSeenRunId);
  const unseen = Boolean(latestRun && latestRun.run_id !== lastSeenRunId);
  useEffect(() => {
    if (!open || !latestRun) return;
    try {
      window.localStorage.setItem(LAST_SEEN_RUN_KEY, latestRun.run_id);
    } catch {
      // Notifications remain usable when storage is disabled or full.
    }
    setLastSeenRunId(latestRun.run_id);
  }, [open, latestRun]);
  useEffect(() => {
    if (open && unreadEventCount > 0) onEventsSeen();
  }, [onEventsSeen, open, unreadEventCount]);
  const hasLiveEvents = unreadEventCount > 0;
  return <div className="notification-wrap" ref={ref}>
    <button className={'icon-button notification-button ' + (open ? 'active' : '')} type="button" aria-label="Abrir notificaciones" aria-expanded={open} title="Notificaciones" onClick={() => setOpen((current) => !current)}>
      <Bell size={17} />{(unseen || hasLiveEvents) && <span className={'notification-dot ' + (hasLiveEvents || completed ? 'success' : 'warning')} />}
    </button>
    {open && <section className="notification-popover" aria-label="Notificaciones">
      <div className="notification-header"><strong>Notificaciones</strong><span>{unreadEventCount > 0 ? `${formatNumber(unreadEventCount)} actividad${unreadEventCount === 1 ? '' : 'es'} nueva${unreadEventCount === 1 ? '' : 's'}` : latestRun ? '1 actividad' : 'Sin actividad'}</span></div>
      {latestEvent ? <div className="notification-item success">
        <span className="notification-icon"><Check size={15} /></span>
        <div><strong>Datos actualizados</strong><span>{latestEvent.actor_name} · {relativeTime(latestEvent.created_at)}</span></div>
      </div> : null}
      {latestRun ? <div className={'notification-item ' + (completed ? 'success' : 'warning')}>
        <span className="notification-icon">{completed ? <Check size={15} /> : <AlertCircle size={15} />}</span>
        <div><strong>Sincronización {completed ? 'completada' : latestRun.status}</strong><span>{relativeTime(latestRun.completed_at || latestRun.started_at)} · {formatNumber(latestRun.received_safe_count)} safes inventariados</span></div>
      </div> : <p className="notification-empty">Todavía no hay sincronizaciones registradas.</p>}
    </section>}
  </div>;
}
