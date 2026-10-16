import { expect, mockAuthenticatedApp, test } from '../support/fixtures';

const cases = [
  { route: '/pam', resources: [] },
  { route: '/netskope/inventory', resources: ['/api/cmdb/netskope/devices', '/api/cmdb/netskope/devices/facets'] },
  { route: '/netskope/posture', resources: ['/api/cmdb/netskope/posture'] },
  { route: '/netskope', resources: ['/api/dashboard/netskope/preferences', '/api/dashboard/netskope/preferences/templates'] },
];

for (const { route: destination, resources } of cases) {
  test(`UX-AUD2-005: ${destination} loads preferences and each initial resource once`, async ({ page }) => {
    await mockAuthenticatedApp(page);
    const paths = ['/api/workspaces/preferences', ...resources];
    const counts = new Map(paths.map((path) => [path, 0]));
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (request.method() === 'GET' && counts.has(path)) counts.set(path, counts.get(path)! + 1);
    });
    const responses = paths.map((path) => page.waitForResponse((response) =>
      response.request().method() === 'GET' && new URL(response.url()).pathname === path && response.ok()));
    await page.goto(destination);
    await Promise.all(responses);
    await expect(page.locator('.state-block-loading')).toHaveCount(0);
    // Opening the loaded navigation also flushes initial shell effects; PUTs
    // that record recents are independent of these shared read requests.
    await page.getByRole('button', { name: /Cambiar workspace/ }).click();
    await expect(page.getByRole('region', { name: 'Workspaces' })).toBeVisible();
    expect(Object.fromEntries(counts)).toEqual(Object.fromEntries(paths.map((path) => [path, 1])));
  });
}
