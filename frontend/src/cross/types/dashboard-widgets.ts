import type { AnalyticsBucket } from './analytics';

/** The chart data consumed by shared dashboard previews, not the full PAM API model. */
export type DashboardChartData = {
  series?: Array<{ values: number[] }>;
  x_labels?: string[];
  y_labels?: string[];
  cells?: Array<{ x: number; y: number; value: number }>;
  points?: Array<{ key: string; x: number; y: number }>;
};

/** Shared preview fields used by the tool-specific dashboard adapters. */
export type DashboardWidget = {
  buckets?: AnalyticsBucket[];
  chart_data?: DashboardChartData;
};

/** Fields the command center reads from PAM's shortcut catalog. */
export type DashboardShortcut = { id: string; title: string; detail: string };

/** Fields the command center reads from Netskope's widget catalog. */
export type NetskopeWidgetDefinition = { id: string; title: string; description: string };
