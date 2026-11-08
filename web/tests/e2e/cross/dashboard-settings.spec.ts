import AxeBuilder from '@axe-core/playwright';
import { expect, mockAuthenticatedApp, test } from '../support/fixtures';

/* The block editor shared by the CyberArk and Netskope boards: a "Configurar" side panel and a ⋯ menu per block. */

async function openNetskopeEditor(page: import('@playwright/test').Page) {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.goto('/netskope');
  await expect(page.getByRole('heading', { name: 'Datos clave' })).toBeVisible();
  await page.getByRole('button', { name: 'Editar vista' }).click();
  await expect(page.getByRole('toolbar', { name: 'Edición del tablero Netskope' })).toBeVisible();
}

test('the settings panel opens from the keyboard, takes focus, closes with Escape and returns focus to its button', async ({ page }) => {
  await openNetskopeEditor(page);
  const configure = page.getByRole('button', { name: 'Configurar Dispositivos por sistema operativo' });
  await configure.focus();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('dialog', { name: 'Configurar Dispositivos por sistema operativo' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Cerrar configuración' })).toBeFocused();
  await expect(configure).toHaveAttribute('aria-expanded', 'true');

  // Presentation is reachable and operable by keyboard.
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('button', { name: 'Dona' })).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(panel.getByRole('button', { name: 'Barras' })).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(configure).toBeFocused();
  await expect(configure).toHaveAttribute('aria-expanded', 'false');
});

test('only one settings panel is open at a time and it never covers the save bar', async ({ page }) => {
  await openNetskopeEditor(page);
  await page.getByRole('button', { name: 'Configurar Dispositivos por sistema operativo' }).click();
  await expect(page.locator('.dashboard-settings-panel')).toHaveCount(1);
  await page.locator('.netskope-data-strip .dashboard-edit-item').first().getByRole('button', { name: /^Configurar / }).click({ force: true });
  await expect(page.locator('.dashboard-settings-panel')).toHaveCount(1);
  await expect(page.getByRole('dialog', { name: 'Configurar Dispositivos por sistema operativo' })).toHaveCount(0);

  const save = await page.getByRole('button', { name: 'Guardar vista' }).boundingBox();
  const panel = await page.locator('.dashboard-settings-panel').boundingBox();
  expect(save).not.toBeNull();
  expect(panel).not.toBeNull();
  expect(panel!.y).toBeGreaterThanOrEqual(save!.y + save!.height - 1);
  await page.getByRole('button', { name: 'Guardar vista' }).hover();
  await expect(page.getByRole('button', { name: 'Guardar vista' })).toBeVisible();
});

test('the ⋯ menu is operable by keyboard, closes with Escape and returns focus', async ({ page }) => {
  await openNetskopeEditor(page);
  const more = page.getByRole('button', { name: 'Más acciones de Dispositivos por sistema operativo' });
  await more.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Acciones de Dispositivos por sistema operativo' });
  await expect(menu.getByRole('menuitem')).toHaveText(['Mover arriba', 'Mover abajo', 'Quitar']);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();

  await more.press('Enter');
  await page.getByRole('menuitem', { name: 'Quitar Dispositivos por sistema operativo' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.dashboard-edit-item').filter({ hasText: 'Dispositivos por sistema operativo' })).toHaveCount(0);
  await expect(page.getByText('Cambios sin guardar', { exact: false })).toBeVisible();
});

test('block reordering by arrow keys still works and the panel and menu pass axe in both themes', async ({ page }, testInfo) => {
  await openNetskopeEditor(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', testInfo.project.name.includes('light') ? 'light' : 'dark');
  const first = page.locator('.netskope-data-strip .dashboard-edit-item').first();
  const title = (await first.getAttribute('aria-label'))!.split(',')[0];
  await first.focus();
  await first.press('ArrowRight');
  await expect(page.locator('.netskope-data-strip .dashboard-edit-item').nth(1)).toHaveAttribute('aria-label', new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},`));

  await page.getByRole('button', { name: 'Más acciones de Dispositivos por sistema operativo' }).click();
  const menuAxe = await new AxeBuilder({ page }).include('.dashboard-edit-menu-list').analyze();
  expect(menuAxe.violations.map(({ id }) => id)).toEqual([]);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Configurar Dispositivos por sistema operativo' }).click();
  const panelAxe = await new AxeBuilder({ page }).include('.dashboard-settings-panel').analyze();
  expect(panelAxe.violations.map(({ id }) => id)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath(`settings-panel-${testInfo.project.name}.png`) });
});

test('PAM board: the same panel and menu, and the new block opens its own settings with focus inside', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam');
  await page.getByRole('button', { name: 'Editar vista' }).click();
  const configure = page.getByRole('button', { name: 'Configurar Safes por empresa' });
  await configure.focus();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('dialog', { name: 'Configurar Safes por empresa' });
  await expect(panel.getByRole('group', { name: 'Presentación de Safes por empresa' })).toBeVisible();
  await expect(panel.getByRole('group', { name: 'Tamaño de Safes por empresa' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(configure).toBeFocused();

  await page.getByRole('button', { name: 'Más acciones de Safes por empresa' }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Duplicar', 'Mover arriba', 'Mover abajo', 'Quitar']);
  const axe = await new AxeBuilder({ page }).include('.dashboard-edit-menu-list').analyze();
  expect(axe.violations.map(({ id }) => id)).toEqual([]);
});
