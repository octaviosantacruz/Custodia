import { useEffect, useMemo, useRef } from 'react';
import { workflowLabel } from '../lib/format';
import type { DashboardChartData, DashboardChartStyle } from '../lib/dashboard-metrics';

type Props = {
  title: string;
  style: Extract<DashboardChartStyle, 'line' | 'heatmap' | 'scatter' | 'combo'>;
  data?: DashboardChartData;
  onSelect?: (filterValue: string) => void;
};

export function AdvancedChart({ title, style, data, onSelect }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const hasData = Boolean(data?.series?.some((series) => series.values.length) || data?.points?.length || data?.cells?.length);
  const description = useMemo(() => {
    if (style === 'scatter') return `${title}. Eje X: cuentas; eje Y: miembros.`;
    if (style === 'heatmap') return `${title}. Intensidad por las dos dimensiones del cruce.`;
    return `${title}. ${data?.series?.map((series) => series.label).join(' y ') || 'Serie temporal'}.`;
  }, [data?.series, style, title]);

  useEffect(() => {
    if (!chartRef.current || !hasData) return;
    let disposed = false;
    let cleanup = () => {};
    void import('../lib/advanced-chart-engine').then(({ initAdvancedChart }) => {
      if (disposed || !chartRef.current) return;
      const root = chartRef.current;
      const computed = getComputedStyle(root);
      const text = computed.getPropertyValue('--text-secondary').trim() || '#9ca3af';
      const border = computed.getPropertyValue('--border-soft').trim() || '#27302b';
      const accent = computed.getPropertyValue('--accent').trim() || '#67c587';
      const blue = '#6d9ff2';
      const common = {
        animationDuration: 450,
        aria: { enabled: true, decal: { show: true } },
        textStyle: { color: text, fontFamily: 'Inter, system-ui, sans-serif', fontSize: 10 },
        tooltip: { trigger: style === 'scatter' || style === 'heatmap' ? 'item' : 'axis' },
        grid: { left: 42, right: 20, top: 34, bottom: 42, containLabel: true },
      };
      let option: Record<string, unknown>;
      if (style === 'scatter') {
        option = { ...common, xAxis: { name: 'Cuentas', splitLine: { lineStyle: { color: border } } }, yAxis: { name: 'Miembros', splitLine: { lineStyle: { color: border } } }, series: [{ type: 'scatter', symbolSize: 10, itemStyle: { color: accent }, data: (data?.points ?? []).map((point) => ({ value: [point.x, point.y], name: point.label, filterValue: point.filter_value })) }] };
      } else if (style === 'heatmap') {
        const max = Math.max(1, ...(data?.cells ?? []).map((cell) => cell.value));
        option = { ...common, xAxis: { type: 'category', data: data?.x_labels ?? [], axisLabel: { interval: 0, rotate: 24 } }, yAxis: { type: 'category', data: (data?.y_labels ?? []).map((value) => workflowLabel(value as Parameters<typeof workflowLabel>[0])) }, visualMap: { min: 0, max, calculable: false, orient: 'horizontal', left: 'center', top: 0, inRange: { color: ['#17241d', accent] }, textStyle: { color: text } }, series: [{ type: 'heatmap', label: { show: true, color: text }, data: (data?.cells ?? []).map((cell) => ({ value: [cell.x, cell.y, cell.value], filterValue: cell.filter_value })) }] };
      } else {
        const combo = style === 'combo';
        option = { ...common, legend: { data: data?.series?.map((series) => series.label), textStyle: { color: text }, top: 0 }, xAxis: { type: 'category', data: data?.labels ?? [], axisLabel: { hideOverlap: true } }, yAxis: (data?.series ?? []).slice(0, 2).map((series, index) => ({ type: 'value', name: series.label, position: index === 0 ? 'left' : 'right', splitLine: { show: index === 0, lineStyle: { color: border } } })), series: (data?.series ?? []).map((series, index) => ({ name: series.label, type: combo && index === 0 ? 'bar' : 'line', yAxisIndex: Math.min(index, 1), smooth: !combo, showSymbol: true, itemStyle: { color: index === 0 ? accent : blue }, lineStyle: { width: 2 }, data: series.values.map((value, itemIndex) => ({ value, filterValue: data?.filter_values?.[itemIndex] })) })) };
      }
      const chart = initAdvancedChart(root);
      chart.setOption(option);
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
  }, [data, hasData, onSelect, style]);

  if (!hasData) return <p className="advanced-chart-empty">Sin datos suficientes para esta visualización.</p>;
  return <div ref={chartRef} className="advanced-chart" role="img" aria-label={description} />;
}
