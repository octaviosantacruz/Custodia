import AxeBuilder from '@axe-core/playwright';
import { expect, mockAuthenticatedApp, test } from '../support/fixtures';

const describeViolations = (violations: Array<{ id: string; nodes: Array<{ target: unknown[]; failureSummary?: string }> }>) => violations.map((violation) => `${violation.id} :: ${violation.nodes[0]?.target?.join(' ')} :: ${violation.nodes[0]?.failureSummary?.replace(/\s+/g, ' ').slice(0, 260) ?? ''}`);

/* FE-MOTION-001 (phase 1): overlay presence, workspace arrival, filter-counter
   feedback and the reduced-motion policy of the migrated surfaces. */

test('FE-MOTION-001: the widget picker exits with presence, restores focus immediately and never leaks interaction', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto('/pam');
  await page.locator('.dashboard-create-card').click();
  const trigger = page.getByRole('button', { name: 'Agregar dato' });
  await trigger.click();
  const backdrop = page.locator('.dashboard-widget-picker-backdrop');
  const dialog = page.locator('.dashboard-widget-picker');
  await expect(dialog).toBeVisible();

  // Focus starts inside and Tab/Shift+Tab cycle without leaking.
  const focusInside = () => page.evaluate(() => Boolean(document.activeElement?.closest('.dashboard-widget-picker')));
  expect(await focusInside()).toBe(true);
  for (let step = 0; step < 8; step += 1) await page.keyboard.press('Tab');
  expect(await focusInside()).toBe(true);
  await page.keyboard.press('Shift+Tab');
  expect(await focusInside()).toBe(true);

  // The overlay keeps covering the viewport while open.
  const box = await backdrop.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(Math.round(box?.width ?? 0)).toBe(viewport?.width ?? 0);
  expect(Math.round(box?.height ?? 0)).toBe(viewport?.height ?? 0);

  const accessibility = await new AxeBuilder({ page })
    .include('.dashboard-widget-picker-backdrop')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(describeViolations(accessibility.violations), 'widget picker axe violations').toEqual([]);

  // Record the exit phase: it must exist, be non-interactive and have already
  // returned focus to the trigger while the dialog is still mounted.
  await page.evaluate(() => {
    (window as unknown as { __motionExit: unknown }).__motionExit = null;
    const observer = new MutationObserver(() => {
      const element = document.querySelector('.dashboard-widget-picker-backdrop');
      if (!element?.classList.contains('is-leaving')) return;
      const style = getComputedStyle(element);
      (window as unknown as { __motionExit: unknown }).__motionExit = {
        pointerEvents: style.pointerEvents,
        inert: element.hasAttribute('inert'),
        ariaHidden: element.getAttribute('aria-hidden'),
        focusedTrigger: document.activeElement?.classList.contains('dashboard-add-toggle') ?? false,
      };
    });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'aria-hidden', 'inert'] });
  });
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(page.locator('.dashboard-widget-picker')).toHaveCount(0);
  const exit = await page.evaluate(() => (window as unknown as { __motionExit: { pointerEvents: string; inert: boolean; ariaHidden: string | null; focusedTrigger: boolean } | null }).__motionExit);
  expect(exit, 'the exit phase must be observable').not.toBeNull();
  expect(exit?.pointerEvents).toBe('none');
  expect(exit?.inert).toBe(true);
  expect(exit?.ariaHidden).toBe('true');
  expect(exit?.focusedTrigger, 'focus returns to the trigger without waiting for the exit window').toBe(true);
});

test('FE-MOTION-001: the workspace arrival plays only on real navigation and never delays the data request', async ({ page }) => {
  await mockAuthenticatedApp(page, { includeSafe: true });
  await page.goto('/pam');
  await expect(page.getByRole('region', { name: 'Mi panel de métricas' })).toBeVisible();
  /* Deterministic timing: a paused clock stops the 190ms arrival timer, so
     advancing 60ms of that window proves the data request is issued inside it
     (a regression that waited for the animation would not fetch until
     runFor(190+)). */
  await page.clock.install();
  await page.clock.pauseAt(Date.now());

  await page.evaluate(() => {
    const state: { arrivals: number; transform: string | null; clickAt: number | null; safesAt: number | null } = { arrivals: 0, transform: null, clickAt: null, safesAt: null };
    (window as unknown as { __motionNav: typeof state }).__motionNav = state;
    const content = document.querySelector('.workspace-content');
    if (content) {
      new MutationObserver(() => {
        if (!content.classList.contains('is-arriving-a') && !content.classList.contains('is-arriving-b')) return;
        state.arrivals += 1;
        state.transform = getComputedStyle(content).transform;
      }).observe(content, { attributes: true, attributeFilter: ['class'] });
    }
    document.addEventListener('click', () => { state.clickAt = Date.now(); }, { capture: true });
    const original = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (state.safesAt === null && url.includes('/api/safes')) state.safesAt = Date.now();
      return original(input, init);
    };
  });

  await page.getByRole('navigation', { name: 'Secciones de CyberArk', exact: true }).getByRole('link', { name: 'Safes', exact: true }).click();
  await page.clock.runFor(60);
  await expect(page.getByRole('heading', { name: 'Safes', exact: true })).toBeVisible();
  await expect(page.locator('.workspace-content')).toHaveClass(/is-arriving/);

  type MotionNavState = { arrivals: number; transform: string | null; clickAt: number | null; safesAt: number | null };
  const snapshot = () => page.evaluate(() => (window as unknown as { __motionNav: MotionNavState }).__motionNav);
  const early = await snapshot();
  expect(early.arrivals).toBeGreaterThan(0);
  expect(early.transform, 'the arrival layer must not use transform (fixed overlays keep the viewport)').toBe('none');
  expect(early.clickAt).not.toBeNull();
  expect(early.safesAt, 'the Safes request starts inside the arrival window, without waiting for it').not.toBeNull();
  expect((early.safesAt ?? 0) - (early.clickAt ?? 0)).toBeLessThanOrEqual(60);

  // The window closes on its own timer and then stays closed.
  await page.clock.runFor(300);
  await expect(page.locator('.workspace-content')).not.toHaveClass(/is-arriving/);

  // An internal refresh inside the same workspace never replays the arrival.
  const arrivalsBeforeSearch = early.arrivals;
  await page.getByRole('searchbox', { name: 'Buscar Safes por nombre o Safe URL ID' }).fill('olac');
  await page.clock.runFor(400);
  expect((await snapshot()).arrivals).toBe(arrivalsBeforeSearch);
});

test('FE-MOTION-001: reduced motion resolves arrivals, the picker exit, counters and the chart entry instantly', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockAuthenticatedApp(page, {
    dashboardWidgets: [
      {
        widget_id: 'motion-trend', title: 'Tendencia de movimiento', kind: 'chart', measure: 'safes',
        chart: { style: 'line', group_by: 'inventory_trend' },
        filters: { workflow_status: '', classification_status: '', inventory_scope: '', data_quality_status: '', health_filter: '' },
        target_value: null, target_direction: null, period_label: null, baseline_value: null,
        position: 0, size: 'sm', value: 0,
        chart_data: { labels: ['2026-09-20', '2026-09-21'], series: [{ key: 'safes', label: 'Safes', values: [1, 2] }] },
      },
    ],
  });
  await page.goto('/pam');
  await expect(page.getByRole('region', { name: 'Mi panel de métricas' })).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--motion-panel').trim())).toMatch(/^0(m?s)$/);

  // ECharts entry resolves to zero duration under reduced motion.
  const chart = page.locator('.advanced-chart');
  await expect(chart).toHaveAttribute('data-chart-animation', 'instant');
  await expect(chart.locator('canvas')).toBeVisible();

  // Workspace arrival keeps its class but the animation is disabled.
  await page.evaluate(() => {
    (window as unknown as { __motionReduce: string | null }).__motionReduce = null;
    const content = document.querySelector('.workspace-content');
    if (content) {
      new MutationObserver(() => {
        if (content.classList.contains('is-arriving-a') || content.classList.contains('is-arriving-b')) {
          (window as unknown as { __motionReduce: string | null }).__motionReduce = getComputedStyle(content).animationName;
        }
      }).observe(content, { attributes: true, attributeFilter: ['class'] });
    }
  });
  await page.getByRole('navigation', { name: 'Secciones de CyberArk', exact: true }).getByRole('link', { name: 'Safes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Safes', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __motionReduce: string | null }).__motionReduce)).toBe('none');

  // Counter feedback is instant too, and the text stays accessible.
  const summary = page.locator('.filter-summary');
  await expect(summary).toHaveText('(0)');
  await page.locator('.safe-filter-details > summary').click();
  await page.getByRole('button', { name: 'Filtrar por clasificación' }).click();
  await page.getByRole('option', { name: /^Pendiente/ }).click();
  await expect(summary).toHaveText('(1)');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.filter-summary') as Element).animationName)).toBe('none');

  // Picker: Escape unmounts without a perceptible wait and focus is back.
  await page.goto('/pam');
  await page.locator('.dashboard-create-card').click();
  const trigger = page.getByRole('button', { name: 'Agregar dato' });
  await trigger.click();
  await expect(page.locator('.dashboard-widget-picker')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.dashboard-widget-picker')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('FE-MOTION-001: changing a Safes filter pulses the counter and leaves the rows untouched', async ({ page }) => {
  await mockAuthenticatedApp(page, { includeSafe: true });
  await page.goto('/pam/safes');
  await expect(page.getByRole('heading', { name: 'Safes', exact: true })).toBeVisible();

  const summary = page.locator('.filter-summary');
  await expect(summary).toHaveText('(0)');
  const counterAnimation = () => page.evaluate(() => getComputedStyle(document.querySelector('.filter-summary') as Element).animationName);
  const rowsAnimationFree = () => page.evaluate(() => Array.from(document.querySelectorAll('.safe-table tbody tr')).every((row) => getComputedStyle(row).animationName === 'none'));
  expect(await counterAnimation()).toBe('motion-filter-pulse');
  expect(await rowsAnimationFree()).toBe(true);

  // The derived count is the key: marking the current node proves the next
  // count remounts it (restarting the pulse) instead of keeping hidden state.
  await page.evaluate(() => { (document.querySelector('.filter-summary') as HTMLElement).dataset.probe = 'before'; });
  await page.locator('.safe-filter-details > summary').click();
  await page.getByRole('button', { name: 'Filtrar por clasificación' }).click();
  await page.getByRole('option', { name: /^Pendiente/ }).click();

  await expect(summary).toHaveText('(1)');
  expect(await page.evaluate(() => (document.querySelector('.filter-summary') as HTMLElement | null)?.dataset.probe ?? null), 'the counter span is keyed by the count and remounts to restart the pulse').toBeNull();
  expect(await counterAnimation()).toBe('motion-filter-pulse');
  expect(await rowsAnimationFree(), 'the feedback never animates rows').toBe(true);
});
