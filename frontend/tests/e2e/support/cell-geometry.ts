import type { Locator } from '@playwright/test';
import { expect } from './fixtures';

export async function expectAtomicCellText(element: Locator) {
  await expect(element).toBeVisible();
  const geometry = await element.evaluate((node) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const rectangles: DOMRect[] = [];
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent?.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(walker.currentNode);
      rectangles.push(...Array.from(range.getClientRects()));
    }
    const cell = node.closest('td')!.getBoundingClientRect();
    return { lines: new Set(rectangles.map(rect => Math.round(rect.top))).size, fits: rectangles.every(rect => rect.left >= cell.left && rect.right <= cell.right) };
  });
  expect(geometry.lines, await element.innerText()).toBe(1);
  expect(geometry.fits, await element.innerText()).toBe(true);
}
