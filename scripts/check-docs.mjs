import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

// Documentation-only gate. Product checks belong to the packages added later.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docs = (await readdir(join(root, 'docs'))).filter(name => name.endsWith('.md'));
const files = ['README.md', 'AGENTS.md', ...docs.map(name => `docs/${name}`)];
const sources = new Map(await Promise.all(files.map(async name => [name, await readFile(join(root, name), 'utf8')])));
const failures = [];
let links = 0;

function anchors(source) {
  const counts = new Map();
  const result = new Set();
  for (const heading of source.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = heading[1].toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/ /g, '-');
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    result.add(count ? `${base}-${count}` : base);
  }
  return result;
}

for (const [name, source] of sources) {
  if (name.startsWith('docs/') && !/^---\nestado: vigente\ndueño: .+\nrevisado: \d{4}-\d{2}-\d{2}\n---\n/.test(source)) {
    failures.push(`${name}: falta metadata de vigencia`);
  }
  for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (/^https?:\/\//.test(target)) continue;
    links++;
    const [path, fragment] = target.split('#');
    const absolute = resolve(dirname(join(root, name)), decodeURIComponent(path || name.split('/').at(-1)));
    const local = relative(root, absolute);
    if (local.startsWith('..') || isAbsolute(local)) {
      failures.push(`${name}: enlace fuera del producto: ${target}`);
      continue;
    }
    try {
      if (!(await stat(absolute)).isFile()) throw new Error('no es archivo');
      if (fragment) {
        const destination = sources.get(local) ?? await readFile(absolute, 'utf8');
        if (!anchors(destination).has(decodeURIComponent(fragment))) throw new Error('ancla inexistente');
      }
    } catch (error) {
      failures.push(`${name}: ${target}: ${error.message}`);
    }
  }
}

const ids = new Set();
for (const name of ['docs/TO_IMPLEMENT.md', 'docs/IMPLEMENTED.md']) {
  for (const match of sources.get(name).matchAll(/^\| `(PROD-[A-Z]+-\d{3})` \|/gm)) {
    if (ids.has(match[1])) failures.push(`${name}: ID duplicado o pendiente y cerrado: ${match[1]}`);
    ids.add(match[1]);
  }
}
if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Documentación OK: ${files.length} archivos, ${links} enlaces locales, ${ids.size} IDs únicos.\nSólo documentación; no valida runtime, autenticación ni despliegue.\n`);
}
