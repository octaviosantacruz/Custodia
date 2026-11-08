import { expectSystemSearch } from '../../support/search-control';
import AxeBuilder from '@axe-core/playwright';
import { expect, mockAuthenticatedApp, test } from '../../support/fixtures';

const UCI_PERMISSIONS = ['inventory:read', 'netskope:read', 'netskope:uba_read'];
const reading = (email: string, name: string | null, rating: 'Poor' | 'Moderate', score: number, previous: number | null) => ({
  email, user_id: null, name, rating, score, previous_score: previous, scored_at: '2026-10-04T00:00:00Z',
});

test('NSK-UBA-002 UCI view lists low and moderate users with their weekly change and honest gaps (UX-AUD2-024 UX-AUD2-009)', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: UCI_PERMISSIONS });
  await page.route('**/api/cmdb/netskope/uci*', (route) => route.fulfill({ json: {
    configured: true, total: 3, by_rating: { Poor: 2, Moderate: 1 }, captured_at: '2026-10-04T00:00:00Z',
    rows: [reading('ana@example.test', 'Ana Pérez', 'Poor', 150, 400), reading('beto@example.test', null, 'Poor', 300, null), { ...reading('cris@example.test', 'Cris Díaz', 'Moderate', 500, 450), scored_at: '2100-01-01T00:00:00Z' }],
  } }));
  await page.goto('/netskope/uci');

  const section = page.getByRole('region', { name: 'Usuarios con señales de riesgo', exact: true });
  await expect(page.locator('html')).toHaveAttribute('data-theme', test.info().project.name.includes('light') ? 'light' : 'dark');
  await expect(section.locator('time[datetime="2026-10-04T00:00:00Z"]').first()).toHaveAttribute("title", /^hace /);
  // The scale is visible before opening help; the acronym and limits are explained inside.
  await expect(section.getByText('De 0 a 1000: menor puntaje, mayor riesgo.', { exact: true })).toBeVisible();
  await expect(section.getByRole('columnheader', { name: 'Índice de confianza', exact: true })).toBeVisible();
  await section.getByRole('button', { name: 'Ayuda: Usuarios con señales de riesgo' }).click();
  await expect(section.getByRole('note')).toContainText('UCI significa User Confidence Index');
  await expect(section.getByRole('note')).toContainText('su ausencia no confirma que esté libre de riesgo');
  await expect(section.getByRole('note')).toContainText('si sube, mejora la confianza; si baja, aumenta el riesgo');
  await page.keyboard.press('Escape');
  await expect(section.locator('.summary-stat').filter({ hasText: 'Confianza baja' })).toContainText('2');
  const ana = section.getByRole('row', { name: /Ana Pérez/ });
  await expect(ana).toContainText('Empeora −250');
  await expect(section.getByRole('row', { name: /beto@example.test/ })).toContainText('Sin dato');
  await expect(section.getByRole('row', { name: /Cris Díaz/ })).toContainText('Mejora +50');
  const future = section.getByRole('row', { name: /Cris Díaz/ }).locator('time');
  await expect(future).toHaveAttribute('datetime', '2100-01-01T00:00:00Z');
  await expect(future).toHaveText(/^En /);
  await expect(future).toHaveAttribute('title', /^1 ene 2100/);

  await expectSystemSearch(section.getByLabel('Buscar usuario por nombre o correo'));
  await section.getByLabel('Buscar usuario por nombre o correo').fill('cris');
  await expect(section.getByRole('row', { name: /Ana Pérez/ })).toHaveCount(0);
  await expect(section.getByRole('row', { name: /Cris Díaz/ })).toHaveCount(1);

  const axe = await new AxeBuilder({ page }).include('.netskope-uci').analyze();
  expect(axe.violations.map(({ id }) => id)).toEqual([]);
});

test('NSK-UBA-002 UCI view says when the capture is not enabled or has not run', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: UCI_PERMISSIONS });
  await page.route('**/api/cmdb/netskope/uci*', (route) => route.fulfill({ json: { configured: false, rows: [], total: 0, by_rating: { Poor: 0, Moderate: 0 }, captured_at: null } }));
  await page.goto('/netskope/uci');
  await expect(page.getByText('El índice de confianza no está habilitado')).toBeVisible();
});

test('NSK-UBA-002 netskope:read alone does not open the UCI view', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.goto('/netskope/uci');
  await expect(page.getByRole('region', { name: 'Usuarios con señales de riesgo', exact: true })).toHaveCount(0);
});


test('UX-AUD2-009 UCI keeps an unknown capture explicit when configured', async ({page}, testInfo) => {
  await mockAuthenticatedApp(page, {permissions:UCI_PERMISSIONS});
  await page.route('**/api/cmdb/netskope/uci*', route => route.fulfill({json:{
    configured:true,captured_at:null,rows:[],total:0,by_rating:{Poor:0,Moderate:0},
  }}));
  await page.goto('/netskope/uci');
  await expect(page.locator('html')).toHaveAttribute('data-theme', testInfo.project.name.includes('light') ? 'light' : 'dark');
  const section = page.getByRole('region', {name:'Usuarios con señales de riesgo', exact:true});
  await expect(section).toContainText('Sin captura todavía');
  await expect(section.locator('time')).toHaveCount(0);
});

test('NSK-UBA-002 Usuarios shows the share of at-risk users per company with its weekly change and links to the full UCI list', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: UCI_PERMISSIONS });
  await page.route('**/api/cmdb/netskope/uci/companies', (route) => route.fulfill({ json: { omitted_users: 30, previous_week: '2026-10-05', companies: [
    { company: 'ALFA', users: 200, poor: 10, moderate: 30, previous: { users: 200, poor: 5, moderate: 20 } }, { company: 'BETA', users: 50, poor: 0, moderate: 0, previous: null },
  ] } }));
  await page.route('**/api/cmdb/netskope/experience/attention', (route) => route.fulfill({ json: { adem_available: true, performance_rows: [], summary: { adem_listed: 0, office_listed: 0, office_poor: 0, office_fair: 0, remote_listed: 0, unknown_presence: 0 }, rows: [] } }));
  await page.goto('/netskope/experience');

  await page.getByRole('tab', { name: 'Para revisar' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Por empresa' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Por empresa' })).toHaveAttribute('aria-selected', 'true');
  const companies = page.getByRole('region', { name: 'Riesgo por empresa', exact: true });
  await expect(companies.getByRole('row', { name: /ALFA/ })).toContainText('40 de 200 · 20 %');
  await expect(companies.getByRole('row', { name: /BETA/ })).toContainText('0 %');
  // 20 % now vs 12,5 % last week; a company without a snapshot reads "Sin dato", not 0.
  await expect(companies.getByRole('row', { name: /ALFA/ })).toContainText('Aumenta +7,5 pp');
  await expect(companies.getByRole('row', { name: /BETA/ })).toContainText('Sin dato');
  await expect(companies.getByText('Otras empresas: 30 usuarios.')).toBeVisible();
  const titleBox = await companies.getByRole('heading', { name: 'Usuarios con señales de riesgo por empresa' }).boundingBox();
  const helpBox = await companies.getByRole('button', { name: 'Ayuda: Por empresa' }).boundingBox();
  expect(titleBox).not.toBeNull();
  expect(helpBox).not.toBeNull();
  expect(Math.abs(titleBox!.y + titleBox!.height / 2 - helpBox!.y - helpBox!.height / 2)).toBeLessThan(4);
  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    const axe = await new AxeBuilder({ page }).include('.nsk-users-workspace').analyze();
    expect(axe.violations.map(({ id }) => id), `${theme} companies axe`).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`users-companies-${theme}.png`) });
  }
  // The "A revisar" cell opens the review queue already filtered to that company.
  const attentionCompanies: string[] = [];
  await page.route('**/api/cmdb/netskope/experience/attention?*', (route) => {
    attentionCompanies.push(new URL(route.request().url()).searchParams.get('company') ?? '');
    return route.fulfill({ json: { adem_available: true, performance_rows: [], summary: { adem_listed: 0, office_listed: 0, office_poor: 0, office_fair: 0, remote_listed: 0, unknown_presence: 0 }, rows: [
      { email: 'alfa.user@example.com', name: 'Alfa User', user_id: null, company: 'ALFA', uci_rating: 'Poor', uci_score: 90, uci_previous: null, adem_score: null, reasons: ['uci'], presence: 'unknown', performance_band: null },
    ] } });
  });
  await companies.getByRole('button', { name: /Revisar a las 40 personas de ALFA/ }).click();
  await expect(page.getByRole('tab', { name: 'Para revisar' })).toHaveAttribute('aria-selected', 'true');
  const queue = page.getByRole('region', { name: 'Personas para revisar' });
  await expect(queue.getByRole('row', { name: /Alfa User/ })).toBeVisible();
  expect(attentionCompanies).toEqual(['ALFA']);
  await queue.getByRole('button', { name: 'Quitar filtro de empresa ALFA' }).click();
  await expect(queue.getByRole('button', { name: /Quitar filtro de empresa/ })).toHaveCount(0);
  await expect(queue.getByRole('row', { name: /Alfa User/ })).toHaveCount(0);
  expect(attentionCompanies).toEqual(['ALFA']);
  await page.getByRole('tab', { name: 'Por empresa' }).click();
  await page.getByRole('button', { name: 'Ver usuarios con señales de riesgo' }).click();
  await expect(page).toHaveURL(/\/netskope\/uci$/);
});
