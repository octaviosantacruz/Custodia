import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockAuthenticatedApp } from '../support/fixtures';

/* FE-A11Y-001 pilot: CompactSelect now runs on React Aria Components. These
   tests pin the Custodia look (classes, geometry, selected style) and the new
   keyboard model (arrows, Home/End, typeahead, Escape, Tab, focus restore). */

async function openClassificationDrawer(page: import('@playwright/test').Page) {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'inventory:write', 'catalogs:write', 'access:manage'], includeSafe: true });
  await page.goto('/pam/safes');
  await page.locator('.safe-name').filter({ hasText: 'Finance' }).click();
  const drawer = page.getByRole('dialog', { name: 'Finance' });
  await drawer.getByRole('button', { name: 'Clasificar' }).click();
  return { drawer, trigger: drawer.locator('.unit-select .custom-select-trigger') };
}

test('CompactSelect keeps the Custodia trigger and menu geometry', async ({ page }) => {
  const { trigger } = await openClassificationDrawer(page);
  await expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  const triggerBox = await trigger.boundingBox();
  expect(triggerBox?.height).toBe(32);

  await trigger.click();
  const menu = page.locator('.custom-select-menu');
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const menuBox = await menu.boundingBox();
  // Same offset (5px) and minimum width (max(150px, trigger)) as before.
  expect(Math.abs(menuBox!.y - (triggerBox!.y + triggerBox!.height + 5))).toBeLessThan(2);
  expect(menuBox!.width).toBeGreaterThanOrEqual(Math.max(150, triggerBox!.width) - 1);

  const menuStyles = await menu.evaluate((element) => {
    const styles = getComputedStyle(element);
    return { background: styles.backgroundColor, border: styles.borderTopColor, zIndex: styles.zIndex };
  });
  expect(menuStyles.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(menuStyles.border).not.toBe('rgba(0, 0, 0, 0)');
  expect(menuStyles.zIndex).not.toBe('auto');
  // The chosen option keeps the Custodia selected style.
  const selected = page.getByRole('option', { name: 'Sin asignar', exact: true });
  expect(await selected.evaluate((element) => getComputedStyle(element).fontWeight)).toBe('700');
});

test('CompactSelect keyboard covers arrows, Home/End, typeahead, Enter and focus restore', async ({ page }) => {
  const { trigger } = await openClassificationDrawer(page);
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.locator('.custom-select-menu');
  await expect(menu).toBeVisible();

  const focused = page.locator('.custom-select-option[data-focused]');
  await expect(focused).toHaveText(/Sin asignar/);
  await page.keyboard.press('ArrowDown');
  await expect(focused).toHaveText(/FIN - Finanzas/);
  await page.keyboard.press('ArrowUp');
  await expect(focused).toHaveText(/Sin asignar/);
  await page.keyboard.press('End');
  await expect(focused).toHaveText(/FIN - Finanzas/);
  await page.keyboard.press('Home');
  await expect(focused).toHaveText(/Sin asignar/);
  await page.keyboard.type('fin');
  await expect(focused).toHaveText(/FIN - Finanzas/);

  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toContainText('FIN - Finanzas');
  await expect(trigger).toBeFocused();
});

test('CompactSelect opens with Space and Escape restores focus to the trigger', async ({ page }) => {
  const { trigger } = await openClassificationDrawer(page);
  await trigger.focus();
  await page.keyboard.press(' ');
  const menu = page.locator('.custom-select-menu');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('CompactSelect Tab reaches the add action and Escape closes and restores focus', async ({ page }) => {
  const { trigger } = await openClassificationDrawer(page);
  await trigger.click();
  const menu = page.locator('.custom-select-menu');
  await expect(menu).toBeVisible();

  // RAC's Select popover is modal: Tab reaches every action inside it and
  // Escape is the documented way out (which restores focus to the trigger).
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Agregar unidad' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.custom-select-option[data-focused]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('CompactSelect keeps the add action clickable', async ({ page }) => {
  const { trigger } = await openClassificationDrawer(page);
  await trigger.click();
  const menu = page.locator('.custom-select-menu');
  await expect(menu).toBeVisible();
  await page.getByRole('button', { name: 'Agregar unidad' }).click();
  await expect(menu).toHaveCount(0);
});

test('CompactSelect passes an axe scan on the trigger and the open menu', async ({ page }) => {
  const { trigger } = await openClassificationDrawer(page);
  const triggerResults = await new AxeBuilder({ page }).include('.unit-select').analyze();
  expect(triggerResults.violations).toEqual([]);

  await trigger.click();
  const menu = page.locator('.custom-select-menu');
  await expect(menu).toBeVisible();
  const menuResults = await new AxeBuilder({ page }).include('.custom-select-menu').analyze();
  expect(menuResults.violations).toEqual([]);
});
