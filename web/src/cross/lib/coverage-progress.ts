import type { CoverageBlock, CoveragePoint } from '../types/connection';
import type { StackedSegment } from './stacked-bar';
import { localeTag, t } from '../i18n/index.ts';

/** "X de N": the share is never shown without its denominator. */
export function xOfN(count: number, total: number): string {
  return t('{localeTag} de {localeTag2}', { localeTag: count.toLocaleString(localeTag()), localeTag2: total.toLocaleString(localeTag()) });
}

/** The readings of one capability as the parts of N, from the best to the worst. */
export function capabilitySegments(readings: CoverageBlock['platform']): StackedSegment[] {
  return [
    { key: 'match', label: 'Coincide', count: readings.match, tone: 'good' },
    { key: 'undeclared', label: t('No declarado'), count: readings.undeclared, tone: 'warn' },
    { key: 'missing', label: t('Falta en SIA'), count: readings.missing, tone: 'bad' },
    { key: 'unclassified', label: t('Sin clasificar'), count: readings.unclassified, tone: 'info' },
    { key: 'unknown', label: t('Sin dato'), count: readings.unknown, tone: 'muted' },
  ];
}

export function workSegments(work: CoverageBlock['work']): StackedSegment[] {
  return [
    { key: 'onboarded', label: 'Incorporado', count: work.onboarded, tone: 'good' },
    { key: 'in_progress', label: 'En curso', count: work.in_progress, tone: 'info' },
    { key: 'pending', label: t('Pendiente'), count: work.pending, tone: 'muted' },
    { key: 'blocked', label: 'Bloqueado', count: work.blocked, tone: 'bad' },
    { key: 'not_applicable', label: t('No aplica'), count: work.not_applicable, tone: 'muted' },
  ];
}

export const TREND_SERIES = [
  { key: 'n', label: t('Destinos'), value: (block: CoverageBlock) => block.n },
  { key: 'platform', label: 'Platform coincide', value: (block: CoverageBlock) => block.platform.match },
  { key: 'dba', label: 'DBA coincide', value: (block: CoverageBlock) => block.dba.match },
  { key: 'onboarded', label: 'Incorporados', value: (block: CoverageBlock) => block.work.onboarded },
] as const;

export type TrendLine = { key: string; label: string; values: number[]; points: string };

/** Geometry of the weekly chart in a `width` x `height` box with an inner margin; y runs from 0 to the largest count. */
export function trendGeometry(points: readonly CoveragePoint[], width: number, height: number, margin = 28) {
  const top = Math.max(1, ...points.map((point) => point.n));
  const x = (index: number) => points.length <= 1 ? width / 2 : margin + (index * (width - margin * 2)) / (points.length - 1);
  const y = (value: number) => height - margin - (value / top) * (height - margin * 2);
  const lines: TrendLine[] = TREND_SERIES.map((series) => {
    const values = points.map((point) => series.value(point));
    return { key: series.key, label: series.label, values, points: values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ') };
  });
  return { top, lines, x, y };
}
