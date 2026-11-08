/* Pure helpers for StackedBar: how much of a whole each segment fills. */

export type StackedTone = 'good' | 'warn' | 'bad' | 'muted' | 'info';
export type StackedSegment = { key: string; label: string; count: number; tone: StackedTone };

/** Percentage widths in 0..100, never negative or NaN. They sum to at most 100:
 *  when the segments exceed `total` the bar is scaled to the larger of the two, so it never overflows. */
export function segmentWidths(segments: readonly Pick<StackedSegment, 'count'>[], total: number): number[] {
  const counts = segments.map((segment) => (Number.isFinite(segment.count) && segment.count > 0 ? segment.count : 0));
  const whole = Math.max(Number.isFinite(total) && total > 0 ? total : 0, counts.reduce((sum, count) => sum + count, 0));
  if (whole <= 0) return counts.map(() => 0);
  return counts.map((count) => (count / whole) * 100);
}

/** Text equivalent of the bar, so the chart is never the only carrier of the data. */
export function stackedSummary(segments: readonly StackedSegment[], total: number, format: (value: number) => string): string {
  const parts = segments.filter((segment) => segment.count > 0).map((segment) => {
    const share = total > 0 ? ` (${Math.round((segment.count / total) * 100)}%)` : '';
    return `${segment.label}: ${format(segment.count)}${share}`;
  });
  return parts.length ? parts.join(', ') : 'Sin datos';
}
