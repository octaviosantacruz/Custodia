/** How a category distribution is drawn. Saved per chart; absent means the chart's own default. */
export type ChartMode = 'donut' | 'bars';

export const CHART_MODE_LABELS: Record<ChartMode, string> = { donut: 'Dona', bars: 'Barras' };

export const isChartMode = (value: unknown): value is ChartMode => value === 'donut' || value === 'bars';
