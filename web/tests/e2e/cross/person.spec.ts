import AxeBuilder from '@axe-core/playwright';
import { expect, mockAuthenticatedApp, test, unauthenticated } from '../support/fixtures';

const describeViolations = (violations: Array<{ id: string; nodes: Array<{ target: unknown[]; failureSummary?: string }> }>) => violations.map((violation) => `${violation.id} :: ${violation.nodes[0]?.target?.join(' ')} :: ${violation.nodes[0]?.failureSummary?.replace(/\s+/g, ' ').slice(0, 260) ?? ''}`);

const selectPerson = async (page: import('@playwright/test').Page, query: string, name: RegExp) => {
  await page.getByRole('searchbox', { name: 'Buscar persona por correo o nombre' }).fill(query);
  await page.getByRole('option', { name }).click();
};

const expectPersonViewPrompt = async (page: import('@playwright/test').Page) => {
  await expect(page.getByRole('heading', { name: /Personas/, level: 1 })).toBeVisible();
};

test('UX-PERSON-002: Personas exposes only CyberArk and Netskope nodes, with CyberArk capabilities as non-navigable detail', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/chains/person');

  await expectPersonViewPrompt(page);
  await selectPerson(page, 'ada', /Ada Lovelace/);

  const hub = page.getByLabel('Persona Ada Lovelace');
  await expect(hub).toBeVisible();
  const tools = hub.getByRole('group', { name: 'Herramientas de la persona' });
  await expect(tools.getByRole('button')).toHaveCount(2);
  await expect(tools.getByRole('button', { name: /^Identity Administration:/ })).toHaveCount(0);
  await expect(tools.getByRole('button', { name: /^SIA:/ })).toHaveCount(0);
  await expect(hub.locator('.person-radial-node')).toHaveCount(2);
  await expect(hub.locator('.person-radial-node-pam')).toHaveAttribute('data-depth', '0');
  await expect(hub.locator('.person-radial-node-pam')).toHaveAttribute('data-parent', 'person');
  await expect(hub.locator('.person-radial-node-netskope')).toHaveAttribute('data-depth', '0');
  await expect(hub.locator('.person-radial-node-netskope')).toHaveAttribute('data-parent', 'person');
  await expect(hub.locator('.person-spoke')).toHaveCount(2);
  await expect(hub.locator('.person-spoke.is-depth-1')).toHaveCount(0);

  // The graph opens on the first linked tool: PAM, with its facts on the branch.
  // Each platform answers yes/no with one number; Identity and SIA are not nodes.
  const pam = tools.getByRole('button', { name: 'CyberArk: Con acceso privilegiado · 1 Safe' });
  await expect(pam).toHaveAttribute('aria-pressed', 'true');
  const pamFacts = hub.getByRole('list', { name: 'Detalle de CyberArk' });
  await expect(pamFacts.getByRole('listitem')).toHaveText(['Roles1', 'Safes1', 'Plataformas1', 'PSM1', 'Cuentas2']);
  const panel = hub.getByRole('complementary', { name: 'CyberArk de la persona' });
  await expect(panel.locator('.person-radial-provenance')).toContainText('Vinculado por correo');
  // Why it connects sits behind the "?".
  await panel.getByRole('button', { name: 'Ayuda: Cómo se conecta con CyberArk' }).click();
  await expect(panel.getByRole('note')).toContainText('Correo exacto 1 a 1 (misma dirección normalizada)');
  await page.keyboard.press('Escape');
  const capabilities = panel.getByRole('region', { name: 'Cómo obtiene el acceso' });
  await expect(capabilities).toContainText('Roles en Identity');
  await expect(capabilities).toContainText('2 roles');
  await expect(capabilities).toContainText('Políticas de SIA');
  await expect(capabilities).toContainText('1 política');
  await expect(capabilities.getByRole('button')).toHaveCount(0);

  await tools.getByRole('button', { name: /^Netskope:/ }).click();
  await expect(tools.getByRole('button', { name: /^Netskope:/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(hub.getByRole('list', { name: 'Detalle de Netskope' }).getByRole('listitem')).toHaveText(['Recientes · 7 días1', 'Sin actividad1', 'EmpresaAcme', 'Cliente110.0.1', 'SistemaWindows']);
  await expect(hub.getByRole('complementary', { name: 'Netskope de la persona' }).getByRole('button', { name: 'Abrir Netskope' })).toBeVisible();

  const accessibility = await new AxeBuilder({ page })
    .include('.chain-explorer')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(describeViolations(accessibility.violations), 'person view axe violations').toEqual([]);

  // Switching tools unmounts the other panel, so come back to CyberArk before
  // exercising its deep link (the committed UX-PERSON-001 flow did the same).
  await tools.getByRole('button', { name: /^CyberArk:/ }).click();
  await expect(tools.getByRole('button', { name: /^CyberArk:/ })).toHaveAttribute('aria-pressed', 'true');
  await panel.getByRole('button', { name: 'Abrir CyberArk' }).click();
  // The column map restores the link and rewrites it without the unused `dir`.
  await expect(page.getByRole('region', { name: 'Columna Identidad' })
    .getByRole('article', { name: /^Elegido en Identidad: Ada(?: Lovelace)?$/ })).toBeVisible();
  await expect(page).toHaveURL(/\/pam\/graph\?type=user&id=8$/);
});

test('UX-PERSON-002: the Netskope platform keeps its own deep link', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/chains/person');
  await selectPerson(page, 'ada', /Ada Lovelace/);

  const hub = page.getByLabel('Persona Ada Lovelace');
  await hub.getByRole('group', { name: 'Herramientas de la persona' }).getByRole('button', { name: /^Netskope:/ }).click();
  await hub.getByRole('complementary', { name: 'Netskope de la persona' }).getByRole('button', { name: 'Abrir Netskope' }).click();
  // The inventory may canonicalise the query order; both filters must survive.
  await expect(page).toHaveURL(/\/netskope\/inventory\?(?=.*observed_user_id=3)(?=.*freshness=all)/);
  await expect(page.getByRole('columnheader', { name: 'Dispositivo', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Quitar filtro Usuario exacto · ID 3' })).toBeVisible();
});

test('UX-PERSON-002: CyberArk secondary detail is conditional and never creates a link', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/chains/person');
  await selectPerson(page, 'riesgo', /Riesgo Parcial/);

  const hub = page.getByLabel('Persona Riesgo Parcial');
  const tools = hub.getByRole('group', { name: 'Herramientas de la persona' });
  await expect(tools.getByRole('button')).toHaveCount(2);
  await expect(hub.locator('.person-radial-node-identity')).toHaveCount(0);
  await expect(hub.locator('.person-radial-node-sia')).toHaveCount(0);
  await expect(hub.locator('.person-radial-node-netskope .person-radial-tool')).toHaveClass(/is-none/);
  await expect(hub.locator('.person-spoke')).toHaveCount(1);
  const panel = hub.getByRole('complementary', { name: 'CyberArk de la persona' });
  const capabilities = panel.getByRole('region', { name: 'Cómo obtiene el acceso' });
  await expect(capabilities).toContainText('Roles en Identity');
  await expect(capabilities).toContainText('Vínculo ambiguo');
  await expect(capabilities).not.toContainText('SIA');
  // A person absent from Netskope is a plain "no", not a missing node.
  await expect(tools.getByRole('button', { name: 'Netskope: Sin cliente registrado' })).toBeVisible();
  await expect(capabilities.getByRole('button')).toHaveCount(0);
});

test('UX-PERSON-002: a platform the actor cannot read is shown as unreadable, never as a no', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/chains/person');
  await selectPerson(page, 'solo', /Solo PAM/);

  const hub = page.getByLabel('Persona Solo PAM');
  await expect(hub.locator('.person-radial-node')).toHaveCount(2);
  await expect(hub.locator('.person-radial-node-identity')).toHaveCount(0);
  await expect(hub.locator('.person-radial-node-sia')).toHaveCount(0);
  const tools = hub.getByRole('group', { name: 'Herramientas de la persona' });
  await expect(tools.getByRole('button')).toHaveCount(1);
  await expect(tools.getByRole('img', { name: 'Netskope: Sin permiso de lectura' })).toBeVisible();
  await expect(hub).not.toContainText('Sin cliente registrado');
  await expect(hub.locator('.person-spoke')).toHaveCount(1);
  await expect(hub.getByRole('complementary', { name: 'CyberArk de la persona' }).getByRole('region', { name: 'Cómo obtiene el acceso' })).toContainText('Políticas de SIA');
});

test('CONN-SPACE-001: without a PAM user, access through an Identity role is shown as a name reference', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.route((url) => url.pathname === '/api/chains/person', (route) => route.fulfill({ json: {
    email: 'ada@acme.example', name: 'Ada Lovelace',
    tools: {
      pam: { status: 'unmatched', role_access: { basis: 'role_name_exact', matched_roles: 1, ambiguous_roles: 0, safes: 7 } },
      identity: { status: 'matched', basis: 'email_exact', user: { object_id: 4, display_name: 'Ada Lovelace', source_id: 'uuid-4' }, role_count: 1 },
      netskope: { status: 'unmatched' },
    },
  } }));
  await page.goto('/chains/person');
  await selectPerson(page, 'ada', /Ada Lovelace/);

  const hub = page.getByLabel('Persona Ada Lovelace');
  const tools = hub.getByRole('group', { name: 'Herramientas de la persona' });
  const cyberark = tools.getByRole('button', { name: 'CyberArk: Con acceso por rol · 7 Safes' });
  await expect(cyberark).toHaveAttribute('aria-pressed', 'true');
  // A name reference: dotted edge, never the solid email link.
  await expect(hub.locator('.person-spoke.is-reference')).toHaveCount(1);
  await expect(hub.locator('.person-spoke.is-linked')).toHaveCount(0);
  const panel = hub.getByRole('complementary', { name: 'CyberArk de la persona' });
  await expect(panel.locator('.person-radial-provenance')).toContainText('Acceso por rol · nombre exacto');
  await expect(panel.getByRole('list', { name: 'Detalle de CyberArk' }).getByRole('listitem')).toHaveText(['Roles vinculados1', 'Safes por rol7']);
  await expect(panel.getByRole('button', { name: 'Abrir CyberArk' })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Ayuda: Cómo se conecta con CyberArk' }).click();
  await expect(panel.getByRole('note')).toContainText('nombre exacto y único');
});

test('CONN-SPACE-001: SIA policies count as CyberArk access, broken down by user and by Identity role', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.route((url) => url.pathname === '/api/chains/person', (route) => route.fulfill({ json: {
    email: 'ada@acme.example', name: 'Ada Lovelace',
    tools: {
      pam: { status: 'unmatched' },
      identity: { status: 'matched', basis: 'email_exact', user: { object_id: 4, display_name: 'Ada Lovelace', source_id: 'uuid-4' }, role_count: 2 },
      sia: { status: 'reference', basis: 'display_name_reference_only', policy_count: 3,
        sia_access: { basis: 'grantee_name_exact', user_policies: 1, role_policies: 2, policies: 3, matched_roles: 1, ambiguous_roles: 0 } },
      netskope: { status: 'unmatched' },
    },
  } }));
  await page.goto('/chains/person');
  await selectPerson(page, 'ada', /Ada Lovelace/);

  const hub = page.getByLabel('Persona Ada Lovelace');
  const cyberark = hub.getByRole('group', { name: 'Herramientas de la persona' }).getByRole('button', { name: 'CyberArk: Acceso por SIA · 3 políticas SIA' });
  await expect(cyberark).toHaveAttribute('aria-pressed', 'true');
  await expect(hub.locator('.person-spoke.is-reference')).toHaveCount(1);
  const panel = hub.getByRole('complementary', { name: 'CyberArk de la persona' });
  await expect(panel.locator('.person-radial-provenance')).toContainText('Acceso por SIA · nombre exacto');
  const how = panel.getByRole('region', { name: 'Cómo obtiene el acceso' });
  await expect(how).toContainText('Políticas de SIA');
  await expect(how).toContainText('1 por usuario · 2 por rol de Identity');
  await expect(panel.getByRole('button', { name: 'Abrir CyberArk' })).toHaveCount(0);
});

test('UX-PERSON-002: reduced motion shows the final topology immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockAuthenticatedApp(page);
  await page.goto('/chains/person');
  await selectPerson(page, 'ada', /Ada Lovelace/);

  const hub = page.getByLabel('Persona Ada Lovelace');
  await expect(hub.locator('.person-radial-node-pam')).toBeVisible();
  await expect(hub.locator('.person-radial-node-pam')).toHaveCSS('animation-name', 'none');
  await expect(hub.locator('.person-radial-tool').first()).toHaveCSS('transition-duration', '0s');
  const running = await hub.locator('.person-radial').evaluate((element) => element.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running').length);
  expect(running, 'no animation keeps running under reduced motion').toBe(0);
});

test('UX-PERSON-002: the desktop person topology never overflows', async ({ page }) => {
  await mockAuthenticatedApp(page);
  for (const viewport of [
    { width: 1440, height: 900 }, { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/chains/person');
    await selectPerson(page, 'ada', /Ada Lovelace/);
    await expect(page.locator('.person-radial-node')).toHaveCount(2);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `person @${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(1);
  }
});

test('UX-PERSON-002: Home contains no Identity or SIA satellites, branches, or indented items', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/');

  await expect(page.locator('.home-domain-child, .home-visibility-satellite')).toHaveCount(0);
  await expect(page.locator('.home-visibility-line-identity, .home-visibility-line-sia')).toHaveCount(0);
  await expect(page.locator('.home-domain-entry-cyberark')).not.toContainText('Identity Administration');
  await expect(page.locator('.home-domain-entry-cyberark')).not.toContainText('SIA');

  // Focus and hover keep the left column and the graph in sync.
  const cyberark = page.locator('.home-domain-button-cyberark');
  await cyberark.focus();
  await expect(page.locator('.home-visibility')).toHaveAttribute('data-active-domain', 'cyberark');
  await expect(page.locator('.home-visibility-line-cyberark')).toHaveClass(/is-active/);
  await expect(page.locator('.home-visibility-line-netskope')).not.toHaveClass(/is-active/);

  const netskope = page.locator('.home-domain-button-netskope');
  await netskope.focus();
  await expect(page.locator('.home-visibility')).toHaveAttribute('data-active-domain', 'netskope');
  await expect(page.locator('.home-visibility-line-netskope')).toHaveClass(/is-active/);
  await expect(page.locator('.home-visibility-node-netskope')).toHaveClass(/is-active/);
  await expect(page.locator('.home-visibility-line-cyberark')).not.toHaveClass(/is-active/);

  await page.locator('.home-visibility-node-netskope').click();
  await expect(page).toHaveURL(/\/netskope$/);
});

test('CHAIN-010: Personas takes the centre of the home wheel and lights every tool', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/');
  const people = page.getByRole('button', { name: 'Abrir Conexiones' });
  await expect(people).toHaveText('Conexiones');
  await people.hover();
  await expect(page.locator('.home-visibility')).toHaveAttribute('data-active-domain', 'people');
  await expect(page.locator('.home-visibility-line-cyberark')).toHaveClass(/is-active/);
  await expect(page.locator('.home-visibility-line-netskope')).toHaveClass(/is-active/);
  await expect(page.locator('.home-visibility-line-bigid')).not.toHaveClass(/is-active/);
  await people.click();
  await expect(page).toHaveURL(/\/chains\/person$/);
  await expectPersonViewPrompt(page);
});

test('HOME-EDGE-001: the wheel draws no edge at rest and lights one only on hover or focus', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/');
  const edges = page.locator('.home-visibility-line');
  await expect(edges).toHaveCount(3);
  for (const edge of await edges.all()) await expect(edge).toHaveCSS('opacity', '0');
  await page.locator('.home-visibility-node-netskope').hover();
  await expect(page.locator('.home-visibility-line-netskope')).toHaveCSS('opacity', '1');
  await expect(page.locator('.home-visibility-line-cyberark')).toHaveCSS('opacity', '0');
  await page.mouse.move(5, 5);
  await expect(page.locator('.home-visibility-line-netskope')).toHaveCSS('opacity', '0');
  await page.locator('.home-visibility-core-people').hover();
  await expect(page.locator('.home-visibility-line-cyberark')).toHaveCSS('opacity', '1');
  await expect(page.locator('.home-visibility-line-netskope')).toHaveCSS('opacity', '1');
  await expect(page.locator('.home-visibility-line-bigid')).toHaveCSS('opacity', '0');
  // A tool that is coming soon draws no edge, even while it is hovered.
  await page.locator('.home-visibility-node-bigid').hover();
  await expect(page.locator('.home-visibility')).toHaveAttribute('data-active-domain', 'bigid');
  await expect(page.locator('.home-visibility-line-bigid')).toHaveCSS('opacity', '0');
  await page.locator('.home-domain-button-bigid').hover();
  await expect(page.locator('.home-visibility-line-bigid')).toHaveCSS('opacity', '0');
});

test('CHAIN-010: without a tool read permission the wheel centre stays Custodia', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['inventory:read'] });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Hola/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir Conexiones' })).toHaveCount(0);
  await expect(page.locator('.home-visibility-core')).toHaveText('Custodia');
   // UX-IA-001: no Personas button and no empty Conexiones section.
   await expect(page.getByRole('heading', { name: 'Cross' })).toHaveCount(0);
  await expect(page.locator('.home-domain-button-people')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Plataformas' })).toBeVisible();
});

test('HOME-GREETING-001: the authored greeting keeps accessible text and draws as a decorative mark', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: /Hola/ })).toBeVisible();
  await expect(page.locator('.home-greeting-wordmark')).toHaveText('Hola,');
  await expect(page.locator('.home-greeting-accent')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.home-greeting-text')).toHaveCSS('animation-name', 'home-greeting-reveal');
  await expect(page.locator('.home-greeting-wordmark')).toHaveCSS('border-bottom-style', 'solid');
  const wordmarkBox = await page.locator('.home-greeting-wordmark').boundingBox();
  expect(wordmarkBox).toBeTruthy();
  await expect.poll(async () => (await page.locator('.home-greeting-accent').boundingBox())?.width ?? 0).toBeGreaterThan(40);
  const underlineBox = await page.locator('.home-greeting-accent').boundingBox();
  expect(underlineBox!.y + underlineBox!.height).toBeLessThanOrEqual(wordmarkBox!.y + wordmarkBox!.height + 0.5);
});

test('HOME-BRAND-001: the Custodia mark is the favicon drawing on the header and login', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/');

  const mark = page.locator('.brand .custodia-mark');
  await expect(mark).toBeVisible();
  await expect(mark).toHaveAttribute('aria-hidden', 'true');
  await expect(mark.locator('.custodia-mark-record')).toHaveCount(2);
  await expect(mark.locator('.custodia-mark-shared')).toHaveCount(1);
  await expect(page.locator('.home-content > .home-mark')).toHaveCount(0);
  const favicon = await page.request.get('/mark.svg');
  expect(favicon.ok()).toBe(true);
  expect((await favicon.text()).match(/<rect/g)).toHaveLength(5);
  // The same mark heads the login.
  await page.route('**/api/auth/status', (route) => route.fulfill({ json: unauthenticated }));
  await page.reload();
  const loginMark = page.locator('.auth-logo .custodia-mark');
  await expect(loginMark).toBeVisible();
  await expect(loginMark.locator('.custodia-mark-record')).toHaveCount(2);
});

test('UX-IA-001: home lists Conexiones under Cross and platforms separately', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/');

  await expect(page.locator('.home-actions-section')).toHaveText(['Conexiones', 'Plataformas']);
  const groups = page.locator('.home-actions-group');
  await expect(groups.nth(0)).toHaveAttribute('data-section', 'transversal');
  await expect(groups.nth(1)).toHaveAttribute('data-section', 'platforms');

  const actions = page.locator('.home-actions .home-domain-button');
  await expect(actions).toHaveCount(4);
  await expect(actions.nth(0)).toContainText('Conexiones');
  await expect(actions.nth(0)).toContainText('Vista del alcance de cada persona en las herramientas');
  await expect(actions.nth(1)).toContainText('CyberArk');
  await expect(actions.nth(2)).toContainText('Netskope');
  await expect(actions.nth(3)).toContainText('BigID DSPM');
  // BigID stays disabled, announced as coming soon, with no clickable role.
  await expect(actions.nth(3)).toHaveAttribute('aria-disabled', 'true');
  await expect(actions.nth(3)).toContainText('Próximamente');
  await expect(page.getByRole('button', { name: /BigID DSPM/ })).toHaveCount(0);
  // The transversal entry wears the neutral Custodia mark, not a product logo.
  await expect(page.locator('.home-domain-button-people svg.custodia-mark')).toBeVisible();
});

test('UX-IA-001: the left Personas button drives the same wheel state as the core', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/');

  const personButton = page.locator('.home-domain-button-people');
  await personButton.focus();
  await expect(personButton).toBeFocused();
  await expect(page.locator('.home-visibility')).toHaveAttribute('data-active-domain', 'people');
  await expect(personButton).toHaveClass(/is-active/);
  await expect(page.locator('.home-visibility-core-people')).toHaveClass(/is-active/);
  await expect(page.locator('.home-visibility-line-cyberark')).toHaveClass(/is-active/);
  await expect(page.locator('.home-visibility-line-netskope')).toHaveClass(/is-active/);
  await expect(page.locator('.home-visibility-line-bigid')).not.toHaveClass(/is-active/);
  await expect(page.locator('.home-domain-button-cyberark')).toHaveClass(/is-active/);

  await personButton.blur();
  await expect(page.locator('.home-visibility')).not.toHaveAttribute('data-active-domain', 'people');
  await personButton.hover();
  await expect(page.locator('.home-visibility')).toHaveAttribute('data-active-domain', 'people');
});

test('UX-IA-001: click and keyboard open /chains/person from the left column', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/');

  const personButton = page.locator('.home-domain-button-people');
  await personButton.focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('.home-domain-button-cyberark')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(personButton).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/chains\/person$/);
  await expectPersonViewPrompt(page);

  await page.goto('/');
  await page.locator('.home-domain-button-people').click();
  await expect(page).toHaveURL(/\/chains\/person$/);
});

/* UX-IA-001 acceptance: any single alternate permission must be enough to
   see and open Personas, individually -- never requiring the others. */
for (const permission of ['pam:catalogs_read', 'identity:catalogs_read', 'netskope:read']) {
  test(`UX-IA-001: Personas is visible and opens with only ${permission}`, async ({ page }) => {
    await mockAuthenticatedApp(page, { permissions: [permission] });
    await page.goto('/');

    const personButton = page.locator('.home-domain-button-people');
    await expect(personButton).toBeVisible();
    await page.getByRole('button', { name: /Cambiar herramienta/ }).click();
    await expect(page.getByRole('region', { name: 'Herramientas' }).getByRole('button', { name: /^Conexiones / })).toBeVisible();
    await page.getByRole('button', { name: /Cambiar herramienta/ }).click();

    await personButton.click();
    await expect(page).toHaveURL(/\/chains\/person$/);
    await expectPersonViewPrompt(page);
    // The chrome presents the neutral Conexiones tool, not CyberArk.
    await expect(page.getByRole('button', { name: /Cambiar herramienta.*Conexiones/ })).toBeVisible();
    await expect(page.locator('.topbar-location')).toContainText('Conexiones');
  });
}

test('TOOL-LOGO-001: each context uses its own logo variant, per theme; Custodia views keep an icon', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['pam:catalogs_read', 'identity:catalogs_read', 'netskope:read'] });
  await page.goto('/');
  const trigger = page.getByRole('button', { name: /Cambiar herramienta/ });
  await trigger.click();
  const menu = page.getByRole('region', { name: 'Herramientas' });
  const loads = async (locator: import('@playwright/test').Locator) => expect.poll(() => locator.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  // Menu of tools, dark theme: CyberArk and Netskope in mint, BigID (no mint mark) in white.
  const expectedMenu: Record<string, [string, string]> = {
    'CyberArk': ['/cyberark-logo-mint.png', '/cyberark-logo-dark.png'],
    'Netskope': ['/netskope-full-mint.png', '/netskope-full-black.png'],
    'BigID DSPM': ['/bigid-full-white.png', '/bigid-full-black.png'],
  };
  for (const [label, [dark]] of Object.entries(expectedMenu)) {
    const logo = menu.getByRole('button', { name: new RegExp(`^${label} `) }).locator('.tool-logo img:visible');
    await expect(logo).toHaveCount(1);
    await expect(logo).toHaveAttribute('src', dark);
    await loads(logo);
  }
  const connections = menu.getByRole('button', { name: /^Conexiones / });
  await expect(connections.locator('.tool-logo')).toHaveCount(0);
  await expect(connections.locator('.tool-menu-icon svg')).toHaveCount(1);
  // Light theme: the dark variants.
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  for (const [label, [, light]] of Object.entries(expectedMenu)) {
    const logo = menu.getByRole('button', { name: new RegExp(`^${label} `) }).locator('.tool-logo img:visible');
    await expect(logo).toHaveAttribute('src', light);
  }
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));

  // Header button showing the active tool: white in dark theme (not the menu's mint), dark variant in light theme.
  const headerExpectations: Array<[RegExp, string, string, string]> = [
    [/^CyberArk /, 'CyberArk', '/cyberark-logo-white.png', '/cyberark-logo-dark.png'],
    [/^Netskope /, 'Netskope', '/netskope-full-white.png', '/netskope-full-black.png'],
  ];
  for (const [menuName, label, white, lightLogo] of headerExpectations) {
    await menu.getByRole('button', { name: menuName }).click();
    const header = page.getByRole('button', { name: new RegExp(`Cambiar herramienta. Actual: ${label}`) });
    await expect(header).toBeVisible();
    await expect(header.locator('.tool-logo img:visible')).toHaveAttribute('src', white);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await expect(header.locator('.tool-logo img:visible')).toHaveAttribute('src', lightLogo);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await header.click();
  }
});

test('UX-IA-001: opening Personas never reveals user administration or activity without permission', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['pam:catalogs_read'] });
  await page.goto('/');
  await page.locator('.home-domain-button-people').click();
  await expect(page).toHaveURL(/\/chains\/person$/);
  await expect(page.getByRole('button', { name: /Cambiar workspace.*Personas/ })).toBeVisible();

  await page.getByRole('button', { name: /Cambiar workspace/ }).click();
  const workspaces = page.getByRole('region', { name: 'Workspaces' });
  await expect(workspaces.getByRole('link', { name: /Personas/ })).toBeVisible();
  await expect(workspaces.getByRole('link', { name: /^Usuarios y permisos\b/ })).toHaveCount(0);
  await expect(workspaces.getByRole('link', { name: /^Actividad\b/ })).toHaveCount(0);
});

test('CONN-NAV-001: Ayuda belongs to Conexiones and Administración keeps restricted views', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/chains/person');
  await page.getByRole('button', { name: /Cambiar workspace/ }).click();
  const menu = page.getByRole('region', { name: 'Workspaces' });
  await expect(menu.locator('.workspace-menu-header')).toContainText('Vistas de Conexiones');
  const links = menu.locator('[data-section="tool-workspaces"] a.workspace-domain-link');
  await expect(links).toHaveCount(2);
  await expect(menu.getByRole('link', { name: /^Personas\b/ })).toBeVisible();
  await expect(menu.getByRole('link', { name: /^Cobertura de cliente\b/ })).toHaveCount(0);
  await expect(menu.getByRole('link', { name: /^Usuarios y permisos\b/ })).toHaveCount(0);
  await expect(menu.getByRole('link', { name: /^Actividad\b/ })).toHaveCount(0);
  await expect(menu.getByRole('link', { name: /^Ayuda\b/ })).toBeVisible();
  await page.keyboard.press('Escape');

  // Administración keeps the two restricted views in order.
  await page.getByRole('button', { name: /Cambiar herramienta/ }).click();
  await page.getByRole('region', { name: 'Herramientas' }).getByRole('button', { name: /^Administración / }).click();
  await expect(page).toHaveURL(/\/admin\/access$/);
  await page.getByRole('button', { name: /Cambiar workspace/ }).click();
  await expect(menu.locator('.workspace-menu-header')).toContainText('Vistas de Administración');
  const texts = (await menu.locator('[data-section="tool-workspaces"] a.workspace-domain-link').allTextContents())
    .map((text) => text.replace(/\s+/g, ' ').trim().match(/^(Usuarios y permisos|Actividad|Ayuda)/)?.[1]);
  expect(texts).toEqual(['Usuarios y permisos', 'Actividad']);
});

test('Administración and Ayuda are reachable from the profile menu, each under its own permission', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Abrir menú de usuario' }).click();
  const profile = page.getByRole('region', { name: 'Menú de usuario' });
  await expect(profile.getByText('Administración', { exact: true })).toBeVisible();
  await expect(profile.getByRole('button', { name: 'Usuarios y permisos' })).toBeVisible();
  await expect(profile.getByRole('button', { name: 'Actividad' })).toBeVisible();
  await profile.getByRole('button', { name: 'Actividad' }).click();
  await expect(page).toHaveURL(/\/admin\/activity$/);

  // A reader without administrative permissions keeps Ayuda and sees no Administración section.
  await mockAuthenticatedApp(page, { permissions: ['netskope:read'] });
  await page.goto('/');
  await page.getByRole('button', { name: 'Abrir menú de usuario' }).click();
  await expect(profile.getByText('Administración', { exact: true })).toHaveCount(0);
  await expect(profile.getByRole('button', { name: 'Usuarios y permisos' })).toHaveCount(0);
  await profile.getByRole('button', { name: 'Ayuda' }).click();
  await expect(page).toHaveURL(/\/help$/);
});

test('UX-IA-001: Administración lands on the first authorized workspace when Personas is unavailable', async ({ page }) => {
  await mockAuthenticatedApp(page, { permissions: ['access:directory_read'] });
  await page.goto('/');
  await expect(page.locator('.home-domain-button-people')).toHaveCount(0);

  await page.getByRole('button', { name: /Cambiar herramienta/ }).click();
  const dshubArea = page.getByRole('region', { name: 'Herramientas' }).getByRole('button', { name: /^Administración / });
  await expect(dshubArea).toBeVisible();
  await dshubArea.click();
  await expect(page).toHaveURL(/\/admin\/access$/);
  await expect(page.getByRole('button', { name: /Cambiar workspace.*Usuarios y permisos/ })).toBeVisible();

  // An activity-only actor lands on Actividad, never on an inaccessible workspace.
  await mockAuthenticatedApp(page, { permissions: ['audit:read'] });
  await page.reload();
  await page.getByRole('button', { name: /Cambiar herramienta/ }).click();
  await page.getByRole('region', { name: 'Herramientas' }).getByRole('button', { name: /^Administración / }).click();
  await expect(page).toHaveURL(/\/admin\/activity$/);
  await expect(page.getByRole('button', { name: /Cambiar workspace.*Actividad/ })).toBeVisible();
});

test('UX-PERSON-002: the simplified home has no axe violations', async ({ page }) => {
  await mockAuthenticatedApp(page);
  /* Axe blends partial opacity, so wait for the finite entry animations to
     finish before scanning; the final state is the one users see. */
  const settleAnimations = (locator: import('@playwright/test').Locator) => locator.evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
  });
  await page.goto('/');
  for (const scenario of [
    { viewport: { width: 1280, height: 720 }, theme: 'dark' },
    { viewport: { width: 1440, height: 900 }, theme: 'light' },
  ] as const) {
    await page.setViewportSize(scenario.viewport);
    await page.evaluate((theme) => window.localStorage.setItem('dshub-theme:v1', theme), scenario.theme);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', scenario.theme);
    await settleAnimations(page.locator('.home-workspace'));

    const results = await new AxeBuilder({ page })
      .include('.home-workspace')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(describeViolations(results.violations), `home axe ${scenario.theme} @${scenario.viewport.width}x${scenario.viewport.height}`).toEqual([]);
  }
});

test('UX-PERSON-002: the desktop home has no horizontal overflow or CyberArk subnodes', async ({ page }) => {
  await mockAuthenticatedApp(page);
  for (const viewport of [
    { width: 1440, height: 900 }, { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.locator('.home-domain-button-people')).toBeVisible();
    await expect(page.locator('.home-visibility-satellite, .home-domain-entry-cyberark .home-domain-child')).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `home @${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(1);
  }
});

test('HOME-WHEEL-002: the home wheel uses two concentric 2D circles', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/');

  // Both boundaries of the radial selector are purely visual.
  const ring = page.locator('.home-visibility-ring');
  const orbit = page.locator('.home-visibility-orbit');
  await expect(ring).toHaveCount(1);
  await expect(orbit).toHaveCount(1);
  await expect(ring).toHaveAttribute('aria-hidden', 'true');
  await expect(orbit).toHaveAttribute('aria-hidden', 'true');

  const ringBox = await ring.boundingBox();
  const orbitBox = await orbit.boundingBox();
  const center = await page.locator('.home-visibility-core').boundingBox();
  const cyberark = await page.locator('.home-visibility-node-cyberark').boundingBox();
  const netskope = await page.locator('.home-visibility-node-netskope').boundingBox();
  const bigid = await page.locator('.home-visibility-node-bigid').boundingBox();
  expect(ringBox && orbitBox && center && cyberark && netskope && bigid).toBeTruthy();
  const centerOf = (box: { x: number; y: number; width: number; height: number }) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  const hub = centerOf(center!);
  const cyberarkCenter = centerOf(cyberark!);
  const netskopeCenter = centerOf(netskope!);
  const bigidCenter = centerOf(bigid!);

  expect(Math.abs(ringBox!.width - ringBox!.height)).toBeLessThanOrEqual(2);
  expect(Math.abs(orbitBox!.width - orbitBox!.height)).toBeLessThanOrEqual(2);
  // The outer circle contains the tool crown and the inner one contains the
  // Personas control without becoming another interactive element.
  expect(ringBox!.x).toBeLessThan(netskope!.x);
  expect(ringBox!.x + ringBox!.width).toBeGreaterThan(cyberark!.x + cyberark!.width);
  expect(orbitBox!.x).toBeGreaterThan(ringBox!.x);
  expect(orbitBox!.x + orbitBox!.width).toBeLessThan(ringBox!.x + ringBox!.width);
  expect(orbitBox!.x).toBeLessThan(center!.x);
  expect(orbitBox!.x + orbitBox!.width).toBeGreaterThan(center!.x + center!.width);
  expect(Math.abs(cyberarkCenter.y - netskopeCenter.y)).toBeLessThanOrEqual(3);
  expect(Math.abs(cyberark!.width - netskope!.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(bigid!.width - cyberark!.width)).toBeLessThanOrEqual(2);

  // CyberArk upper-right, Netskope upper-left, BigID at the bottom.
  expect(cyberarkCenter.x).toBeGreaterThan(hub.x);
  expect(cyberarkCenter.y).toBeLessThan(hub.y);
  expect(netskopeCenter.x).toBeLessThan(hub.x);
  expect(netskopeCenter.y).toBeLessThan(hub.y);
  expect(Math.abs(bigidCenter.x - hub.x)).toBeLessThanOrEqual(3);
  expect(bigidCenter.y).toBeGreaterThan(hub.y);

  const cyberarkNode = page.locator('.home-visibility-node-cyberark');
  const netskopeNode = page.locator('.home-visibility-node-netskope');
  const bigidNode = page.locator('.home-visibility-node-bigid');
  const radialDistance = (point: { x: number; y: number }) => Math.hypot(point.x - hub.x, point.y - hub.y);
  expect(Math.abs(radialDistance(cyberarkCenter) - radialDistance(netskopeCenter))).toBeLessThanOrEqual(3);
  expect(Math.abs(radialDistance(bigidCenter) - radialDistance(cyberarkCenter))).toBeLessThanOrEqual(3);
  const crownMidpoint = (ringBox!.width / 2 + orbitBox!.width / 2) / 2;
  expect(Math.abs(radialDistance(cyberarkCenter) - crownMidpoint)).toBeLessThanOrEqual(3);
  expect(await cyberarkNode.evaluate((element) => getComputedStyle(element).animationName)).toBe('home-wheel-node-arrive');

  // DOM/focus order remains catalog order, independent from radial position.
  await expect(page.locator('button.home-visibility-node')).toHaveCount(2);
  expect(await page.locator('button.home-visibility-node').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')))).toEqual(['Abrir CyberArk', 'Abrir Netskope']);
  await cyberarkNode.focus();
  await page.keyboard.press('Tab');
  await expect(netskopeNode).toBeFocused();

  // BigID stays a non-interactive, aria-hidden decoration, never a button or link.
  await expect(bigidNode).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('a.home-visibility-node-bigid, button.home-visibility-node-bigid')).toHaveCount(0);
});

test('HOME-WHEEL-002: orbital labels animate without covering Personas', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');

  const labels = page.locator('.home-visibility-label');
  const people = page.locator('.home-visibility-core-people');
  const cyberarkNode = page.locator('.home-visibility-node-cyberark');
  const cyberarkLabel = page.locator('.home-visibility-label-cyberark');
  const bigidLabel = page.locator('.home-visibility-label-bigid');
  const boxesOverlap = (left: { x: number; y: number; width: number; height: number }, right: { x: number; y: number; width: number; height: number }) => (
    left.x < right.x + right.width && left.x + left.width > right.x
    && left.y < right.y + right.height && left.y + left.height > right.y
  );

  await expect(labels).toHaveCount(4);
  await expect(page.locator('.home-visibility-label-people')).toBeHidden();
  await expect(cyberarkLabel).toBeHidden();
  await expect(bigidLabel).toBeHidden();

  await cyberarkNode.focus();
  await expect(cyberarkLabel).toBeVisible();
  await expect(cyberarkLabel).toContainText('CyberArk');
  await expect(cyberarkLabel).toContainText('Gestión de accesos privilegiados');
  await expect(cyberarkLabel).toContainText('Abrir');
  const peopleBox = await people.boundingBox();
  const cyberarkLabelBox = await cyberarkLabel.boundingBox();
  expect(peopleBox && cyberarkLabelBox).toBeTruthy();
  expect(boxesOverlap(peopleBox!, cyberarkLabelBox!)).toBe(false);

  // Conexiones lights the platform graph and opens only its own label, like every other node.
  await people.hover();
  const peopleLabel = page.locator('.home-visibility-label-people');
  await expect(peopleLabel).toBeVisible();
  await expect(peopleLabel).toContainText('Conexiones');
  await expect(peopleLabel).toContainText('Vista del alcance de cada persona en las herramientas');
  await expect(peopleLabel).toContainText('Abrir');
  await expect(page.locator('.home-visibility-label-cyberark')).toBeHidden();
  await expect(page.locator('.home-visibility-label-netskope')).toBeHidden();
  await expect(bigidLabel).toBeHidden();
  for (const platform of ['cyberark', 'netskope']) {
    const node = await page.locator(`.home-visibility-node-${platform}`).boundingBox();
    const label = await peopleLabel.boundingBox();
    expect(node && label).toBeTruthy();
    expect(boxesOverlap(node!, label!)).toBe(false);
  }

  // Planned BigID remains non-interactive; its left entry only previews the
  // tangential status label and never covers the centre control.
  await page.locator('.home-domain-button-bigid').hover();
  await expect(bigidLabel).toBeVisible();
  await expect(bigidLabel).toContainText('BigID DSPM');
  await expect(bigidLabel).toContainText('Próximamente');
  const bigidLabelBox = await bigidLabel.boundingBox();
  expect(bigidLabelBox).toBeTruthy();
  expect(boxesOverlap(peopleBox!, bigidLabelBox!)).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await expect(page.locator('a.home-visibility-node-bigid, button.home-visibility-node-bigid')).toHaveCount(0);
});

test('HOME-WHEEL-002: reduced motion keeps the home wheel static', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockAuthenticatedApp(page);
  await page.goto('/');

  const running = await page.locator('.home-visibility').evaluate((element) => element.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running').length);
  expect(running, 'no animation keeps running on the home wheel under reduced motion').toBe(0);
  await expect(page.locator('.home-visibility-node-cyberark')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.home-visibility-ring')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.home-greeting-text')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.home-greeting-accent')).toHaveCSS('animation-name', 'none');
  expect(await page.locator('.brand .custodia-mark').evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
});

for (const theme of ['dark', 'light'] as const) {
  test(`CONN-NAV-001 desktop navigation, search and deep links work in ${theme}`, async ({ page }) => {
    await page.addInitScript((value) => window.localStorage.setItem('dshub-theme:v1', value), theme);
    await mockAuthenticatedApp(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/chains/person');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectPersonViewPrompt(page);
    await expect(page.locator('.topbar-location')).toContainText('Conexiones');

    // Keyboard entry to the neutral tool area.
    const toolTrigger = page.getByRole('button', { name: /Cambiar herramienta/ });
    await toolTrigger.focus();
    await page.keyboard.press('Enter');
    const toolMenu = page.getByRole('region', { name: 'Herramientas' });
    await expect(toolMenu.getByRole('button', { name: /^Conexiones / })).toBeVisible();
    await expect(toolMenu.getByRole('button', { name: /^Administración / })).toBeVisible();
    await expect(toolMenu.getByRole('button', { name: /Riesgos/ })).toHaveCount(0);
    const toolMenuAxe = await new AxeBuilder({ page }).include('.tool-menu').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(describeViolations(toolMenuAxe.violations), `tool menu axe ${theme}`).toEqual([]);
    await page.keyboard.press('Escape');

    const workspaceTrigger = page.getByRole('button', { name: /Cambiar workspace/ });
    await workspaceTrigger.focus();
    await page.keyboard.press('Enter');
    const workspaceMenu = page.getByRole('region', { name: 'Workspaces' });
    await expect(workspaceMenu.getByRole('link', { name: /^Personas\b/ })).toBeVisible();
    await expect(workspaceMenu.getByRole('link', { name: /^Cobertura de cliente\b/ })).toHaveCount(0);
    await expect(workspaceMenu.getByRole('link', { name: /^Usuarios y permisos\b/ })).toHaveCount(0);
    const workspaceMenuAxe = await new AxeBuilder({ page }).include('.workspace-menu').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(describeViolations(workspaceMenuAxe.violations), `workspace menu axe ${theme}`).toEqual([]);
    await page.keyboard.press('Escape');

    const searchTrigger = page.getByRole('button', { name: 'Abrir command center' });
    await searchTrigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Command center' });
    const search = dialog.getByRole('combobox');
    await search.fill('Conexiones');
    const personOption = dialog.locator('#global-search-result-0');
    await expect(personOption).toBeVisible();
    await expect(personOption).toHaveAttribute('aria-selected', 'true');
    await expect(personOption).toContainText('Personas');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/chains\/person$/);
    await expectPersonViewPrompt(page);

    await searchTrigger.focus();
    await page.keyboard.press('Enter');
    const reopenedDialog = page.getByRole('dialog', { name: 'Command center' });
    const reopenedSearch = reopenedDialog.getByRole('combobox');
    await reopenedSearch.fill('Inventario de infraestructura');
    const infrastructureOption = reopenedDialog.getByRole('option', { name: /^Cobertura\b.*¿Dónde aparecen las conexiones migradas\?/ }).first();
    await expect(infrastructureOption).toBeVisible();
    await expect(infrastructureOption).toHaveAttribute('aria-selected', 'true');
    await expect(infrastructureOption).toContainText('Cobertura');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/pam\/assets$/);
    await expect(page.getByRole('heading', { name: 'Cobertura', exact: true, level: 1 })).toBeVisible();

    // The old IP-inventory deep link remains an alias and resolves to the same view.
    await page.goto('/pam/ip-inventory');
    await expect(page.getByRole('heading', { name: 'Cobertura', exact: true, level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/pam\/assets$/);
  });
}
