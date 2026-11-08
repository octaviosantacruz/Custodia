import { CategoryChart } from '../../../cross/components/category-chart';
import { DateTime } from '../../../cross/components/date-time';
import { StateBlock } from '../../../cross/components/state-block';
import { formatNumber } from '../../../cross/lib/format';
import type { ChartMode } from '../../../cross/lib/chart-mode';
import { useNetskopePanel } from '../hooks/use-netskope-panel';
import { fetchNetskopeAaChart } from '../lib/netskope-api';
import { NETSKOPE_AA_PREFIX } from '../lib/netskope-dashboard';

type Props = { widgetId: string; mode: ChartMode; enabled: boolean; refreshKey?: number; onUnauthorized: () => void };

/** One tenant-declared Advanced Analytics chart; only mounted for a selected block, no database fallback. */
export function NetskopeAaChart({ widgetId, mode, enabled, refreshKey, onUnauthorized }: Props) {
  const key = widgetId.slice(NETSKOPE_AA_PREFIX.length);
  const panel = useNetskopePanel({ cacheKey: ['aa', 'chart', key], enabled, refreshKey, onUnauthorized, load: (signal) => fetchNetskopeAaChart(key, signal) });
  const chart = panel.data;
  return <>
    <div className="personal-chart-heading">
      <span className="metric-label">{chart?.title ?? 'Gráfico Advanced Analytics'}</span>
      {chart ? <small>{chart.period} · {chart.unit}</small> : null}
    </div>
    {panel.error ? <StateBlock variant="error" title="No se pudo consultar Advanced Analytics" hint={panel.error} action={<button className="button subtle" type="button" onClick={() => void panel.reload()}>Reintentar</button>} />
      : !chart ? <StateBlock variant="loading" title="Consultando Advanced Analytics…" />
      : chart.state === 'empty' ? <StateBlock title="El widget AA no devolvió filas" hint="No hay un conteo disponible para este gráfico." />
      : <>
        <CategoryChart title={chart.title} mode={mode} buckets={chart.buckets} population={chart.total} populationLabel={chart.unit} limit={100} centerLabel="total" />
        <small>{formatNumber(chart.total ?? 0)} {chart.unit} · Consultado <DateTime value={chart.fetched_at} />{panel.loading ? ' · Actualizando…' : ''}</small>
      </>}
  </>;
}
