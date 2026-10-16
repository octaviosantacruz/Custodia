import { expect, mockAuthenticatedApp, test } from '../support/fixtures';

test('Relaciones: the Identity drawer opens Relaciones at the person account', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/identity');

  await page.locator('.identity-user-cell').getByRole('button', { name: /Ada Identity/ }).click();
  await expect(page.getByRole('heading', { name: 'Saltos a otros módulos' })).toBeVisible();
  await page.getByRole('button', { name: /Ver en Acceso/ }).click();

  // The deep link keeps the node in the URL so the view is shareable/reloadable.
  await expect(page).toHaveURL(/\/pam\/graph\?type=user&id=8/);
  const map = page.getByRole('region', { name: 'Mapa de la cadena PAM' });
  await expect(map.getByLabel('Elegido en Identidad: Ada')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('region', { name: 'Mapa de la cadena PAM' }).getByLabel('Elegido en Identidad: Ada')).toBeVisible();
});

test('Relaciones: the first column is Identidad only with an Identity read permission', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['pam:catalogs_read'] });
  await page.goto('/pam/graph');
  const map = page.getByRole('region', { name: 'Mapa de la cadena PAM' });
  await expect(map.getByRole('region', { name: 'Columna Usuario PAM' })).toBeVisible();
  await expect(map.getByRole('region', { name: 'Columna Identidad' })).toHaveCount(0);
});

test('the retired Cadena Identity path lands in Relaciones', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam/identity/chain');
  await expect(page.getByRole('region', { name: 'Mapa de la cadena PAM' })).toBeVisible();
});
