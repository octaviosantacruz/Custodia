// Captures the site screenshots from a running demo, in English and Spanish,
// at 2x so they stay sharp at full width. Sizes must match site/template.html:
// person 1440x760, summary and tools 1120x700.
//
//   cd web && npm run build:demo && npx vite preview --port 4190
//   node site/scripts/capture-shots.mjs [http://127.0.0.1:4190]
//
// Needs Playwright from web/ and Python with Pillow for the WebP copies.
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../web/node_modules/@playwright/test/index.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:4190';
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/shots');

const shots = [
  { name: 'summary', path: '/', viewport: { width: 1120, height: 700 } },
  { name: 'person', path: '/chains/person', async before(page) {
    await page.locator('main input[type=search]').first().fill('alice');
    await page.getByRole('option').first().click();
  }, clip: { x: 0, y: 0, width: 1440, height: 760 } },
  { name: 'tools', path: '/pam/safes', viewport: { width: 1120, height: 700 } },
];

const browser = await chromium.launch();
const errors = [];
for (const lang of ['en', 'es']) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark', reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(`${lang}: ${error.message}`));
  await mkdir(join(out, lang), { recursive: true });
  for (const shot of shots) {
    await page.setViewportSize(shot.viewport ?? { width: 1440, height: 900 });
    await page.goto(`${base}${shot.path}?lang=${lang}`, { waitUntil: 'networkidle' });
    await shot.before?.(page);
    await page.waitForTimeout(1200);
    const file = join(out, lang, `${shot.name}.png`);
    await page.screenshot({ path: file, clip: shot.clip });
    execFileSync('python3', ['-c', 'import sys;from PIL import Image;Image.open(sys.argv[1]).convert("RGB").save(sys.argv[2],"WEBP",quality=84,method=6)', file, file.replace(/\.png$/, '.webp')]);
    console.log(`${lang}/${shot.name}`);
  }
  await page.close();
}
await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
}
