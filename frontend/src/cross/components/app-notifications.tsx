import { useEffect } from 'react';
import { AlertCircle, Check, X } from 'lucide-react';
import { usePresence } from '../hooks/use-presence';
import { presentNotice, syncToolForSource, syncToolMeta } from '../lib/sync-source';

// Must match the duration of `toast-exit` in styles.css.
export const TOAST_EXIT_MS = 260;

type AppNotificationsProps = { error: string; notice: string; noticeSource?: string | null; onDismissError: () => void; onDismissNotice: () => void };

function NoticeIcon({ notice, source }: { notice: string; source: string | null }) {
  const meta = syncToolMeta(syncToolForSource(presentNotice(notice, source).source));

  return <span className="app-toast-icon" aria-hidden="true">
    {meta.image ? <img className="app-toast-source-image" src={meta.image} alt="" /> : <Check size={17} />}
  </span>;
}

function NoticeCopy({ notice, source }: { notice: string; source: string | null }) {
  const copy = presentNotice(notice, source);
  return <div className="app-toast-body">
    <small>{copy.eyebrow}</small>
    <strong>{copy.title}</strong>
    {copy.detail ? <span className="app-toast-detail">{copy.detail}</span> : null}
  </div>;
}

export function AppNotifications({ error, notice, noticeSource = null, onDismissError, onDismissNotice }: AppNotificationsProps) {
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(onDismissNotice, 4800);
    return () => window.clearTimeout(timeout);
  }, [notice, onDismissNotice]);

  const errorPresence = usePresence(error, TOAST_EXIT_MS);
  const noticePresence = usePresence(notice, TOAST_EXIT_MS);
  const shownError = errorPresence.current;
  const shownNotice = noticePresence.current;

  if (!shownError && !shownNotice) return null;
  return <div className="app-notifications" aria-live="polite">
    {shownError && <div className={'alert error app-toast' + (errorPresence.leaving ? ' is-leaving' : '')} role="alert"><span className="app-toast-icon" aria-hidden="true"><AlertCircle size={17} /></span><div className="app-toast-body"><small>DS HUB · ATENCIÓN</small><strong>{shownError}</strong></div><button className="alert-dismiss" type="button" aria-label="Cerrar error" title="Cerrar" onClick={onDismissError} disabled={errorPresence.leaving}><X size={15} /></button></div>}
    {shownNotice && <div key={shownNotice} className={'alert success app-toast app-toast-notice' + (noticePresence.leaving ? ' is-leaving' : '')} role="status"><NoticeIcon notice={shownNotice} source={noticeSource} /><NoticeCopy notice={shownNotice} source={noticeSource} /><button className="alert-dismiss" type="button" aria-label="Cerrar aviso" title="Cerrar" onClick={onDismissNotice} disabled={noticePresence.leaving}><X size={15} /></button></div>}
  </div>;
}
