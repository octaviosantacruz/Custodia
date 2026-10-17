import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  mockAuthenticatedApp,
  PERSON_CLIENT_COVERAGE_DETAILS,
  PERSON_SEARCH_RESULTS,
  PERSON_SUMMARIES,
  test,
} from '../support/fixtures';

const longEmail = 'octavio.javier.santacruz.irigoytia.contacto@itti.digital';
const longName = 'Octavio Javier Santacruz Irigoytia';
const originalPersonEmail = 'ada@itti.digital';

async function installLongPersonRoutes(page: import('@playwright/test').Page) {
  await page.route('**/api/chains/person/search**', (route) => {
    const people = PERSON_SEARCH_RESULTS.map((person) => person.email === originalPersonEmail
      ? { ...person, email: longEmail, name: longName }
      : person);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ query: 'octavio', people }) });
  });
  await page.route((url) => url.pathname === '/api/chains/person', (route) => {
    const person = PERSON_SUMMARIES[originalPersonEmail] as {
      email: string;
      name: string;
      tools: Record<string, Record<string, unknown>>;
    };
    const pam = person.tools.pam;
    const totals = pam.totals as Record<string, number>;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...person,
        email: longEmail,
        name: longName,
        tools: {
          ...person.tools,
          pam: {
            ...pam,
            totals: { ...totals, roles: 31, safes: 408, accounts: 423, platforms: 33, psms: 3 },
          },
          netskope: {
            ...person.tools.netskope,
            company: 'ITTI Regional Security Operations and Endpoint Management Team',
            client_versions: ['Netskope Client 120.4.0.123456 enterprise release'],
            operating_systems: ['Microsoft Windows 11 Enterprise 24H2 workstation image build 26100'],
          },
        },
      }),
    });
  });
  await page.route((url) => url.pathname === '/api/chains/person/coverage/detail', (route) => {
    const detail = PERSON_CLIENT_COVERAGE_DETAILS[originalPersonEmail] as Record<string, unknown>;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...detail, email: longEmail }),
    });
  });
}

function overlaps(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean {
  return left.x < right.x + right.width && left.x + left.width > right.x
    && left.y < right.y + right.height && left.y + left.height > right.y;
}

async function assertRadialGeometry(radial: import('@playwright/test').Locator) {
  const radialBox = await radial.boundingBox();
  expect(radialBox).toBeTruthy();
  const elements = await radial.locator('.person-radial-center, .person-radial-tool, .person-radial-tool-text').evaluateAll((nodes) => nodes.map((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }));

  for (let index = 0; index < elements.length; index += 1) {
    const box = elements[index];
    expect(box.x).toBeGreaterThanOrEqual(radialBox!.x - 1);
    expect(box.y).toBeGreaterThanOrEqual(radialBox!.y - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(radialBox!.x + radialBox!.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(radialBox!.y + radialBox!.height + 1);
    for (let next = index + 1; next < elements.length; next += 1) {
      expect(overlaps(box, elements[next]), `radial elements ${index}/${next} do not overlap`).toBe(false);
    }
  }
}

const DESKTOP_SCENARIOS = [
  { width: 1280, height: 720, theme: 'dark' },
  { width: 1280, height: 720, theme: 'light' },
  { width: 1440, height: 900, theme: 'dark' },
  { width: 1440, height: 900, theme: 'light' },
] as const;

for (const scenario of DESKTOP_SCENARIOS) {
  test(`CONN-UX-001 desktop geometry/search @${scenario.width}x${scenario.height} ${scenario.theme}`, async ({ page }) => {
    await mockAuthenticatedApp(page);
    await installLongPersonRoutes(page);
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.goto('/chains/person');
    await page.evaluate((theme) => window.localStorage.setItem('custodia-theme:v1', theme), scenario.theme);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', scenario.theme);
    // The population summary has its own view; the person view carries none of it.
    await expect(page.locator('.person-client-coverage')).toHaveCount(0);

    const search = page.getByRole('searchbox', { name: 'Buscar persona por correo o nombre' });
    await search.fill('octavio');
    const option = page.getByRole('option', { name: new RegExp(longName) });
    await expect(option).toBeVisible();
    const chips = option.locator('.person-source-chip');
    await expect(chips).toHaveText(['CyberArk', 'Netskope']);
    const chipStyles = await chips.evaluateAll((elements) => elements.map((element) => ({
      borderStyle: getComputedStyle(element).borderStyle,
      opacity: getComputedStyle(element).opacity,
    })));
    expect(chipStyles.every((style) => style.borderStyle === 'solid' && Number(style.opacity) >= 0.9)).toBe(true);

    const searchResultsAxe = await new AxeBuilder({ page })
      .include('.intro')
      .include('.person-explorer')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(searchResultsAxe.violations.map((violation) => violation.id), `Personas search axe ${scenario.theme}`).toEqual([]);

    await page.keyboard.press('Tab');
    await expect(option).toBeFocused();
    await page.keyboard.press('Enter');

    const hub = page.getByLabel(`Persona ${longName}`);
    await expect(hub).toBeVisible();

    const radial = hub.locator('.person-radial');
    const centerName = radial.locator('.person-radial-center strong');
    const centerEmail = radial.locator('.person-radial-center .mono');
    await expect(centerName).toHaveText(longName);
    await expect(centerEmail).toHaveText(longEmail);
    const textFits = await radial.locator('.person-radial-center strong, .person-radial-center .mono, .person-radial-tool-text strong, .person-radial-tool-text small')
      .evaluateAll((elements) => elements.every((element) => element.scrollWidth <= element.clientWidth + 1));
    expect(textFits, `radial labels fit @${scenario.width}x${scenario.height} ${scenario.theme}`).toBe(true);
    await expect(radial.getByRole('button', { name: 'CyberArk: Con acceso privilegiado · 408 Safes' })).toBeVisible();
    await expect(radial.getByRole('button', { name: /^Netskope:/ })).toBeVisible();
    // The platform detail lives in the side panel, not under the stage.
    await expect(radial.getByRole('list')).toHaveCount(0);
    await expect(hub.getByRole('list', { name: 'Detalle de CyberArk' }).getByRole('listitem')).toHaveText([
      'Roles31', 'Safes408', 'Plataformas33', 'PSM3', 'Cuentas423',
    ]);
    await assertRadialGeometry(radial);

    const netskope = radial.getByRole('button', { name: /^Netskope:/ });
    await netskope.focus();
    await expect(netskope).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(netskope).toHaveAttribute('aria-pressed', 'true');
    await expect(hub.getByRole('list', { name: 'Detalle de Netskope' }).getByRole('listitem')).toHaveCount(5);
    await assertRadialGeometry(radial);
  });
}

test('CONN-UX-001 keyboard disclosures and full-person view accessibility', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await installLongPersonRoutes(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/chains/person');
  await page.getByRole('searchbox', { name: 'Buscar persona por correo o nombre' }).fill('octavio');
  const option = page.getByRole('option', { name: new RegExp(longName) });
  await expect(option).toBeVisible();
  await option.focus();
  await page.keyboard.press('Enter');

  const netskope = page.getByRole('group', { name: 'Herramientas de la persona' }).getByRole('button', { name: /^Netskope:/ });
  await netskope.focus();
  await page.keyboard.press('Space');
  await expect(netskope).toHaveAttribute('aria-pressed', 'true');

  const evidence = page.locator('.person-connection-disclosure');
  await evidence.locator(':scope > summary').focus();
  await page.keyboard.press('Enter');
  await expect(evidence).toHaveAttribute('open', '');
  const detailDisclosure = evidence.locator('.person-client-coverage-detail > details > summary');
  await detailDisclosure.focus();
  await page.keyboard.press('Space');
  await expect(evidence.locator('.person-client-coverage-detail > details')).toHaveAttribute('open', '');
  const detailRunToggle = evidence.locator('.person-client-coverage-detail > details details > summary');
  await page.keyboard.press('Tab');
  await expect(detailRunToggle).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(evidence.locator('.person-client-coverage-detail > details details')).toHaveAttribute('open', '');

  const axe = await new AxeBuilder({ page })
    .include('.intro')
    .include('.person-explorer')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axe.violations.map((violation) => violation.id), 'Personas full-view Axe').toEqual([]);
});
