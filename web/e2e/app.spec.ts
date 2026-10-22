import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ORIGIN = 'http://127.0.0.1:4185';
const demo = (route: string) => `/demo/#${route}`;

async function enter(page: Page) {
  await page.goto('/demo/');
  await expect(page).toHaveURL(/\/demo\/#\/entrar$/);
  await page.getByRole('button', { name: 'Entrar a la demo', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Resumen' })).toBeVisible();
}

const scan = async (page: Page) =>
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);

test('the product site opens in English, has Spanish, and leads into the demo', async ({ page }) => {
  const requests: string[] = []; const errors: string[] = [];
  page.on('request', r => requests.push(r.url()));
  page.on('pageerror', e => errors.push(e.message));
  // Sin animación cada bloque se ve completo; axe mide ese estado final.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('What your security tools know');
  await expect(page.getByRole('img', { name: /Alice Morgan/ }).or(page.locator('figcaption', { hasText: 'Alice Morgan' }))).toHaveCount(1);
  await scan(page);
  await page.getByRole('link', { name: 'Versión en español' }).click();
  await expect(page).toHaveURL(/\/es\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Lo que tus herramientas de seguridad saben');
  await scan(page);
  await page.getByRole('link', { name: 'Abrir la demo' }).click();
  await expect(page).toHaveURL(/\/demo\/#\/entrar$/);
  expect(errors).toEqual([]);
  expect(requests.filter(url => new URL(url).origin !== ORIGIN)).toEqual([]);
});

test('a use case on the site opens that person in the demo after signing in', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /Who has privileged access but no device/ }).click();
  await expect(page).toHaveURL(/#\/entrar\?volver=/);
  await page.getByRole('button', { name: 'Entrar a la demo', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Alice Morgan' })).toBeVisible();
});

test('the demo opens behind its own sign-in and never calls a server', async ({ page }) => {
  // La empresa fechada conserva su sentido aunque se abra años después.
  await page.clock.setFixedTime(new Date('2031-01-01T00:00:00Z'));
  const errors: string[] = []; const requests: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => requests.push(r.url()));
  await enter(page);
  const findings = page.getByRole('region', { name: 'Hallazgos cruzados' }).getByRole('listitem').filter({ has: page.getByRole('heading', { level: 3 }) });
  await expect(findings).toHaveCount(3);
  await expect(findings.nth(0)).toContainText('Acceso privilegiado sin ningún equipo observado');
  await expect(findings.nth(0)).toContainText('Alice Morgan');
  await expect(findings.nth(1)).toContainText('Bob Chen');
  await expect(findings.nth(2)).toContainText('Dos identidades activas comparten un correo');
  await expect(page.getByText('50%', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Salir de la demo' }).click();
  await expect(page).toHaveURL(/#\/entrar$/);
  expect(errors).toEqual([]);
  expect(requests.filter(url => new URL(url).origin !== ORIGIN)).toEqual([]);
});

test('a gap and an ambiguous identity stay distinct cases with their evidence', async ({ page }) => {
  await enter(page);
  await page.getByRole('link', { name: 'Personas', exact: true }).click();
  await page.getByRole('link', { name: 'Alice Morgan', exact: true }).click();
  const verdict = page.getByRole('complementary', { name: /Brecha/ });
  await expect(verdict).toContainText('ningún dispositivo reciente observado');
  await expect(verdict).toContainText('0 de 0');
  await expect(page.getByRole('img', { name: /Trama de Alice Morgan/ })).toContainText('ningún equipo');

  await page.goto(demo('/personas/5'));
  await expect(page.getByRole('complementary', { name: /Desconocido/ })).toContainText('dos identidades activas');
  await expect(page.getByRole('img', { name: /Trama de Eve Taylor/ })).toContainText('2 candidatos, sin unir');
  await expect(page.getByRole('img', { name: /Trama de Eve Taylor/ })).not.toContainText('ACME-PROD');
});

for (const [mode, label] of [['stale', 'Desactualizada (73 h)'], ['partial', 'Parcial']]) {
  test(`a ${mode} capture suppresses conclusions but keeps observed records`, async ({ page }) => {
    await enter(page);
    await page.getByRole('combobox', { name: 'Escenario de Netskope' }).selectOption({ label });
    await expect(page.getByRole('status')).toContainText('todo veredicto queda desconocido');
    await expect(page.getByText('no evaluable', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Hallazgos cruzados' })).not.toContainText('Brecha');
    await page.getByRole('link', { name: 'Equipos', exact: true }).click();
    await expect(page.getByRole('row')).toHaveCount(7);
    await page.goto(demo('/personas/3'));
    await expect(page.getByRole('complementary', { name: /Desconocido/ })).toBeVisible();
  });
}

test('each tool shows its own records, raw attributes and the proposed link', async ({ page }) => {
  await enter(page);
  await page.getByRole('link', { name: 'Identidades', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Identidades' })).toBeVisible();
  const eve = page.getByRole('row').filter({ hasText: 'acme-identity-105' });
  await expect(eve).toContainText('ambiguo, sin unir');
  await page.getByRole('searchbox').fill('eve.taylor');
  await expect(page.getByText('2 de 7')).toBeVisible();

  await page.getByRole('link', { name: 'Safes', exact: true }).click();
  const prod = page.getByRole('row').filter({ hasText: 'ACME-PROD-PLATFORM' });
  await expect(prod).toContainText('Bob Chen');
  await prod.getByRole('button', { name: 'Atributos de ACME-PROD-PLATFORM' }).click();
  await expect(page.getByText('managing_cpm', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Usuarios', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'alice.morgan@acme.example' })).toContainText('sin equipos');
  await page.getByRole('link', { name: 'Versiones de cliente', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: '110.0.1' })).toContainText('5');
});

test('people filter by verdict', async ({ page }) => {
  await enter(page);
  await page.goto(demo('/personas'));
  await page.getByRole('button', { name: /^Cubierto/ }).click();
  await expect(page.getByRole('row')).toHaveCount(4);
});

test('every demo screen passes automatic WCAG A/AA checks', async ({ page }) => {
  await page.goto('/demo/');
  await scan(page);
  await page.getByRole('button', { name: 'Entrar a la demo', exact: true }).click();
  for (const route of ['/', '/personas', '/personas/1', '/personas/5', '/cyberark/identidades', '/cyberark/roles', '/cyberark/safes',
    '/cyberark/cuentas', '/cyberark/plataformas', '/netskope/usuarios', '/netskope/equipos', '/netskope/versiones', '/fuentes', '/sistema']) {
    await page.goto(demo(route));
    await expect(page.locator('h1')).toBeVisible();
    await scan(page);
  }
});

test('phone width has no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/', '/es/']) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  }
  await enter(page);
  for (const route of ['/', '/personas', '/personas/3', '/cyberark/safes', '/netskope/equipos', '/fuentes', '/sistema']) {
    await page.goto(demo(route));
    await expect(page.locator('h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  }
});
