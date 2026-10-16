import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';

export async function expectSystemSearch(input: Locator) {
  await expect(input).toBeVisible();
  await expect(input.page().locator('html')).toHaveAttribute('data-theme', test.info().project.name.includes('light') ? 'light' : 'dark');
  const label = input.locator('xpath=ancestor::label[1]');
  await expect(label).toHaveClass(/search-box/);
  await expect(label.locator('svg')).toBeVisible();
  const geometry = await label.evaluate(node => {
    const icon = node.querySelector('svg')!.getBoundingClientRect();
    const input = node.querySelector('input')!;
    const field = input.getBoundingClientRect();
    return { height: node.getBoundingClientRect().height, aligned: icon.right <= field.left, border: getComputedStyle(input).borderTopWidth };
  });
  expect(geometry.height).toBeLessThanOrEqual(44);
  expect(geometry.aligned).toBe(true);
  expect(geometry.border).toBe('0px');
  await input.focus();
  await expect(input).toBeFocused();
}
