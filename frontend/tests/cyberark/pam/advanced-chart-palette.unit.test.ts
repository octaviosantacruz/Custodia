import assert from 'node:assert/strict';
import test from 'node:test';
import { advancedChartPalette, advancedChartTooltip } from '../../../src/cyberark/pam/lib/advanced-chart-palette.ts';

const reader = (tokens: Record<string, string>) => ({ getPropertyValue: (name: string) => tokens[name] ?? '' });

test('the palette reads theme tokens and trims them', () => {
  const palette = advancedChartPalette(reader({ '--accent': ' #1f9d61 ', '--chart-1': '#2383e2', '--bg-muted': '#fbfbfa' }));
  assert.equal(palette.accent, '#1f9d61');
  assert.equal(palette.secondary, '#2383e2');
  assert.equal(palette.low, '#fbfbfa');
});

test('a missing token falls back and the tooltip follows the surface colours', () => {
  const palette = advancedChartPalette(reader({ '--bg-surface': '#ffffff', '--text-primary': '#37352f' }));
  assert.equal(palette.text, '#9ca3af');
  const tooltip = advancedChartTooltip(palette);
  assert.equal(tooltip.backgroundColor, '#ffffff');
  assert.equal(tooltip.textStyle.color, '#37352f');
});
