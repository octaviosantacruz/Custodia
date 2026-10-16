import { formatNumber } from '../lib/format';
import { pageVolumeByUtcDay } from '../lib/page-volume';
import { HelpHint } from './help-hint';
import './page-volume-histogram.css';

export function PageVolumeHistogram({
  timestamps, title, help, state = 'ready',
}: {
  timestamps: readonly string[];
  title: string;
  help: string;
  state?: 'loading' | 'error' | 'ready';
}) {
  const buckets = pageVolumeByUtcDay(timestamps);
  const max = Math.max(0, ...buckets.map((bucket) => bucket.count));
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  return <section className="page-volume" aria-label={title}>
    <div className="page-volume-heading"><strong>{title}</strong>{state === 'ready' ? <span>{formatNumber(total)} registros en esta página</span> : null}<HelpHint label={title}><p>{help}</p></HelpHint></div>
    {state === 'loading' ? <span className="page-volume-state" role="status">Actualizando volumen de esta página…</span>
      : state === 'error' ? <span className="page-volume-state" role="status">Volumen no disponible; falló la carga de la tabla.</span>
        : buckets.length ? <div className="page-volume-bars" role="img" aria-label={`${title}: ${buckets.map((bucket) => `${bucket.day}, ${bucket.count}`).join('; ')}`}>
      {buckets.map((bucket) => <div className="page-volume-day" key={bucket.day} title={`${bucket.day}: ${formatNumber(bucket.count)}`}>
        <span className="page-volume-count">{formatNumber(bucket.count)}</span>
        <span className="page-volume-track" aria-hidden="true"><span style={{ height: `${Math.max(6, (bucket.count / max) * 100)}%` }} /></span>
        <time dateTime={bucket.day}>{bucket.day.slice(5)}</time>
      </div>)}
    </div> : <span className="page-volume-empty">Sin registros en la página cargada</span>}
  </section>;
}
