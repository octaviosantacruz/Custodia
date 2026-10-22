import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const open = async (page: Page, lang: 'es' | 'en' = 'es') => {
  await page.addInitScript(l => localStorage.setItem('custodia-demo-lang', l), lang);
  await page.goto('/');
};
const tab = (page: Page, name: string) => page.getByRole('navigation', { name: /^(Vistas|Views)$/ }).getByRole('button', { name, exact: true });
const next = (page: Page) => page.getByRole('button', { name: /^(Siguiente|Next)$/ }).click();

test('recorre el guion completo y cada paso deja lo esperado', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('note')).toContainText('Demo con datos de ejemplo');

  // 1. Conexiones
  const connections = page.getByRole('table');
  await expect(connections.getByRole('row', { name: /Laboratorio Norte/ })).toContainText('lab.inventory');
  await expect(connections.getByRole('row', { name: /Laboratorio Sur/ })).toContainText('simulado');

  // 2. r-17 de Norte, sin responsable
  await next(page);
  await expect(page.getByRole('heading', { name: /Laboratorio Norte · r-17/ })).toBeVisible();
  await expect(page.getByRole('complementary')).toContainText('Sin asignar');
  await expect(page.getByRole('complementary')).toContainText('norte-1');

  // 3. Responsable y nota
  await next(page);
  const detail = page.getByRole('complementary', { name: 'Detalle del registro' });
  await expect(detail).toContainText('Ana Ejemplo');
  await expect(detail).toContainText('operador.demo');

  // 4. Sincronización completa: un cambio y un alta, decisión conservada
  await next(page);
  await expect(page.getByRole('row', { name: /Cambio.*r-17.*environment: test → staging/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Alta.*r-19/ })).toBeVisible();
  await tab(page, 'Inventario').click();
  await expect(page.getByRole('row', { name: /Laboratorio Norte r-17.*Ana Ejemplo/ })).toBeVisible();

  // 5. Parcial: nada se retira y se explica por qué
  await next(page);
  await expect(page.getByText(/Corrida parcial: no puede retirar nada/)).toContainText('norte-2');
  await expect(page.getByRole('row', { name: /Baja/ })).toHaveCount(0);

  // 6. Completa sin r-18: baja enlazada a la corrida
  await next(page);
  await expect(page.getByRole('row', { name: /Baja.*r-18/ })).toContainText('norte-4');
  await tab(page, 'Inventario').click();
  await expect(page.getByRole('row', { name: /Laboratorio Norte r-18.*Retirado/ })).toBeVisible();

  // 7. Reinicio: exactamente el estado inicial
  await next(page);
  await tab(page, 'Inventario').click();
  await expect(page.getByRole('row', { name: /Laboratorio Norte r-18.*Vigente/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /r-19/ })).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Laboratorio Norte r-17.*Sin asignar/ })).toBeVisible();
});

test('Sur no cambia en ningún paso del guion', async ({ page }) => {
  await open(page);
  for (let i = 1; i <= 7; i++) {
    await tab(page, 'Inventario').click();
    await page.locator('#connection-filter').selectOption('sur');
    const rows = page.getByRole('row').filter({ hasText: 'Laboratorio Sur' });
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText('gw-sur-17');
    await expect(rows).toContainText('Vigente');
    if (i < 7) await next(page);
  }
});

test('Reiniciar y Anterior vuelven al estado correspondiente', async ({ page }) => {
  await open(page);
  await next(page);
  await next(page);
  await next(page);
  await next(page);
  await page.getByRole('button', { name: 'Anterior', exact: true }).click();
  await expect(page.getByText('Paso 4 de 7')).toBeVisible();
  await page.getByRole('button', { name: 'Reiniciar ejemplo', exact: true }).click();
  await expect(page.getByText('Paso 1 de 7')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Anterior', exact: true })).toBeDisabled();
});

test('se usa con teclado: abrir un registro, Escape y retorno del foco', async ({ page }) => {
  await open(page);
  await tab(page, 'Inventario').click();
  const row = page.getByRole('button', { name: /Abrir detalle: Laboratorio Norte r-17/ });
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: /Laboratorio Norte · r-17/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(row).toBeFocused();
});

test('el guion no le quita el foco al botón Siguiente', async ({ page }) => {
  await open(page);
  const nextButton = page.getByRole('button', { name: 'Siguiente', exact: true });
  await nextButton.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(nextButton).toBeFocused();
  await expect(page.getByText('Paso 3 de 7')).toBeVisible();
});

test('el filtro descarta un detalle que pertenece a otra conexión', async ({ page }) => {
  await open(page);
  await tab(page, 'Inventario').click();
  await page.getByRole('button', { name: 'Abrir detalle: Laboratorio Norte r-17' }).click();
  await page.locator('#connection-filter').focus();
  await page.locator('#connection-filter').selectOption('sur');
  const detail = page.getByRole('complementary');
  await expect(detail).not.toContainText('Laboratorio Norte');
  await expect(detail).toContainText('Elige un registro');
  await expect(page.locator('#connection-filter')).toBeFocused();
});

test('la completa sustituye el aviso parcial sin borrar su evidencia histórica', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /^5 Corrida parcial/ }).click();
  const note = page.getByText(/Corrida parcial: no puede retirar nada/);
  await expect(note).toBeVisible();
  await next(page);
  await expect(note).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Baja.*r-18/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /norte-3 Laboratorio Norte.*Parcial/ })).toBeVisible();
});

test('volver al guion tras abrir un detalle manualmente conserva el foco', async ({ page }) => {
  await open(page);
  await tab(page, 'Inventario').click();
  await page.getByRole('button', { name: 'Abrir detalle: Laboratorio Norte r-17' }).click();
  await page.getByRole('button', { name: /^6 Corrida completa/ }).click();
  const step = page.getByRole('button', { name: /^2 Abrir Norte/ });
  await step.click();
  await expect(step).toBeFocused();
  // También al cambiar una vista o volver de un estado simulado.
  await tab(page, 'Cambios').click();
  const inventory = tab(page, 'Inventario');
  await inventory.click();
  await expect(inventory).toBeFocused();
  const simulation = page.getByLabel('Estado de ejemplo');
  await simulation.focus();
  await simulation.selectOption('loading');
  await simulation.selectOption('ok');
  await expect(simulation).toBeFocused();
});

test('inglés: interfaz y pasos traducidos', async ({ page }) => {
  await open(page, 'en');
  await expect(page.getByRole('note')).toContainText('Demo with sample data');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('row', { name: /Changed.*r-17/ })).toBeVisible();
  await page.getByRole('button', { name: 'ES', exact: true }).click();
  await expect(page.getByRole('row', { name: /Cambio.*r-17/ })).toBeVisible();
});

test('en pantalla angosta la página no se desplaza de lado', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await open(page);
  for (const view of ['Conexiones', 'Inventario', 'Cambios']) {
    await tab(page, view).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, view).toBeLessThanOrEqual(0);
  }
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'detalle').toBeLessThanOrEqual(0);
});

test('sin violaciones de accesibilidad WCAG A/AA en cada vista', async ({ page }) => {
  await open(page);
  // Conexiones al inicio; Inventario con el detalle y la revisión (paso 3);
  // Cambios con la nota de la corrida parcial (paso 5).
  const checks = [
    { advance: 0, view: 'Conexiones' },
    { advance: 2, view: 'Inventario' },
    { advance: 2, view: 'Cambios' },
  ];
  for (const check of checks) {
    for (let i = 0; i < check.advance; i++) await next(page);
    await tab(page, check.view).click();
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(result.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(' | ')}`), check.view).toEqual([]);
  }
});

test('reproduce los estados vacío, cargando, sin conexión, sin permiso y error recuperable', async ({ page }) => {
  await open(page);
  const pick = (label: string) => page.getByLabel('Estado de ejemplo').selectOption({ label });
  await pick('Cargando');
  await expect(page.getByRole('status')).toContainText('Cargando');
  await pick('Sin conexiones');
  await expect(page.getByRole('heading', { name: /Todavía no hay conexiones/ })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  await pick('Sin conexión con la fuente');
  await expect(page.getByRole('alert')).toContainText('no se registra ninguna baja');
  await pick('Permiso insuficiente');
  await expect(page.getByRole('heading', { name: /Tu rol no incluye esta colección/ })).toBeVisible();
  await pick('Error recuperable');
  await expect(page.getByRole('alert')).toContainText('El inventario anterior sigue vigente');
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(result.violations.map(v => v.id)).toEqual([]);
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.getByRole('row', { name: /Laboratorio Norte/ })).toBeVisible();
  // El guion siempre vuelve al estado normal.
  await pick('Cargando');
  await next(page);
  await expect(page.getByRole('status').filter({ hasText: 'Cargando' })).toHaveCount(0);
});

test('cada estado de ejemplo pasa axe en ambos idiomas', async ({ page }) => {
  test.setTimeout(90_000);
  for (const lang of ['es', 'en'] as const) {
    await open(page, lang);
    const selector = page.locator('#sim-state');
    for (const state of ['loading', 'empty', 'offline', 'forbidden', 'error', 'ok']) {
      await selector.selectOption(state);
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(result.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(' | ')}`), `${lang}/${state}`).toEqual([]);
    }
  }
});

test('el guion móvil permite desplegar pasos y deja visible el comienzo del inventario', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page);
  await tab(page, 'Inventario').click();
  const steps = page.getByRole('list', { name: 'Guion del laboratorio' });
  await expect(steps).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Inventario', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: 'Ver todos los pasos' }).click();
  await expect(steps).toBeVisible();
  await page.getByRole('button', { name: /^3 Asignar responsable/ }).click();
  await expect(page.getByText('Paso 3 de 7')).toBeVisible();
  await expect(steps).toBeHidden();
  await expect(page.getByRole('complementary')).toContainText('Ana Ejemplo');
  await expect(page.getByRole('button', { name: 'Ver todos los pasos' })).toBeFocused();
  await page.getByRole('button', { name: 'Cerrar detalle' }).click();
  await expect(page.locator('#connection-filter')).toBeFocused();
});

test('no hace ninguna petición fuera de su propio origen', async ({ page }) => {
  const external: string[] = [];
  page.on('request', r => {
    const url = new URL(r.url());
    if (url.origin !== 'http://127.0.0.1:4180' && !['data:', 'blob:'].includes(url.protocol)) external.push(r.url());
  });
  await open(page);
  for (let i = 0; i < 6; i++) await next(page);
  await page.waitForLoadState('networkidle');
  expect(external).toEqual([]);
});

test('el build entrega los avisos de las dependencias y fuentes', async ({ page }) => {
  await open(page);
  const link = page.getByRole('link', { name: 'Licencias de terceros' });
  const href = await link.getAttribute('href');
  const response = await page.request.get(new URL(href!, page.url()).href);
  expect(response.ok()).toBe(true);
  const notices = await response.text();
  for (const name of ['react ', 'react-dom ', 'scheduler ', '@fontsource-variable/manrope ', '@fontsource/ibm-plex-mono ']) {
    expect(notices).toContain(name);
  }
});
