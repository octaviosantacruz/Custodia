import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, mockAuthenticatedApp, test } from '../../support/fixtures';

const SIGNAL = '2026-09-01T00:00:00Z';
const device = (id: number, name: string) => ({ object_id: id, name, user: `${name.toLowerCase()}@example.test`, os: 'Windows 10.0.19041', client_version: '128.0.0', last_event: 'Uninstalled', detected_at: SIGNAL });
const check = (over: Record<string, unknown>) => ({
  id: 'client_protection_off', entity: 'device', severity: 'high', title: 'Cliente desinstalado o deshabilitado',
  description: 'El último evento del cliente es Uninstalled.', status: 'evaluated', count: 0, query: { coverage_risk: '1' }, findings: [], ...over,
});
const POSTURE = {
  checks: [
    check({ count: 12, findings: [device(1, 'LAPTOP-1'), device(2, 'LAPTOP-2')] }),
    check({ id: 'client_two_plus_behind', severity: 'medium', title: 'Cliente 2 o más releases golden atrás', status: 'not_configured', query: { client_compliance: 'two_plus_behind' } }),
    check({ id: 'stale_undiagnosed', severity: 'medium', title: 'Sin señal hace más de 30 días', count: 30, query: { event_age: 'gt_30d', review_diagnosis: 'undetermined' }, findings: [device(3, 'OLD-3')] }),
    check({ id: 'duplicate_hostname', severity: 'low', title: 'Hostname con varios equipos activos', count: 0, query: { duplicate: 'hostname' } }),
    check({ id: 'uci_poor', entity: 'user', severity: 'high', title: 'Usuario con confianza baja', status: 'not_permitted', query: { rating: 'Poor' } }),
  ],
  source_evidence: { source_fresh: true, source_status: 'completed', source_completed_at: new Date(Date.now() - 3_600_000).toISOString(), as_of: new Date().toISOString() },
  uci_captured_at: null,
};

async function openPosture(page: Page) {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/cmdb/netskope/posture', (route) => route.fulfill({ json: POSTURE }));
  await page.goto('/netskope/posture');
  return page.getByRole('region', { name: 'Postura Netskope' });
}

test('NSK-POSTURE-001: the band adds only evaluated checks and one table lists every check, the pending ones last', async ({ page }) => {
  const region = await openPosture(page);
  await expect(region.locator('.summary-stat').filter({ hasText: 'Hallazgos' }).first()).toContainText('42');
  await expect(region.locator('.summary-stat').filter({ hasText: 'Severidad alta' })).toContainText('12');
  await expect(region.locator('.summary-stat').filter({ hasText: 'Severidad media' })).toContainText('30');
  await expect(region.locator('.summary-stat').filter({ hasText: 'En usuarios' })).toContainText('No evaluado');
  await expect(region.locator('.summary-stat').filter({ hasText: 'En equipos' })).toContainText('42');
  await expect(region.getByText(/Inventario sincronizado hace/)).toBeVisible();
  const table = region.getByRole('table', { name: 'Hallazgos de postura Netskope por chequeo' });
  const rows = table.getByRole('row');
  await expect(rows).toHaveCount(6);
  await expect(rows.nth(1)).toContainText('Cliente desinstalado o deshabilitado');
  await expect(rows.nth(2)).toContainText('Sin señal hace más de 30 días');
  await expect(rows.nth(3)).toContainText('Hostname con varios equipos activos');
  await expect(table.getByRole('row', { name: /Cliente 2 o más releases golden atrás/ })).toContainText('Sin releases golden configuradas');
  await expect(table.getByRole('row', { name: /confianza baja/ })).toContainText('Requiere el permiso para confianza de usuarios');
  // Tabs are gone: one question, one table. Policy activity is no longer here.
  await expect(region.getByRole('button', { name: 'Resumen', exact: true })).toHaveCount(0);
  await expect(region.getByText('Actividad de políticas')).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).include('.nsk-posture').analyze();
  expect(axe.violations).toEqual([]);
});

test('NSK-POSTURE-001: a check expands to its sample and its detail, keeps it in the URL and opens the exact inventory list', async ({ page }) => {
  const region = await openPosture(page);
  const toggle = region.getByRole('button', { name: /Cliente desinstalado o deshabilitado/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page).toHaveURL(/open=client_protection_off/);
  const sample = region.getByRole('table', { name: 'Muestra de Cliente desinstalado o deshabilitado' });
  await expect(sample.getByRole('row')).toHaveCount(3);
  await expect(sample).toContainText('LAPTOP-1');
  await expect(region.getByText('Se muestran 2 de 12.')).toBeVisible();
  await expect(region.getByRole('heading', { name: 'Último evento del cliente' })).toBeVisible();
  await region.getByRole('button', { name: 'Media · 30' }).click();
  await expect(region.getByRole('button', { name: /Cliente desinstalado o deshabilitado/ })).toHaveCount(0);
  const devices = page.waitForRequest((request) => request.url().includes('/api/cmdb/netskope/devices?') && request.url().includes('review_diagnosis=undetermined'));
  await region.getByRole('row', { name: /Sin señal hace más de 30 días/ }).getByRole('button', { name: 'Ver en inventario' }).click();
  await expect(page).toHaveURL(/\/netskope\/inventory\?.*event_age=gt_30d/);
  const request = new URL((await devices).url());
  expect(request.searchParams.get('freshness')).toBe('all');
  expect(request.searchParams.get('event_age')).toBe('gt_30d');
});

test('NSK-POL-RETHINK-001: the retired Políticas link and the old policy tab land on Postura', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read', 'netskope:read'] });
  await page.route('**/api/cmdb/netskope/posture', (route) => route.fulfill({ json: POSTURE }));
  await page.goto('/netskope/policies');
  await expect(page).toHaveURL(/\/netskope\/posture/);
  await expect(page.getByRole('table', { name: 'Hallazgos de postura Netskope por chequeo' })).toBeVisible();
  await page.goto('/netskope/posture?section=policies');
  await expect(page.getByRole('table', { name: 'Hallazgos de postura Netskope por chequeo' })).toBeVisible();
});
