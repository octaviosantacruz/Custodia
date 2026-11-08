/* FE-MOTION-001: the chart entry animation is a first-load signal, not a
   data-update effect. ECharts replays its option transition on every
   setOption, so any update after the first data render -- filters, resize
   wiring, drill-down, a re-render with a fresh callback identity -- resolves
   to 0, and reduced motion disables even the first-load animation. */

export const CHART_ENTRY_MS = 450;

export type ChartAnimationState = 'initial' | 'update';

export function chartAnimationMs(state: ChartAnimationState, reducedMotion: boolean): number {
  if (reducedMotion || state === 'update') return 0;
  return CHART_ENTRY_MS;
}
