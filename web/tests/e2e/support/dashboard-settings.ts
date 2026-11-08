import type { Locator, Page } from '@playwright/test';

/** Opens the side panel of one editable dashboard block and returns it. */
export async function openSettings(item: Locator): Promise<Locator> {
  await item.getByRole('button', { name: /^Configurar / }).click();
  return item.page().locator('.dashboard-settings-panel');
}

export async function closeSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Cerrar configuración' }).click();
}

/** Runs one action of a block's ⋯ menu (Duplicar, Mover arriba, Mover abajo, Quitar). */
export async function itemAction(page: Page, title: string, action: 'Duplicar' | 'Mover arriba' | 'Mover abajo' | 'Quitar'): Promise<void> {
  await page.getByRole('button', { name: `Más acciones de ${title}` }).click();
  const label = action === 'Mover arriba' || action === 'Mover abajo' ? `Mover ${title} ${action === 'Mover arriba' ? 'arriba' : 'abajo'}` : `${action} ${title}`;
  await page.getByRole('menuitem', { name: label }).click();
}
