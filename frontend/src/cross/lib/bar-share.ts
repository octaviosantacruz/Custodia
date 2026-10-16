/** Share of `max` that `value` represents, clamped to 0..1; invalid input is 0, never a full bar. */
export function barShare(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0 || value <= 0) return 0;
  return Math.min(value / max, 1);
}
