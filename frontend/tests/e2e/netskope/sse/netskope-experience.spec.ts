import { expectSystemSearch } from '../../support/search-control';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, mockAuthenticatedApp, test } from '../../support/fixtures';

const NO_SCORE = { source: 'netskope_adem', window_start: 1790700000, window_end: 1790786400, score: null, weakest: null, devices: [], devices_total: 0 };
const mockEmptyScore = async (page: Page) => {
  await page.route('**/api/cmdb/netskope/users/601/experience/score?*', (route) => route.fulfill({ json: NO_SCORE }));
  // Without netskope:uba_read the anomalies block and the queue stay hidden.
  await page.route('**/api/cmdb/netskope/experience/attention', (route) => route.fulfill({ status: 403, json: { detail: 'x' } }));
  await page.route('**/api/cmdb/netskope/users/601/anomalies', (route) => route.fulfill({ status: 403, json: { detail: 'Requiere el permiso netskope:uba_read.' } }));
};


test('Usuarios (antes Experiencia digital) presents windowed observations and preserves the old URL', async ({ page }) => {
  const reads: string[] = [];
  page.on('request', (request) => reads.push(new URL(request.url()).pathname));
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await mockEmptyScore(page);
  let popListRequests = 0;
  await page.route('**/api/cmdb/netskope/experience/pops?*', async (route) => {
    popListRequests += 1;
    await route.fulfill({ json: { pops: ['AR-BUE1', 'BR-SAO1'], total: 2, window_start: 1790700000, window_end: 1790786400 } });
  });

  await page.goto('/netskope/dem/sites');
  await expect(page).toHaveURL(/\/netskope\/experience$/);
  await expect(page.getByRole('heading', { name: 'Consultar una persona' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Para revisar' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(/seguí su recorrido|ver recorrido/i)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'POPs observados' })).toHaveCount(0);
  expect(popListRequests).toBe(0);
  await openUser(page);
  await expect(page.getByRole('dialog', { name: 'QA User' })).toBeVisible();
  expect(reads.filter((path) => /\/uci|\/anomalies|\/attention/.test(path))).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('searchbox', { name: 'Buscar usuario por nombre o correo' })).toBeFocused();
});

test('NSK-EXP-UEBA-001: the selected user lists anomalies by severity and hides them without the UBA permission', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read', 'netskope:uba_read'] });
  await mockEmptyScore(page);
  await page.route('**/api/cmdb/netskope/devices?*', (route) => route.fulfill({ json: { rows: [], total: 0, limit: 50, offset: 0, search: '', filters: {} } }));
  await page.route('**/api/cmdb/netskope/users/601/experience/devices?*', (route) => route.fulfill({ json: { source: 'netskope_adem', window_start: 1790700000, window_end: 1790707200, devices: [] } }));
  const item = (severity: string, rule: string, time: string) => ({ severity, scenario: 'Insider threat', sub_scenario: 'DLP violation', rule, activity: 'Upload', app: 'Drive', score: 100, time });
  await page.route('**/api/cmdb/netskope/users/601/anomalies', (route) => route.fulfill({ json: {
    total: 4361, returned: 1000, truncated: true, window_days: 30,
    by_severity: { high: 2, medium: 5, low: 990, informational: 0, unknown: 3 },
    by_scenario: [{ scenario: 'Insider threat', sub_scenario: 'DLP violation', count: 990 }], top_rules: [{ rule: 'Low Severity DLP policy violation', count: 900 }],
    recent: [item('high', 'UEBA rule-based violation', '2026-10-09T10:00:00Z'), item('low', 'Low Severity DLP policy violation', '2026-10-10T10:00:00Z')],
  } }));
  await page.goto('/netskope/experience');
  await page.getByRole('searchbox', { name: 'Buscar usuario por nombre o correo' }).fill('qa');
  await page.getByRole('option', { name: 'QA User qa.user@example.com' }).click();
  const region = page.getByRole('region', { name: 'Anomalías del usuario' });
  await expect(region.getByRole('list', { name: 'Anomalías por severidad' })).toContainText('Alta');
  await expect(region.getByRole('list', { name: 'Anomalías por severidad' })).not.toContainText('Informativa');
  await expect(region.getByText('Se analizan 1.000 de 4.361.')).toBeVisible();
  await expect(region.getByRole('row').nth(1)).toContainText('UEBA rule-based violation');
  await expect(region.getByText(/10\.|@/)).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).include('.nsk-user-anomalies').analyze();
  expect(axe.violations).toEqual([]);

  // Forbidden: the block disappears, nothing else breaks.
  await page.route('**/api/cmdb/netskope/users/601/anomalies', (route) => route.fulfill({ status: 403, json: { detail: 'x' } }));
  await page.reload();
  await page.getByRole('searchbox', { name: 'Buscar usuario por nombre o correo' }).fill('qa');
  await page.getByRole('option', { name: 'QA User qa.user@example.com' }).click();
  await expect(page.getByRole('region', { name: 'Equipos del usuario' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Anomalías del usuario' })).toHaveCount(0);
});

/* NSK-EXP-OFFICE-001: the office measurement response; `days` measured days in the window and the last two weeks. */
function officeExperience({ configured = true, days = 7, measurement = null }: { configured?: boolean; days?: number; measurement?: { status: string; started_at: string | null; completed_at: string | null } | null } = {}) {
  const week = (start: string, measured: number | null, poor = 0, fair = 0, worse = 0, daysMeasured = 7, office: number | null = 88, remote: number | null = 89) => ({
    week_start: start, days_measured: measured === null ? 0 : daysMeasured, office_people: measured, measured, poor: measured === null ? null : poor,
    fair: measured === null ? null : fair, worse_in_office: measured === null ? null : worse,
    office_avg: measured === null ? null : office, remote_avg: measured === null ? null : remote,
  });
  const person = (email: string, name: string | null, office: number | null, band: string | null, remote: number | null, worse: boolean, officeDays: number) => ({
    email, name, company: name ? 'ACME' : null, office_days: officeDays, office_minutes: officeDays * 480, office_score: office, office_band: band, remote_score: remote, worse_in_office: worse,
  });
  return {
    configured, measurement, window_start: '2026-10-12', window_end: '2026-10-18', last_measured_at: days ? '2026-10-19T03:00:00Z' : null, office_gap: 15,
    summary: days ? { office_people: 4, measured: 3, poor: 1, fair: 1, good: 1, worse_in_office: 1, days_measured: days, office_avg: 57.3, remote_avg: 81.7, paired: 3 }
      : { office_people: 0, measured: 0, poor: 0, fair: 0, good: 0, worse_in_office: 0, days_measured: 0, office_avg: null, remote_avg: null, paired: 0 },
    people: days ? [
      person('poor@example.com', 'Poor Office', 22, 'poor', 88, true, 2), person('fair@example.com', null, 60, 'fair', 66, false, 1),
      person('good@example.com', 'Good Office', 90, 'good', 91, false, 5), person('nodata@example.com', null, null, null, 80, false, 1),
    ] : [],
    people_total: days ? 4 : 0,
    weekdays: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].map((name, weekday) => weekday < 5
      ? { weekday, name, days_measured: 2, office_people_per_day: 400 + weekday, office_avg: 88 + weekday / 10, flagged_person_days: weekday === 0 ? 2 : 0 }
      : { weekday, name, days_measured: 0, office_people_per_day: null, office_avg: null, flagged_person_days: null }),
    companies: { rows: [{ company: 'ACME', office_people: 2, measured: 2, flagged: 1, worse_in_office: 1, office_avg: 56 }, { company: 'Sin empresa', office_people: 2, measured: 1, flagged: 1, worse_in_office: 0, office_avg: 60 }], omitted_people: 0 },
    series: days ? [week('2026-09-14', null), week('2026-09-21', 40, 0, 2), week('2026-09-28', null), week('2026-10-05', 30, 1, 3, 0, 4), week('2026-10-12', 3, 1, 1, 1), week('2026-10-19', null)]
      : [week('2026-10-12', null), week('2026-10-19', null)],
  };
}

test('NSK-EXP-OFFICE-001: Rendimiento answers how many had a poor or fair score in the office, with its weekly evolution', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read', 'netskope:uba_read'] });
  await mockEmptyScore(page);
  await page.route('**/api/cmdb/netskope/experience/attention', (route) => route.fulfill({ json: { adem_available: true, rows: [], performance_rows: [],
    summary: { adem_listed: 0, office_listed: 0, office_poor: 0, office_fair: 0, remote_listed: 0, unknown_presence: 0 } } }));
  await page.route('**/api/cmdb/netskope/experience/office**', (route) => route.fulfill({ json: officeExperience() }));
  await page.goto('/netskope/office');
  const view = page.getByRole('region', { name: 'Rendimiento en la oficina' });
  const headline = view.getByRole('group', { name: 'Resumen de los últimos 7 días' });
  await expect(headline).toContainText('2 de 3 personas medidas en la oficina tuvieron rendimiento malo o regular');
  await expect(headline).toContainText('Peor en oficina que en remoto 1');
  await expect(headline).toContainText('Sin dato 1');
  await expect(view).toContainText('7 de 7 días medidos');
  // One chart: a value label per measured week; a gap between measured weeks is never drawn as zero, and weeks
  // before the first measurement or after the last one are not drawn at all.
  const chart = view.getByRole('img', { name: /Evolución semanal/ });
  await expect(chart).toContainText('4 de 30');
  await expect(chart).toContainText('2 de 3');
  await expect(chart).toContainText('Sin medición');
  await expect(chart).not.toContainText('14–20 sept');
  await expect(chart).not.toContainText('19–25 oct');
  await view.getByRole('img', { name: /Semana del 5–11 oct/ }).first().hover();
  await expect(view.getByRole('tooltip')).toContainText('4 de 7 días medidos');
  await view.getByRole('region', { name: 'Personas con rendimiento malo o regular por semana' }).getByRole('button', { name: 'Ver como tabla' }).click();
  await expect(view.getByRole('row', { name: /5–11 oct/ }).first()).toContainText('30');
  await expect(view.getByRole('row', { name: /28 sept?–4 oct/ }).first()).toContainText('Sin medición');
  // People: poor or fair first by default, worst first; a missing score is "Sin dato", never good.
  const rows = view.locator('.nsk-office-table tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Poor Office');
  await expect(rows.first()).toContainText('Peor en oficina -66');
  await expect(view.getByRole('button', { name: /Malo, regular o peor en oficina/ })).toHaveAttribute('aria-pressed', 'true');
  await view.getByRole('button', { name: /Todas en oficina/ }).click();
  await expect(rows).toHaveCount(4);
  await expect(view.getByRole('row', { name: /nodata@example.com/ })).toContainText('Sin dato');
  // One detail table at a time: an unmeasured weekday is "Sin medición", never zero; companies with their denominator.
  const detail = view.getByRole('group', { name: 'Detalle' });
  await detail.getByRole('button', { name: 'Por día' }).click();
  await expect(view.locator('.nsk-office-table')).toHaveCount(0);
  await expect(view.getByRole('region', { name: 'Por día de la semana' }).getByRole('row', { name: /Domingo/ })).toContainText('Sin medición');
  await detail.getByRole('button', { name: 'Por empresa' }).click();
  await expect(view.getByRole('region', { name: 'Por día de la semana' })).toHaveCount(0);
  await expect(view.getByRole('region', { name: 'Por empresa' }).getByRole('row', { name: /ACME/ })).toContainText('1 de 2');
  await view.getByRole('group', { name: 'Métrica de la evolución' }).getByRole('button', { name: 'Promedio' }).click();
  await expect(view.getByRole('region', { name: 'Personas con rendimiento malo o regular por semana' })).toHaveCount(0);
  await expect(view.getByRole('region', { name: 'Puntaje promedio por semana' })).toContainText('88');
  const axe = await new AxeBuilder({ page }).include('.nsk-office').analyze();
  expect(axe.violations).toEqual([]);
  await view.getByRole('group', { name: 'Detalle' }).getByRole('button', { name: 'Personas' }).click();
  await view.getByRole('group', { name: 'Métrica de la evolución' }).getByRole('button', { name: 'Malo o regular' }).click();
  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await page.screenshot({ path: test.info().outputPath(`office-${theme}.png`), fullPage: true });
  }
});

test('NSK-EXP-OFFICE-001: the people table pages in place instead of an inner scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read', 'netskope:uba_read'] });
  await mockEmptyScore(page);
  const base = officeExperience();
  const people = Array.from({ length: 45 }, (_, index) => ({ email: `p${index}@example.com`, name: `Persona ${index}`, company: 'ACME', office_days: 2, office_minutes: 960, office_score: 50, office_band: 'fair', remote_score: 80, worse_in_office: true }));
  await page.route('**/api/cmdb/netskope/experience/office**', (route) => route.fulfill({ json: { ...base, people, people_total: 45 } }));
  await page.goto('/netskope/office');
  const view = page.getByRole('region', { name: 'Rendimiento en la oficina' });
  const rows = view.locator('.nsk-office-table tbody tr');
  await expect(rows).toHaveCount(20);
  await expect(view.locator('.nsk-office-table').locator('xpath=ancestor::div[contains(@class,"compact-table-wrap")]')).toHaveCSS('max-height', 'none');
  await view.getByRole('button', { name: 'Ver 20 más' }).click();
  await expect(rows).toHaveCount(40);
  await view.getByRole('button', { name: 'Ver 5 más' }).click();
  await expect(rows).toHaveCount(45);
  await expect(view.getByRole('button', { name: /más$/ })).toHaveCount(0);
});

test('NSK-EXP-OFFICE-001: while the first measurement runs, the tab says so and how many days are in', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read', 'netskope:uba_read'] });
  await mockEmptyScore(page);
  await page.route('**/api/cmdb/netskope/experience/attention', (route) => route.fulfill({ json: { adem_available: true, rows: [], performance_rows: [],
    summary: { adem_listed: 0, office_listed: 0, office_poor: 0, office_fair: 0, remote_listed: 0, unknown_presence: 0 } } }));
  await page.route('**/api/cmdb/netskope/experience/office**', (route) => route.fulfill({ json: officeExperience({
    days: 0, measurement: { status: 'running', started_at: '2026-10-19T15:19:41Z', completed_at: null } }) }));
  await page.goto('/netskope/office');
  const status = page.getByRole('region', { name: 'Rendimiento en la oficina' }).getByRole('status');
  await expect(status).toContainText('Midiendo ahora');
  await expect(status).toContainText('0 de 7 días medidos');
  await expect(status).toContainText('se actualiza sola');
});

test('NSK-EXP-OFFICE-001: a person ficha shows the last 7 days as office, remote, no signal or pending', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read', 'netskope:uba_read'] });
  await mockEmptyScore(page);
  await page.route('**/api/cmdb/netskope/experience/office?**', (route) => route.fulfill({ json: officeExperience() }));
  const person = { email: 'poor@example.com', window_start: '2026-10-12', window_end: '2026-10-18', days: [
    { day: '2026-10-12', place: 'office', measured: true, office_minutes: 480, office_score: 22, remote_minutes: 0, remote_score: null },
    { day: '2026-10-13', place: 'remote', measured: true, office_minutes: 0, office_score: null, remote_minutes: 300, remote_score: 88 },
    { day: '2026-10-14', place: 'no_signal', measured: true, office_minutes: 0, office_score: null, remote_minutes: 0, remote_score: null },
    ...['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'].map((day) => ({ day, place: 'office', measured: false, office_minutes: 0, office_score: null, remote_minutes: 0, remote_score: null })),
  ] };
  const asked: string[] = [];
  await page.route('**/api/cmdb/netskope/experience/office/person**', (route) => { asked.push(new URL(route.request().url()).searchParams.get('email') ?? ''); return route.fulfill({ json: person }); });
  await page.goto('/netskope/office');
  await page.getByRole('region', { name: 'Rendimiento en la oficina' }).getByRole('button', { name: /Poor Office/ }).click();
  const week = page.getByRole('dialog').getByRole('region', { name: 'Últimos 7 días de la persona' });
  await expect(week.getByRole('row', { name: /Lugar/ })).toContainText('OficinaRemotoSin señal');
  await expect(week.getByRole('row', { name: /Puntaje/ })).toContainText('22 · 8 h');
  await expect(week.getByRole('row', { name: /Puntaje/ })).toContainText('Pendiente');
  expect(asked).toEqual(['poor@example.com']);
});

/* NSK-EXP-OFFICE-002: the timeline response; the person's fields only come when a person was asked for. */
function officeTimeline(url: URL) {
  const company = url.searchParams.get('company');
  const email = url.searchParams.get('email');
  const point = (day: string, measured: boolean, office: number | null, officePeople: number | null, remote: number | null, remotePeople: number | null, own?: number | null) => ({
    day, measured, office_avg: office, office_people: officePeople, remote_avg: remote, remote_people: remotePeople,
    ...(email ? { person_office: own ?? null, person_office_minutes: own == null ? 0 : 480, person_remote: null, person_remote_minutes: 0 } : {}),
  });
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  return {
    first: start ?? '2026-09-19', last: end ?? '2026-10-18', company, min_people: 5,
    companies: [{ company: 'ACME', people: 582 }, { company: 'Sin empresa', people: 3 }],
    person: email ? { email, name: 'QA User', company: 'ACME' } : null,
    points: [
      point('2026-10-12', true, company ? 80 : 88, company ? 300 : 439, 90, 400, 40),
      point('2026-10-13', true, 86, 503, 89, 380, 45),
      point('2026-10-14', false, null, null, null, null),
      point('2026-10-18', true, 70, 3, 88, 120, null),
    ].filter((row) => !start || (row.day >= start && row.day <= (end ?? row.day))),
  };
}

test('NSK-EXP-OFFICE-002: the daily timeline filters by company and overlays one person, with gaps and thin days marked', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read', 'netskope:uba_read'] });
  await mockEmptyScore(page);
  await page.route('**/api/cmdb/netskope/experience/office?**', (route) => route.fulfill({ json: officeExperience() }));
  const asked: string[] = [];
  await page.route('**/api/cmdb/netskope/experience/office/timeline?**', (route) => {
    const url = new URL(route.request().url());
    asked.push(url.search);
    return route.fulfill({ json: officeTimeline(url) });
  });
  await page.goto('/netskope/office');
  await page.getByRole('tab', { name: 'Evolución diaria' }).click();
  const view = page.getByRole('region', { name: 'Evolución diaria' });
  // Everyone by default, office and remote: a day without measurement is a gap, a thin day says so.
  await expect(view.getByRole('group', { name: 'Evolución diaria del puntaje promedio, Todas las empresas' })).toBeVisible();
  await expect(view.getByRole('button', { name: /14 oct: sin medición/ })).toBeVisible();
  await view.getByRole('button', { name: /18 oct:/ }).hover();
  await expect(view.getByRole('tooltip')).toContainText('3 personas (pocas)');
  await expect(view.locator('circle.is-few')).toHaveCount(1);
  expect(asked.at(-1)).toBe('?days=30');
  // The summary names the measured span, not the requested 30 days.
  const summary = view.getByLabel('Resumen del período');
  await expect(summary).toContainText('12 oct al 18 oct · promedio de 3 días medidos');
  // Choosing days on the chart: a click, Ctrl + click for loose days, a drag for a run, the keyboard too.
  const day = (label: RegExp) => view.getByRole('button', { name: label });
  await day(/^12 oct:/).click();
  await expect(summary).toContainText('Día elegido: lun 12 oct');
  await expect(summary).toContainText('Oficina · Todas las empresas 88 · 439 personas');
  await expect(day(/^12 oct:/)).toHaveAttribute('aria-pressed', 'true');
  await day(/^18 oct:/).click({ modifiers: ['ControlOrMeta'] });
  await expect(summary).toContainText('2 días elegidos: 12 oct y 18 oct · promedio de 2 días medidos');
  await day(/^18 oct:/).click({ modifiers: ['ControlOrMeta'] });
  await expect(summary).toContainText('Día elegido: lun 12 oct');
  const from = await day(/^12 oct:/).boundingBox();
  const to = await day(/^14 oct:/).boundingBox();
  if (!from || !to) throw new Error('Sin días en el gráfico');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(summary).toContainText('3 días elegidos: 12 oct, 13 oct y 14 oct · promedio de 2 días medidos');
  await page.screenshot({ path: test.info().outputPath('timeline-selection.png'), fullPage: true });
  await day(/^18 oct:/).focus();
  await page.keyboard.press('Enter');
  await expect(summary).toContainText('Día elegido: dom 18 oct');
  await expect(summary).toContainText('3 personas');
  await summary.getByRole('button', { name: 'Quitar selección' }).click();
  await expect(summary).toContainText('12 oct al 18 oct');
  // Company filter.
  await view.locator('.custom-select-trigger').click();
  await page.getByRole('option', { name: 'ACME · 582' }).click();
  await expect.poll(() => asked.at(-1)).toBe('?days=30&company=ACME');
  await expect(view.getByRole('group', { name: 'Evolución diaria del puntaje promedio, ACME' })).toBeVisible();
  // A person on top of the company average, with a way back to their ficha.
  await view.getByRole('searchbox', { name: 'Buscar una persona para comparar' }).fill('qa');
  await view.getByRole('option', { name: 'QA User qa.user@example.com' }).click();
  await expect.poll(() => asked.at(-1)).toBe('?days=30&company=ACME&email=qa.user%40example.com');
  await expect(view.getByLabel('Resumen del período')).toContainText('QA User en oficina');
  await expect(view.getByRole('button', { name: 'Abrir ficha de QA User' })).toBeVisible();
  await expect(view.getByRole('button', { name: /Comparar con su empresa/ })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('timeline-person.png'), fullPage: true });
  // Office only, then as a table: an unmeasured day reads "Sin medición", a missing score "Sin dato", never zero.
  await view.getByRole('group', { name: 'Lugar' }).getByRole('button', { name: 'Oficina', exact: true }).click();
  await expect(view.getByLabel('Resumen del período')).not.toContainText('Remoto');
  await view.getByRole('button', { name: 'Ver como tabla' }).click();
  await expect(view.getByRole('row', { name: /14 oct/ })).toContainText('Sin medición');
  await expect(view.getByRole('row', { name: /18 oct/ })).toContainText('Sin dato');
  await view.getByRole('group', { name: 'Período' }).getByRole('button', { name: '90 días' }).click();
  await expect.poll(() => asked.at(-1)).toBe('?days=90&company=ACME&email=qa.user%40example.com');
  await view.getByRole('button', { name: 'Quitar a QA User' }).click();
  await expect(view.getByRole('searchbox', { name: 'Buscar una persona para comparar' })).toBeVisible();
  // A chosen date: the summary answers that day with its averages and how many people they cover.
  await view.getByRole('group', { name: 'Lugar' }).getByRole('button', { name: 'Oficina y remoto' }).click();
  await view.getByRole('group', { name: 'Período' }).getByRole('button', { name: 'Fechas' }).click();
  await expect.poll(() => asked.at(-1)).toMatch(/^\?days=30&start=\d{4}-\d{2}-\d{2}&end=\d{4}-\d{2}-\d{2}&company=ACME$/);
  // Custodia's own calendar (not the browser's): the same day twice is that date alone.
  await view.getByRole('button', { name: 'Abrir calendario' }).click();
  const calendar = page.getByRole('dialog', { name: 'Fechas' });
  await expect(calendar.getByRole('heading')).toContainText(/octubre/i);
  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await page.screenshot({ path: test.info().outputPath(`calendar-${theme}.png`) });
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await calendar.locator('.date-range-field-cell', { hasText: /^12$/ }).click();
  await calendar.locator('.date-range-field-cell', { hasText: /^12$/ }).click();
  await expect.poll(() => asked.at(-1)).toBe('?days=30&start=2026-10-12&end=2026-10-12&company=ACME');
  await expect(summary).toContainText('12 oct');
  await expect(summary).toContainText('Oficina · ACME 80 · 300 personas');
  await expect(summary).toContainText('Remoto · ACME 90 · 400 personas');
  // Typing a start after the end asks for a valid range and never reads it.
  const startDay = view.locator('.date-range-field-input').first().locator('[data-type="day"]');
  await startDay.click();
  await page.keyboard.type('13');
  await expect(view.getByText('Elegí un rango válido')).toBeVisible();
  expect(asked.some((search) => search.includes('start=2026-10-13&end=2026-10-12'))).toBe(false);
  // A preset closes the calendar and reads that range.
  await view.getByRole('button', { name: 'Abrir calendario' }).click();
  await page.getByRole('dialog', { name: 'Fechas' }).getByRole('button', { name: 'Ayer' }).click();
  await expect(page.getByRole('dialog', { name: 'Fechas' })).toHaveCount(0);
  await expect.poll(() => asked.at(-1)).toMatch(/^\?days=30&start=(\d{4}-\d{2}-\d{2})&end=\1&company=ACME$/);
  await view.getByRole('button', { name: 'Abrir calendario' }).click();
  await page.getByRole('dialog', { name: 'Fechas' }).locator('.date-range-field-cell', { hasText: /^12$/ }).click();
  await page.getByRole('dialog', { name: 'Fechas' }).locator('.date-range-field-cell', { hasText: /^18$/ }).click();
  // 12–18 oct was read before (the default range), so it comes from the cache: the summary is the proof.
  await expect(page.getByRole('dialog', { name: 'Fechas' })).toHaveCount(0);
  await expect(summary).toContainText('promedio de 3 días medidos');
  const axe = await new AxeBuilder({ page }).include('.nsk-timeline').analyze();
  expect(axe.violations).toEqual([]);
  await expect(view.getByRole('group', { name: /Evolución diaria del puntaje promedio/ })).toBeVisible();
  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await page.screenshot({ path: test.info().outputPath(`timeline-${theme}.png`), fullPage: true });
  }
});

test('NSK-EXP-UEBA-001: the Riesgo queue lists only low or moderate confidence, says "Sin dato" for a missing change and opens the user', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read', 'netskope:uba_read'] });
  await mockEmptyScore(page);
  await page.route('**/api/cmdb/netskope/experience/attention', (route) => route.fulfill({ json: { adem_available: true, performance_rows: [
    { email: 'qa.user@example.com', name: 'QA User', user_id: '601', uci_rating: 'Poor', uci_score: 120, uci_previous: 300, adem_score: 52, reasons: ['uci', 'adem'], presence: 'office', performance_band: 'fair' },
    { email: 'solo.adem@example.com', name: null, user_id: null, uci_rating: null, uci_score: null, uci_previous: null, adem_score: 60, reasons: ['adem'], presence: 'remote', performance_band: 'fair' },
  ], summary: { adem_listed: 2, office_listed: 1, office_poor: 0, office_fair: 1, remote_listed: 1, unknown_presence: 0 }, rows: [
    { email: 'qa.user@example.com', name: 'QA User', user_id: '601', uci_rating: 'Poor', uci_score: 120, uci_previous: 300, adem_score: 52, reasons: ['uci', 'adem'], presence: 'office', performance_band: 'fair' },
    { email: 'solo.uci@example.com', name: null, user_id: null, uci_rating: 'Moderate', uci_score: 500, uci_previous: null, adem_score: null, reasons: ['uci'], presence: 'unknown', performance_band: null },
  ] } }));
  await page.route('**/api/cmdb/netskope/uci?*', (route) => route.fulfill({ json: {
    configured: true, captured_at: '2026-10-11T00:00:00Z', total: 1, by_rating: { Poor: 1, Moderate: 0 },
    rows: [{ email: 'qa.user@example.com', user_id: '601', name: 'QA User', rating: 'Poor', score: 120, previous_score: 300, scored_at: '2026-10-11T00:00:00Z' }],
  } }));
  await page.goto('/netskope/experience');
  const queue = page.getByRole('region', { name: 'Personas para revisar' });
  await expect(queue.getByRole('row', { name: /QA User/ })).toContainText('Empeora −180');
  // Performance lives in Rendimiento: no reason, location or score column here.
  await expect(queue.getByRole('row', { name: /QA User/ })).not.toContainText('Entre los menores puntajes de rendimiento');
  for (const column of [/Motivo/, /Ubicación/, /Rendimiento/]) await expect(queue.getByRole('columnheader', { name: column })).toHaveCount(0);
  const soloUci = queue.getByRole('row', { name: /solo.uci@example.com/ });
  await expect(soloUci).toContainText('Sin dato');
  await expect(soloUci).not.toContainText(/\b0\b/);
  const axe = await new AxeBuilder({ page }).include('.nsk-attention').analyze();
  expect(axe.violations).toEqual([]);
  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await page.screenshot({ path: test.info().outputPath(`users-review-${theme}.png`) });
  }
  await queue.getByRole('button', { name: /QA User/ }).click();
  const drawer = page.getByRole('dialog', { name: 'QA User' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Cerrar ficha', exact: true })).toBeFocused();
  await expect(drawer.getByRole('region', { name: 'Equipos del usuario' })).toBeVisible();
  await expect(drawer.getByRole('region', { name: 'Índice de confianza del usuario' })).toContainText('120 / 1000');
  await expect(drawer.getByRole('region', { name: 'Índice de confianza del usuario' })).toContainText('Empeora −180');
  const dialogAxe = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(dialogAxe.violations.map(({ id }) => id)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(queue.getByRole('button', { name: /QA User/ })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Para revisar' })).toHaveAttribute('aria-selected', 'true');
});

const DEVICE = (id: number, name: string, status: string | null, state = 'recent') => ({
  object_id: id, display_name: name, source_id: `dev-${id}`, first_seen_at: '', last_seen_at: '',
  device_evidence: { state, last_signal_at: '2026-10-10T10:00:00Z', source_fresh: true },
  attributes: { os: 'Windows', os_version: '11', hostname: name, ...(status ? { onprem_status: status, client_config: 'Default tenant config' } : {}) },
});

async function openUser(page: Page) {
  const search = page.getByRole('searchbox', { name: 'Buscar usuario por nombre o correo' });
  await search.fill('qa');
  await page.getByRole('option', { name: 'QA User qa.user@example.com' }).click();
  return page.getByRole('region', { name: 'Equipos del usuario' });
}

test('NSK-IA-001: the selected user has one device table that joins location and ADEM scores only by exact name (ADR 006)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/cmdb/netskope/users/601/anomalies', (route) => route.fulfill({ status: 403, json: { detail: 'x' } }));
  await page.route('**/api/cmdb/netskope/experience/attention', (route) => route.fulfill({ status: 403, json: { detail: 'x' } }));
  const rows = [DEVICE(1, 'LAPTOP-OFICINA', 'on-prem'), DEVICE(2, 'LAPTOP-CASA', 'off-prem'), DEVICE(3, 'VIEJO', 'off-prem', 'not_recent')];
  const requests: URLSearchParams[] = [];
  await page.route('**/api/cmdb/netskope/devices?*', (route) => {
    requests.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ json: { rows, total: rows.length, limit: 50, offset: 0, search: '', filters: {} } });
  });
  await page.route('**/api/cmdb/netskope/users/601/experience/score?*', (route) => route.fulfill({ json: {
    source: 'netskope_adem', window_start: 1790700000, window_end: 1790786400, score: 52, weakest: 'network', devices_total: 7,
    devices: [
      { device_id: 'adem-1', inventory_device_id: 1, device_name: 'laptop-oficina', device_os: 'Windows', exp_score: 52, device_score: 96, network_score: 15, app_score: 100 },
      { device_id: 'adem-9', inventory_device_id: null, device_name: 'SOLO-ADEM', device_os: 'Mac', exp_score: null, device_score: null, network_score: null, app_score: 90 },
    ],
  } }));
  const details: string[] = [];
  await page.route('**/api/cmdb/netskope/users/601/experience/devices/*?*', (route) => {
    const url = new URL(route.request().url());
    details.push(`${decodeURIComponent(url.pathname.split('/').at(-1)!)}:${url.searchParams.get('window_start')}`);
    return route.fulfill({ json: { source: 'netskope_adem', device_id: 'adem-1', window_start: 1790700000, window_end: 1790786400, pop: 'AR-BUE1', last_activity: 1790700600, activity_status: 'in_window' } });
  });
  await page.goto('/netskope/experience');
  const region = await openUser(page);
  await expect(region.getByLabel('Rendimiento digital 52 de 100')).toBeVisible();
  await expect(region.getByText('Componente con menor puntaje: Red')).toBeVisible();
  await expect(region.getByText('En oficina').first()).toBeVisible();
  // One row per device: the linked one carries location and scores together.
  const linked = region.getByRole('row', { name: /LAPTOP-OFICINA/ });
  await expect(linked).toContainText('En oficina');
  await expect(linked).toContainText('15');
  await expect(linked).toContainText('nombre exacto');
  await expect(region.getByRole('row', { name: /LAPTOP-OFICINA/ })).toHaveCount(1);
  // Same-name devices are not duplicated and an unlinked side keeps "Sin dato" for the other.
  await expect(region.getByRole('row', { name: /LAPTOP-CASA/ })).toContainText('Fuera de oficina');
  await expect(region.getByRole('row', { name: /LAPTOP-CASA/ })).toContainText('Sin dato');
  await expect(region.getByRole('row', { name: /SOLO-ADEM/ })).toContainText('Sin dato');
  await expect(region.getByRole('row', { name: /SOLO-ADEM/ })).not.toContainText('En oficina');
  await expect(region.getByRole('row', { name: /VIEJO/ })).toHaveClass(/is-stale/);
  await expect(region.getByText('ADEM: 2 de 7 equipos.')).toBeVisible();
  expect(requests.at(-1)?.get('observed_user_id')).toBe('601');
  expect(requests.at(-1)?.get('freshness')).toBe('all');
  // The POP is read only when the row is opened.
  expect(details).toHaveLength(0);
  await region.getByRole('button', { name: 'Detalle de LAPTOP-OFICINA' }).click();
  await expect(region.getByText('AR-BUE1', { exact: true })).toBeVisible();
  expect(details).toEqual(['adem-1:1790700000']);
  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    const axe = await new AxeBuilder({ page }).include('.nsk-user-devices').analyze();
    expect(axe.violations.map(({ id }) => id), `${theme} axe`).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`users-drawer-${theme}.png`) });
  }
});

test('NSK-IA-001: without ADEM the device table still answers the location and says ADEM is unavailable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/cmdb/netskope/users/601/anomalies', (route) => route.fulfill({ status: 403, json: { detail: 'x' } }));
  await page.route('**/api/cmdb/netskope/experience/attention', (route) => route.fulfill({ status: 403, json: { detail: 'x' } }));
  let rows = [DEVICE(1, 'LAPTOP-OFICINA', null)];
  await page.route('**/api/cmdb/netskope/devices?*', (route) => route.fulfill({ json: { rows, total: rows.length, limit: 50, offset: 0, search: '', filters: {} } }));
  await page.route('**/api/cmdb/netskope/users/601/experience/score?*', (route) => route.fulfill({ status: 503, json: { detail: 'Unavailable' } }));
  await page.goto('/netskope/experience');
  const region = await openUser(page);
  await expect(region.getByText('Rendimiento no disponible')).toBeVisible();
  // Before the on-prem field is synced the verdict is "Sin dato de ubicación", never remote.
  await expect(region.getByText('Sin dato de ubicación')).toBeVisible();
  await expect(region.getByText('Fuera de oficina')).toHaveCount(0);
  await expect(region.getByRole('row', { name: /LAPTOP-OFICINA/ })).toContainText('Sin dato');
  rows = [];
  await page.reload();
  const empty = await openUser(page);
  await expect(empty.getByText('Sin equipos vinculados')).toBeVisible();
});

const PRESENCE = {
  total: 4495, reported: 4461,
  statuses: [{ key: 'off-prem', count: 4064 }, { key: 'on-prem', count: 397 }, { key: 'Unknown', count: 34 }],
  methods: [{ key: 'Egress_IP', count: 4461 }, { key: 'Sin dato', count: 34 }],
  by_client_config: [
    { key: 'Default tenant config', total: 4388, statuses: { 'off-prem': 3990, 'on-prem': 364, Unknown: 34 } },
    { key: 'TestCiber', total: 79, statuses: { 'off-prem': 60, 'on-prem': 19 } },
  ],
  by_company: [{ key: 'ITTI', total: 4000, statuses: { 'off-prem': 3700, 'on-prem': 300 } }],
  company_omitted_devices: 495, missing_label: 'Sin dato',
  source_evidence: { source_fresh: true, source_status: 'completed', source_completed_at: new Date(Date.now() - 3_600_000).toISOString(), as_of: new Date().toISOString() },
};

test('NSK-IA-001: a linked device beyond the first inventory page is still merged into one row', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/cmdb/netskope/users/601/anomalies', (route) => route.fulfill({ status: 403, json: { detail: 'x' } }));
  await page.route('**/api/cmdb/netskope/experience/attention', (route) => route.fulfill({ status: 403, json: { detail: 'x' } }));
  const all = Array.from({ length: 51 }, (_, index) => DEVICE(index + 1, `PC-${String(index + 1).padStart(2, '0')}`, 'off-prem'));
  const pages: string[] = [];
  await page.route('**/api/cmdb/netskope/devices?*', (route) => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset') ?? 0);
    pages.push(String(offset));
    return route.fulfill({ json: { rows: all.slice(offset, offset + 50), total: 51, limit: 50, offset, search: '', filters: {} } });
  });
  await page.route('**/api/cmdb/netskope/users/601/experience/score?*', (route) => route.fulfill({ json: {
    source: 'netskope_adem', window_start: 1790700000, window_end: 1790786400, score: 52, weakest: 'network', devices_total: 1,
    devices: [{ device_id: 'adem-51', inventory_device_id: 51, device_name: 'pc-51', device_os: 'Windows', exp_score: 52, device_score: 96, network_score: 15, app_score: 100 }],
  } }));
  await page.goto('/netskope/experience');
  const region = await openUser(page);
  const row = region.getByRole('row', { name: /PC-51/ });
  await expect(row).toContainText('15');
  await expect(row).toContainText('nombre exacto');
  await expect(region.getByRole('row', { name: /pc-51/i })).toHaveCount(1);
  expect(pages).toEqual(['0', '50']);
});


test('Usuarios resolves a missing inventory ID only through a complete unique exact email and never opens another account', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read', 'netskope:uba_read'] });
  await mockEmptyScore(page);
  await page.route('**/api/cmdb/netskope/experience/attention', (route) => route.fulfill({ json: { adem_available: true, summary: { adem_listed: 0, office_listed: 0, office_poor: 0, office_fair: 0, remote_listed: 0, unknown_presence: 0 }, rows: [
    { email: 'qa.user@example.com', name: 'QA User', user_id: null, uci_rating: null, uci_score: null, uci_previous: null, adem_score: 75, reasons: ['adem'], presence: 'unknown', performance_band: null },
  ] } }));
  const similar = { object_id: 999, display_name: 'Other user', attributes: { email: 'qa.user@example.com.other' } };
  const exact = { object_id: 601, display_name: 'QA User', attributes: { email: 'QA.User@Example.com' } };
  let response = { rows: [similar, exact], total: 2 };
  await page.route('**/api/cmdb/netskope/users?*', (route) => route.fulfill({ json: response }));
  const deviceReads: string[] = [];
  await page.route('**/api/cmdb/netskope/devices?*', (route) => {
    deviceReads.push(new URL(route.request().url()).searchParams.get('observed_user_id') || '');
    return route.fulfill({ json: { rows: [], total: 0 } });
  });
  for (const kind of ['unique', 'ambiguous', 'incomplete', 'missing'] as const) {
    response = kind === 'unique' ? { rows: [similar, exact], total: 2 }
      : kind === 'ambiguous' ? { rows: [exact, { ...exact, object_id: 602 }], total: 2 }
      : kind === 'incomplete' ? { rows: [exact], total: 51 } : { rows: [similar], total: 1 };
    deviceReads.length = 0;
    await page.goto('/netskope/experience');
    await page.getByRole('region', { name: 'Personas para revisar' }).getByRole('button', { name: /QA User/ }).click();
    const drawer = page.getByRole('dialog', { name: 'QA User' });
    await expect(drawer).toBeVisible();
    if (kind === 'unique') {
      await expect(drawer.getByRole('region', { name: 'Equipos del usuario' })).toBeVisible();
      expect(deviceReads).toEqual(['601']);
    } else {
      await expect(drawer.getByText('Sin una identidad única en el inventario')).toBeVisible();
      expect(deviceReads).toEqual([]);
    }
    await page.keyboard.press('Escape');
  }
});

test('Riesgo keeps empty and failed sources explicit and retries the review list', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read', 'netskope:uba_read'] });
  let failed = true;
  await page.route('**/api/cmdb/netskope/experience/attention', (route) => failed
    ? route.fulfill({ status: 503, json: { detail: 'Unavailable' } })
    : route.fulfill({ json: { adem_available: false, summary: { adem_listed: 0, office_listed: 0, office_poor: 0, office_fair: 0, remote_listed: 0, unknown_presence: 0 }, rows: [] } }));
  await page.goto('/netskope/experience');
  await expect(page.getByText('No se pudieron leer las personas para revisar')).toBeVisible();
  failed = false;
  await page.getByRole('button', { name: 'Reintentar revisión' }).click();
  await expect(page.getByText('Sin personas en la lista de revisión')).toBeVisible();
  // An ADEM outage belongs to Rendimiento; the risk queue does not depend on it.
  await expect(page.getByText('Rendimiento no disponible')).toHaveCount(0);
  await page.route('**/api/cmdb/netskope/uci/companies', (route) => route.fulfill({ json: { companies: [], previous_week: null, omitted_users: 0 } }));
  await page.getByRole('tab', { name: 'Por empresa' }).click();
  await expect(page.getByText('Sin empresas para comparar')).toBeVisible();
});
