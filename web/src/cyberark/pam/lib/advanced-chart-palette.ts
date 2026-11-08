export type AdvancedChartPalette = {
  text: string;
  textStrong: string;
  border: string;
  accent: string;
  secondary: string;
  surface: string;
  low: string;
};

type TokenReader = { getPropertyValue(name: string): string };

/* Colours come from the theme tokens so the chart follows dark/light;
   the fallbacks only apply when a token is missing. */
export function advancedChartPalette(styles: TokenReader): AdvancedChartPalette {
  const token = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  return {
    text: token('--text-secondary', '#9ca3af'),
    textStrong: token('--text-primary', '#f2f4f5'),
    border: token('--border-soft', '#27302b'),
    accent: token('--chart-2', '#56d298'),
    secondary: token('--chart-1', '#5ba2ff'),
    surface: token('--bg-surface', '#1d2125'),
    low: token('--bg-muted', '#161719'),
  };
}

export function advancedChartTooltip(palette: AdvancedChartPalette) {
  return {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    textStyle: { color: palette.textStrong, fontSize: 12 },
  };
}
