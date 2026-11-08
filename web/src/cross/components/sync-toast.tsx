import { AlertCircle, Check, LoaderCircle } from 'lucide-react';
import type { SyncToast as SyncToastState } from '../hooks/use-ingestion';
import { syncToolMeta, syncToolsForSources } from '../lib/sync-source';
import './sync-toast.css';

type SyncToastProps = { state: SyncToastState; leaving?: boolean; elapsedSeconds: number; formatElapsed: (seconds: number) => string; onOpenActivity?: () => void };

function sourceMeta(source: string) {
  return syncToolMeta(source);
}

function SourceImage({ source, image }: { source: string; image?: string }) {
  if (source === 'netskope') return <>
    <img className="sync-toast-logo-dark" src="/netskope-full-lime.png" alt="" />
    <img className="sync-toast-logo-light" src="/netskope-full-black.png" alt="" />
  </>;
  return image ? <img src={image} alt="" /> : null;
}

function SourceIdentity({ source }: { source: string }) {
  const meta = sourceMeta(source);
  return <span className="sync-toast-source" title={meta.label}>
    <span className="sync-toast-source-mark" aria-hidden="true">
      {meta.image ? <SourceImage source={source} image={meta.image} /> : meta.fallback}
    </span>
    <span>{meta.label}</span>
  </span>;
}

function SourceSummary({ sources }: { sources: string[] }) {
  const tools = syncToolsForSources(sources);
  if (!tools.length) return <span className="sync-toast-source-summary">Custodia · Sincronización</span>;
  return <div className="sync-toast-source-list" role="group" aria-label="Herramientas de la sincronización">
    {tools.map((tool) => <SourceIdentity key={tool} source={tool} />)}
  </div>;
}

function SyncStatusIcon({ state }: { state: SyncToastState }) {
  const tools = syncToolsForSources(state.sources);
  const singleSource = tools.length === 1 ? sourceMeta(tools[0]) : null;
  return <div className="sync-toast-icon">
    {state.tone === 'running' ? <LoaderCircle size={18} className="spin" /> : singleSource?.image ? <SourceImage source={tools[0]} image={singleSource.image} /> : state.tone === 'success' ? <Check size={18} /> : <AlertCircle size={18} />}
  </div>;
}

export function SyncToast({ state, leaving = false, elapsedSeconds, formatElapsed, onOpenActivity }: SyncToastProps) {
  return <div className={'sync-toast ' + state.tone + (leaving ? ' is-leaving' : '')} role="status" aria-live="polite" aria-atomic="true">
    <SyncStatusIcon state={state} />
    <div className="sync-toast-copy"><SourceSummary sources={state.sources} /><strong>{state.title}</strong><span>{state.detail}{state.tone === 'running' && ` Activa hace ${formatElapsed(elapsedSeconds)}. Podés seguir navegando.`}</span>{onOpenActivity && <button type="button" className="sync-toast-link" onClick={onOpenActivity}>Ver sincronizaciones</button>}</div>
  </div>;
}
