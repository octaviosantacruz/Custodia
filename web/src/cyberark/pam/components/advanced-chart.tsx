import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { formatChartTickLabels } from '../../../cross/lib/format';
import { workflowLabel } from '../lib/safe-labels';
import { chartAnimationMs } from '../lib/chart-animation';
import { prefersReducedMotion } from '../../../cross/lib/motion';
import { advancedChartTable } from '../lib/advanced-chart-rows';
import { advancedChartPalette, advancedChartTooltip } from '../lib/advanced-chart-palette';
import './advanced-chart.css';
import type { DashboardChartData, DashboardChartStyle } from '../lib/dashboard-metrics';
import { t } from '../../../cross/i18n/index.ts';

function subscribeTheme(notify: () => void) {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}
const readTheme = () => document.documentElement.dataset.theme ?? 'dark';

type Props = {
  title: string;
  style: Extract<DashboardChartStyle, 'line' | 'heatmap' | 'scatter' | 'combo'>;
  data?: DashboardChartData;
  onSelect?: (filterValue: string) => void;
};

export function AdvancedChart({ title, style, data, onSelect }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => 'dark');
  /* FE-MOTION-001: persists across the effect's data-driven re-runs, so only
     the first setOption of this instance can animate. */
  const hasAnimated = useRef(false);
  const hasData = Boolean(data?.series?.some((series) => series.values.length) || data?.points?.length || data?.cells?.length);
  const description = useMemo(() => {
    if (style === 'scatter') return t('{title}. Eje X: cuentas; eje Y: miembros.', { title: title });
    if (style === 'heatmap') return t('{title}. Intensidad por las dos dimensiones del cruce.', { title: title });
    return `${title}. ${data?.series?.map((series) => series.label).join(t(' y ')) || 'Serie temporal'}.`;
  }, [data?.series, style, title]);

  useEffect(() => {
    if (!chartRef.current || !hasData) return;
    let disposed = false;
    let cleanup = () => {};
    const engine = style === 'heatmap'
      ? import('../lib/advanced-chart-engine-heatmap')
      : style === 'scatter'
        ? import('../lib/advanced-chart-engine-scatter')
        : style === 'combo'
          ? import('../lib/advanced-chart-engine-combo')
          : import('../lib/advanced-chart-engine-line');
    void engine.then(({ initAdvancedChart }) => {
      if (disposed || !chartRef.current) return;
      const root = chartRef.current;
      const computed = getComputedStyle(root);
      const palette = advancedChartPalette(computed);
      const { text, border, accent } = palette;
      const common = {
        /* ECharts would replace this element's Spanish aria-label with an English one: keep ours, keep the decal patterns. */
        aria: { enabled: true, label: { enabled: false }, decal: { show: true } },
        textStyle: { color: text, fontFamily: 'Inter, system-ui, sans-serif', fontSize: 10 },
        tooltip: { trigger: style === 'scatter' || style === 'heatmap' ? 'item' : 'axis', ...advancedChartTooltip(palette) },
        grid: { left: 42, right: 20, top: 34, bottom: 42, containLabel: true },
      };
      let option: Record<string, unknown>;
      if (style === 'scatter') {
        option = { ...common, xAxis: { name: 'Cuentas', splitLine: { lineStyle: { color: border } } }, yAxis: { name: 'Miembros', splitLine: { lineStyle: { color: border } } }, series: [{ type: 'scatter', symbolSize: 10, itemStyle: { color: accent }, data: (data?.points ?? []).map((point) => ({ value: [point.x, point.y], name: point.label, filterValue: point.filter_value })) }] };
      } else if (style === 'heatmap') {
        const max = Math.max(1, ...(data?.cells ?? []).map((cell) => cell.value));
        option = { ...common, xAxis: { type: 'category', data: data?.x_labels ?? [], axisLabel: { interval: 0, rotate: 24 } }, yAxis: { type: 'category', data: (data?.y_labels ?? []).map((value) => workflowLabel(value as Parameters<typeof workflowLabel>[0])) }, visualMap: { min: 0, max, calculable: false, orient: 'horizontal', left: 'center', top: 0, inRange: { color: [palette.low, accent] }, textStyle: { color: text } }, series: [{ type: 'heatmap', label: { show: true, color: text }, data: (data?.cells ?? []).map((cell) => ({ value: [cell.x, cell.y, cell.value], filterValue: cell.filter_value })) }] };
      } else {
        const combo = style === 'combo';
        option = { ...common, legend: { data: data?.series?.map((series) => series.label), textStyle: { color: text }, top: 0 }, xAxis: { type: 'category', data: formatChartTickLabels(data?.labels ?? []), axisLabel: { hideOverlap: true } }, yAxis: (data?.series ?? []).slice(0, 2).map((series, index) => ({ type: 'value', name: series.label, position: index === 0 ? 'left' : 'right', splitLine: { show: index === 0, lineStyle: { color: border } } })), series: (data?.series ?? []).map((series, index) => ({ name: series.label, type: combo && index === 0 ? 'bar' : 'line', yAxisIndex: Math.min(index, 1), smooth: !combo, showSymbol: true, itemStyle: { color: index === 0 ? accent : palette.secondary }, lineStyle: { width: 2 }, data: series.values.map((value, itemIndex) => ({ value, filterValue: data?.filter_values?.[itemIndex] })) })) };
      }
      const entryAnimation = chartAnimationMs(hasAnimated.current ? 'update' : 'initial', prefersReducedMotion());
      const chart = initAdvancedChart(root);
      chart.setOption({ ...option, animationDuration: entryAnimation });
      hasAnimated.current = true;
      /* Deterministic hook for the reduced-motion/update contract in e2e. */
      root.dataset.chartAnimation = entryAnimation === 0 ? 'instant' : 'entry';
      const select = (params: unknown) => {
        const filterValue = (params as { data?: { filterValue?: string } } | null)?.data?.filterValue;
        if (filterValue) onSelect?.(filterValue);
      };
      chart.on('click', select);
      const observer = new ResizeObserver(() => chart.resize());
      observer.observe(root);
      cleanup = () => { observer.disconnect(); chart.off('click', select); chart.dispose(); };
    });
    return () => { disposed = true; cleanup(); };
  }, [data, hasData, onSelect, style, theme]);

  if (!hasData) return <p className="advanced-chart-empty">{t('Sin datos suficientes para esta visualización.')}</p>;
  const table = advancedChartTable(style, data, (value) => workflowLabel(value as Parameters<typeof workflowLabel>[0]));
  return <div className="advanced-chart-frame">
    <div ref={chartRef} className="advanced-chart" role="img" aria-label={description} />
    <details className="advanced-chart-data">
      <summary>{t('Ver datos')}</summary>
      <div className="compact-table-wrap"><table className="compact-table">
        <caption className="sr-only">{title}</caption>
        <thead><tr>{table.columns.map((column) => <th key={column} scope="col">{column}</th>)}{onSelect ? <th scope="col"><span className="sr-only">{t('Abrir')}</span></th> : null}</tr></thead>
        <tbody>{table.rows.map((row, index) => <tr key={index}>
          {row.cells.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
          {onSelect ? <td>{row.filterValue ? <button type="button" className="button subtle" aria-label={t('Abrir {cells}', { cells: row.cells[0] })} onClick={() => onSelect(row.filterValue as string)}>{t('Abrir')}</button> : null}</td> : null}
        </tr>)}</tbody>
      </table></div>
    </details>
  </div>;
}
