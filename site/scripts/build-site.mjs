// Genera las páginas del sitio de producto desde una plantilla y sus textos:
// index.html (inglés, por defecto) y es/index.html. Corre antes de Vite.
// Una clave sin texto detiene el build, así ningún idioma queda a medias.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pages } from '../site/strings.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const template = await readFile(join(root, 'site/template.html'), 'utf8');

// Las capturas no llevan hash en el nombre: la versión en la URL cambia con su
// contenido, así una captura nueva no queda escondida detrás de la caché.
const shots = createHash('sha256');
for (const name of ['summary', 'person', 'tools']) shots.update(await readFile(join(root, `public/shots/${name}.png`)));
const shotVersion = shots.digest('hex').slice(0, 10);

for (const [lang, strings] of Object.entries(pages)) {
  // Dirección de la demo (otra app, otro proyecto de Pages). Se puede cambiar al publicar.
  const values = { ...strings, shotVersion, demo: (process.env.CUSTODIA_DEMO_URL || 'https://custodia-demo.pages.dev').replace(/\/$/, '') };
  strings.m_rows.forEach((row, i) => { values[`m_row${i}`] = row; });
  const missing = new Set();
  const html = template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in values)) missing.add(key);
    return values[key] ?? '';
  });
  if (missing.size) throw new Error(`${lang}: faltan textos: ${[...missing].join(', ')}`);
  const out = join(root, strings.path === '/' ? 'index.html' : `${strings.path.slice(1)}index.html`);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, html.replace('<!doctype html>\n', '<!doctype html>\n<!-- Generado por scripts/build-site.mjs desde site/template.html. No editar. -->\n'));
}
