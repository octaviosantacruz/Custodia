import { AlertCircle, Check, LoaderCircle } from 'lucide-react';
import type { SyncToast as SyncToastState } from '../hooks/use-ingestion';

type SyncToastProps = { state: SyncToastState; elapsedSeconds: number; formatElapsed: (seconds: number) => string };

export function SyncToast({ state, elapsedSeconds, formatElapsed }: SyncToastProps) {
  return <aside className={'sync-toast ' + state.tone} role="status" aria-live="polite" aria-atomic="true">
    <div className="sync-toast-icon">{state.tone === 'running' ? <LoaderCircle size={18} className="spin" /> : state.tone === 'success' ? <Check size={18} /> : <AlertCircle size={18} />}</div>
    <div className="sync-toast-copy"><strong>{state.title}</strong><span>{state.detail}{state.tone === 'running' && ` Tiempo transcurrido: ${formatElapsed(elapsedSeconds)}. Podés seguir navegando mientras la corrida continúa.`}</span></div>
  </aside>;
}
