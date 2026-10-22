export type PageVolumeBucket = { day: string; count: number };

/** Group the timestamps already loaded in the current page by UTC calendar day. */
export function pageVolumeByUtcDay(timestamps: readonly string[]): PageVolumeBucket[] {
  const counts = new Map<string, number>();
  for (const timestamp of timestamps) {
    const parsed = new Date(timestamp);
    if (!Number.isFinite(parsed.getTime())) continue;
    const day = parsed.toISOString().slice(0, 10);
    counts.set(day, (counts.get(day) || 0) + 1);
  }
  return [...counts].sort(([left], [right]) => left.localeCompare(right)).map(([day, count]) => ({ day, count }));
}
