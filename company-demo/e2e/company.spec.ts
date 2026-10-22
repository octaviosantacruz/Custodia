import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const personPage = (email: string) => `/chains/person?email=${encodeURIComponent(email + '@faro.example')}`;
async function showEvidence(page: Page, email: string) {
  await page.goto(personPage(email));
  await page.getByRole('button', { name: /^Netskope:/ }).click();
  await page.getByText('Evidencia del cliente Netskope', { exact: true }).click();
  return page.locator('.person-client-coverage-detail');
}

test('original person view, evidence and filtered equipment represent the same employee', async ({ page }) => {
  // The dated company must keep its meaning when somebody opens it years later.
  await page.clock.setFixedTime(new Date('2031-01-01T00:00:00Z'));
  const errors: string[] = []; const requests: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => requests.push(r.url()));
  const evidence = await showEvidence(page, 'ana.soto');
  await expect(page.getByRole('region', { name: 'Persona Ana Soto', exact: true })).toBeVisible();
  await expect(evidence.getByText('Parcial', { exact: true })).toBeVisible();
  await expect(evidence).toContainText('total atribuible 2');
  await page.getByRole('button', { name: 'Abrir Netskope', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ver detalle de FARO-INF-001', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ver detalle de FARO-INF-ANTERIOR', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Ver detalle de FARO-/ })).toHaveCount(2);
  await expect(page.getByRole('row').filter({ hasText: 'FARO-INF-001' })).toContainText('hace 2 h');
  await page.getByRole('button', { name: 'Ver detalle de FARO-INF-ANTERIOR', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Señal', exact: true })).toContainText('Sin señal reciente');
  await expect(page.getByRole('region', { name: 'Usuario', exact: true })).toContainText('ana.soto@faro.example');
  expect(errors).toEqual([]);
  expect(requests.filter(url => new URL(url).origin !== 'http://127.0.0.1:4183')).toEqual([]);
  expect(requests.filter(url => new URL(url).pathname.startsWith('/api/'))).toEqual([]);
});

test('coverage gap and duplicate identity remain distinct investigative cases', async ({ page }) => {
  await expect(await showEvidence(page, 'carla.vega')).toContainText('Brecha');
  await expect(page.getByRole('button', { name: /^CyberArk: Con acceso privilegiado/ })).toBeVisible();
  const ambiguous = await showEvidence(page, 'elena.rios');
  await expect(ambiguous).toContainText('Por verificar');
  await page.getByRole('button', { name: /^CyberArk:/ }).click();
  await expect(page.locator('.person-tool-capabilities, .person-radial-panel').first()).toContainText(/ambigu/i);
});

for (const mode of ['stale', 'partial']) {
  test(`${mode} capture suppresses coverage conclusions without hiding observed records`, async ({ page }) => {
    await page.goto(personPage('carla.vega'));
    await page.getByRole('combobox', { name: 'Fuente Netskope' }).selectOption(mode);
    await page.getByRole('button', { name: /^Netskope:/ }).click();
    await page.getByText('Evidencia del cliente Netskope', { exact: true }).click();
    await expect(page.locator('.person-client-coverage-detail')).toContainText('Por verificar');
    await expect(page.locator('.company-context summary')).toContainText('0 brechas, 6 desconocidos');
    await page.getByRole('link', { name: 'Equipos Netskope', exact: true }).click();
    await expect(page.getByRole('button', { name: /Ver detalle de FARO-/ })).toHaveCount(6);
  });
}

test('Safe inventory preserves original detail, account membership and human review history', async ({ page }) => {
  await page.goto('/pam/safes');
  await page.getByText('FARO-PROD-PLATAFORMA', { exact: true }).first().click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('heading', { name: 'FARO-PROD-PLATAFORMA' })).toBeVisible();
  await drawer.getByRole('button', { name: 'Cuentas (2)', exact: true }).click();
  await expect(drawer).toContainText('prod-api-admin');
  await expect(drawer).toContainText('prod-db-admin');
  await drawer.getByRole('button', { name: 'Clasificar', exact: true }).click();
  await expect(drawer.getByRole('button', { name: 'Guardar clasificación', exact: true })).toBeDisabled();
  await expect(drawer.locator('textarea')).toBeDisabled();
  await drawer.getByRole('button', { name: /Historial/ }).click();
  await expect(drawer).toContainText('fictional:analyst');
  await page.keyboard.press('Escape');
  await expect(drawer).not.toBeVisible();
});

test('PAM chain keeps the same employee, role and Safe', async ({ page }) => {
  await page.goto(personPage('ana.soto'));
  await page.getByRole('button', { name: 'Abrir CyberArk', exact: true }).click();
  await expect(page.locator('body')).toContainText('Ana Soto');
  await expect(page.locator('body')).toContainText('Infraestructura · Producción');
});

test('company cases and original search support an operator exploring the company', async ({ page }) => {
  await page.goto('/chains/person');
  await page.locator('.company-context summary').click();
  await page.getByRole('link', { name: 'Bruno Ruiz', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Persona Bruno Ruiz', exact: true })).toBeVisible();
  const input = page.getByRole('searchbox', { name: 'Buscar persona por correo o nombre' });
  await input.fill('Carla');
  await page.getByRole('option', { name: /Carla Vega/ }).click();
  await expect(page.getByRole('region', { name: 'Persona Carla Vega', exact: true })).toBeVisible();
});

test('company context and original person view pass automatic WCAG A/AA checks', async ({ page }) => {
  await showEvidence(page, 'ana.soto');
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(result.violations).toEqual([]);
});
