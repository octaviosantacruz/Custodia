import AxeBuilder from '@axe-core/playwright';
import { expect, mockAuthenticatedApp, test } from '../support/fixtures';

const describeViolations = (violations: Array<{ id: string; nodes: Array<{ target: unknown[]; failureSummary?: string }> }>) => violations.map((violation) => `${violation.id} :: ${violation.nodes[0]?.target?.join(' ')} :: ${violation.nodes[0]?.failureSummary?.replace(/\s+/g, ' ').slice(0, 260) ?? ''}`);

test('DOCS-PORTAL-001: the guide opens from the profile menu, navigates by keyboard and restores deep links', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam');

  await page.getByRole('button', { name: 'Abrir menú de usuario' }).click();
  await page.getByRole('region', { name: 'Menú de usuario' }).getByRole('button', { name: 'Ayuda' }).click();
  await expect(page).toHaveURL(/\/help$/);
  await expect(page.getByRole('heading', { name: 'Primeros pasos' })).toBeVisible();
  await expect(page.getByText('GUÍA DE PRODUCTO')).toBeVisible();

  // Keyboard navigation keeps the same section model as the deep links.
  const siaLink = page.getByRole('link', { name: /^SIA\b/ });
  await siaLink.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/help\?section=cyberark-sia$/);
  await expect(page.getByRole('heading', { name: 'SIA', exact: true })).toBeVisible();
  await expect(siaLink).toHaveAttribute('aria-current', 'true');

  // A fresh deep link restores the requested section.
  await page.goto('/help?section=datos');
  await expect(page.getByRole('heading', { name: 'Significado y frescura de datos' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Significado y frescura de datos\b/ })).toHaveAttribute('aria-current', 'true');
});

test('DOCS-PORTAL-001: Command-K finds the sections with the guide names and opens them', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam');
  await page.getByRole('button', { name: 'Abrir command center' }).click();
  const dialog = page.getByRole('dialog', { name: 'Command center' });

  await dialog.getByRole('combobox').fill('casos de uso');
  await dialog.getByRole('option', { name: /^Casos de uso/ }).click();
  await expect(page).toHaveURL(/\/help\?section=casos-de-uso$/);
  await expect(page.getByRole('heading', { name: 'Casos de uso' })).toBeVisible();

  await page.getByRole('button', { name: 'Abrir command center' }).click();
  await dialog.getByRole('combobox').fill('significado');
  await dialog.getByRole('option', { name: /^Significado y frescura de datos/ }).click();
  await expect(page).toHaveURL(/\/help\?section=datos$/);
  await expect(page.getByRole('heading', { name: 'Significado y frescura de datos' })).toBeVisible();
});

test('DOCS-PORTAL-001: the API reference link follows the deployment signal', async ({ page }) => {
  await mockAuthenticatedApp(page, { apiDocsEnabled: true });
  await page.goto('/help?section=api');
  await expect(page.getByRole('heading', { name: 'API para desarrolladores' })).toBeVisible();
  const apiLink = page.getByRole('link', { name: 'Abrir referencia API' });
  await expect(apiLink).toHaveAttribute('href', '/docs');
  await expect(apiLink).toHaveAttribute('target', '_blank');

  await mockAuthenticatedApp(page, { apiDocsEnabled: false });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'API para desarrolladores' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Abrir referencia API' })).toHaveCount(0);
  await expect(page.getByText(/fuera de exposición directa/)).toBeVisible();
});

test('DOCS-PORTAL-001: the guide never links a destination the actor cannot open', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'] });
  await page.goto('/help?section=administracion');
  await expect(page.getByRole('heading', { name: 'Administración y permisos' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Abrir Usuarios y permisos' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Abrir Actividad' })).toHaveCount(0);

  await page.goto('/help?section=netskope');
  await expect(page.getByRole('heading', { name: 'Netskope' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Abrir Métricas Netskope' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Abrir Alertas DLP' })).toHaveCount(0);
});

test('DOCS-PORTAL-001: the guide has no axe violations', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/help?section=personas');
  await expect(page.getByRole('heading', { name: 'Personas', exact: true })).toBeVisible();

  const results = await new AxeBuilder({ page })
    .include('.help-workspace')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(describeViolations(results.violations), 'guide axe violations').toEqual([]);
});
