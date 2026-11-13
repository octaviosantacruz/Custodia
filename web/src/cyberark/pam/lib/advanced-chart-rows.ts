import type { DashboardChartData, DashboardChartStyle } from './dashboard-metrics';
import { t } from '../../../cross/i18n/index.ts';

/* FE-AUD-006: the same data a canvas chart draws, as rows a keyboard and a screen reader can reach.
   A row with `filterValue` opens the same filter the chart's click does. */
export type AdvancedChartRow = { cells: string[]; filterValue?: string };
export type AdvancedChartTable = { columns: string[]; rows: AdvancedChartRow[] };

export function advancedChartTable(style: Extract<DashboardChartStyle, 'line' | 'heatmap' | 'scatter' | 'combo'>, data: DashboardChartData | undefined, rowLabel: (value: string) => string = (value) => value): AdvancedChartTable {
  if (style === 'scatter') {
    return {
      columns: ['Elemento', 'Cuentas', 'Miembros'],
      rows: (data?.points ?? []).map((point) => ({ cells: [point.label, String(point.x), String(point.y)], filterValue: point.filter_value })),
    };
  }
  if (style === 'heatmap') {
    const xs = data?.x_labels ?? [];
    const ys = data?.y_labels ?? [];
    return {
      columns: ['Fila', 'Columna', 'Valor'],
      rows: (data?.cells ?? []).map((cell) => ({
        cells: [rowLabel(ys[cell.y] ?? String(cell.y)), xs[cell.x] ?? String(cell.x), String(cell.value)],
        filterValue: cell.filter_value,
      })),
    };
  }
  const series = data?.series ?? [];
  return {
    columns: [t('Período'), ...series.map((item) => item.label)],
    rows: (data?.labels ?? []).map((label, index) => ({
      cells: [label, ...series.map((item) => String(item.values[index] ?? t('Sin dato')))],
      filterValue: data?.filter_values?.[index],
    })),
  };
}
