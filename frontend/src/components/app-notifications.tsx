import { AlertCircle, Check, X } from 'lucide-react';

type AppNotificationsProps = { error: string; notice: string; onDismissError: () => void; onDismissNotice: () => void };

export function AppNotifications({ error, notice, onDismissError, onDismissNotice }: AppNotificationsProps) {
  if (!error && !notice) return null;
  return <div className="app-notifications" aria-live="polite">
    {error && <div className="alert error" role="alert"><AlertCircle size={17} /><span>{error}</span><button className="alert-dismiss" type="button" aria-label="Cerrar error" title="Cerrar" onClick={onDismissError}><X size={15} /></button></div>}
    {notice && <div className="alert success" role="status"><Check size={17} /><span>{notice}</span><button className="alert-dismiss" type="button" aria-label="Cerrar aviso" title="Cerrar" onClick={onDismissNotice}><X size={15} /></button></div>}
  </div>;
}
