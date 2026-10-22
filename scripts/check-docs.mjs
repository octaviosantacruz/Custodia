import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/* DOCS-LINT-001: enlaces relativos, rutas del repo e IDs de tracker citados en la documentación.
   Las funciones reciben un mapa { ruta: contenido } y la lista de rutas existentes para poder probarse sin disco. */

// Los docs con `estado: histórico` en su frontmatter son registros: citan rutas e IDs que ya no existen a propósito.
export const STATES = ['vigente', 'histórico'];
export const STALE_AFTER_DAYS = 90;
// Carpetas cuyos docs siempre son registros históricos.
const HISTORICAL_FOLDERS = [/^docs\/history\//];
// Rutas citadas que no existen por una razón explícita.
export const ALLOWED_MISSING_PATHS = new Map([
  ['backend/Dockerfile', 'diseño futuro: Docker no está reintroducido (docs/operations/deployment.md)'],
  ['frontend/Dockerfile', 'diseño futuro: Docker no está reintroducido (docs/operations/deployment.md)'],
]);
const PLACEHOLDER_IDS = new Set(['YYYY-MM-DD']);
const REPO_ROOTS = /^(backend|frontend|scripts|docs|migrations|\.github)\//;
const ID_PATTERN = /`([A-Z][A-Z0-9]+(?:-[A-Z0-9]+)+)`/g;
const PATH_PATTERN = /`((?:backend|frontend|scripts|docs|migrations|\.github)\/[A-Za-z0-9_./-]*[A-Za-z0-9_/])`/g;
const LINK_PATTERN = /\]\(([^)\s]+)\)/g;

export function slugify(heading) {
  return heading.toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu, '').replace(/ /g, '-');
}

export function headingAnchors(text) {
  const seen = new Map();
  const anchors = new Set();
  let fenced = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    const match = !fenced && line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const base = slugify(match[1].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/`/g, ''));
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count ? `${base}-${count}` : base);
  }
  return anchors;
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;


/** Frontmatter mínimo `clave: valor` entre dos líneas `---` al inicio del archivo. */
export function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([^:#]+):\s*(.*?)\s*$/);
    if (pair) fields[pair[1].trim()] = pair[2];
  }
  return fields;
}

const isHistorical = (docs, path) => parseFrontmatter(docs[path] ?? '')?.estado === 'histórico';
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

/** Errores del frontmatter: todo doc declara estado, dueño y fecha de revisión válidos. */
export function frontmatterProblems(docs, today) {
  const problems = [];
  for (const [path, text] of Object.entries(docs)) {
    if (!path.startsWith('docs/')) continue;
    const fields = parseFrontmatter(text);
    if (!fields) { problems.push(`${path}:1 falta el frontmatter (estado, dueño, revisado). Agregalo al inicio del archivo; el esquema está en docs/README.md.`); continue; }
    if (!STATES.includes(fields.estado)) problems.push(`${path}:1 estado "${fields.estado ?? ''}" inválido; usá ${STATES.join(' o ')}.`);
    else if (fields.estado !== 'histórico' && HISTORICAL_FOLDERS.some((pattern) => pattern.test(path))) problems.push(`${path}:1 vive en una carpeta de registros históricos: su estado debe ser histórico.`);
    if (!fields['dueño']) problems.push(`${path}:1 falta "dueño" en el frontmatter.`);
    if (!validDate(fields.revisado ?? '')) problems.push(`${path}:1 "revisado" debe ser una fecha AAAA-MM-DD válida (recibí "${fields.revisado ?? ''}").`);
    else if (fields.revisado > today) problems.push(`${path}:1 "revisado" (${fields.revisado}) está en el futuro.`);
  }
  return problems;
}

/** Avisos (no fallan): docs vigentes sin revisión reciente. */
export function staleWarnings(docs, today, maxDays = STALE_AFTER_DAYS) {
  const warnings = [];
  for (const [path, text] of Object.entries(docs)) {
    const fields = path.startsWith('docs/') ? parseFrontmatter(text) : null;
    // Un doc generado se verifica con su propio test: no necesita revisión periódica.
    if (!fields || fields.estado !== 'vigente' || fields.generado === 'sí' || !validDate(fields.revisado ?? '')) continue;
    const days = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${fields.revisado}T00:00:00Z`)) / 86_400_000);
    if (days > maxDays) warnings.push(`${path}: vigente sin revisar hace ${days} días (revisado ${fields.revisado}). Revisalo y actualizá la fecha, o marcalo histórico.`);
  }
  return warnings;
}

/** Enlaces relativos a archivos o secciones que no existen. */
export function brokenLinks(docs, exists) {
  const problems = [];
  const anchors = new Map();
  const anchorsOf = (path) => { if (!anchors.has(path)) anchors.set(path, headingAnchors(docs[path] ?? '')); return anchors.get(path); };
  for (const [path, text] of Object.entries(docs)) {
    for (const match of text.matchAll(LINK_PATTERN)) {
      const target = match[1];
      if (/^(https?:|mailto:)/.test(target)) continue;
      const [file, anchor] = target.split('#');
      const resolved = file ? normalize(join(dirname(path), file)).split(sep).join('/') : path;
      if (!exists(resolved)) {
        problems.push(`${path}:${lineOf(text, match.index)} enlace roto a ${target}. Corregí la ruta o quitá el enlace.`);
      } else if (anchor && resolved.endsWith('.md') && docs[resolved] !== undefined && !anchorsOf(resolved).has(anchor)) {
        problems.push(`${path}:${lineOf(text, match.index)} la sección #${anchor} no existe en ${resolved}. Actualizá el ancla.`);
      }
    }
  }
  return problems;
}

/** Rutas del repositorio citadas con comillas invertidas que ya no existen. */
export function missingPaths(docs, exists) {
  const problems = [];
  for (const [path, text] of Object.entries(docs)) {
    if (isHistorical(docs, path)) continue;
    for (const match of text.matchAll(PATH_PATTERN)) {
      const cited = match[1];
      if (!REPO_ROOTS.test(cited) || /[*<>{}]|NNN|\.\.\./.test(cited) || ALLOWED_MISSING_PATHS.has(cited)) continue;
      if (!exists(cited)) problems.push(`${path}:${lineOf(text, match.index)} cita la ruta ${cited}, que no existe. Actualizala o, si es a propósito, agregala a ALLOWED_MISSING_PATHS con su motivo.`);
    }
  }
  return problems;
}

/** IDs de tracker citados fuera de los trackers que no aparecen en ninguno. */
export function unknownTrackerIds(docs, trackerPaths) {
  const known = new Set();
  for (const path of trackerPaths) for (const match of (docs[path] ?? '').matchAll(ID_PATTERN)) known.add(match[1]);
  const problems = [];
  for (const [path, text] of Object.entries(docs)) {
    if (isHistorical(docs, path) || trackerPaths.includes(path) || path.startsWith('docs/tracking/')) continue;
    for (const match of text.matchAll(ID_PATTERN)) {
      if (PLACEHOLDER_IDS.has(match[1]) || known.has(match[1])) continue;
      problems.push(`${path}:${lineOf(text, match.index)} cita el ID ${match[1]}, que no existe en TO_IMPLEMENT, BACKLOG_ARCHIVE ni IMPLEMENTED. Corregí el ID o registralo en el tracker.`);
    }
  }
  return problems;
}

export function trackerFiles(paths) {
  return paths.filter((path) => /^docs\/tracking\/(TO_IMPLEMENT|BACKLOG_ARCHIVE|IMPLEMENTED)\.md$/.test(path));
}

export function checkDocs(docs, exists, today = new Date().toISOString().slice(0, 10)) {
  return [...frontmatterProblems(docs, today), ...brokenLinks(docs, exists), ...missingPaths(docs, exists), ...unknownTrackerIds(docs, trackerFiles(Object.keys(docs)))];
}

function collect(root) {
  const docs = {};
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.toLowerCase().endsWith('.md')) docs[relative(root, full).split(sep).join('/')] = readFileSync(full, 'utf8');
    }
  };
  walk(join(root, 'docs'));
  for (const name of ['AGENTS.md', 'README.md']) if (existsSync(join(root, name))) docs[name] = readFileSync(join(root, name), 'utf8');
  return docs;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, '..');
  const docs = collect(root);
  // docs/history/ está en .gitignore: en un checkout sin esa carpeta sus rutas no cuentan como rotas.
  const hasHistory = existsSync(join(root, 'docs', 'history'));
  const exists = (path) => (!hasHistory && path.startsWith('docs/history/')) || existsSync(join(root, path));
  const today = new Date().toISOString().slice(0, 10);
  const warnings = staleWarnings(docs, today);
  if (warnings.length) console.warn(`${warnings.map((warning) => `Aviso: ${warning}`).join('\n')}\n`);
  const problems = checkDocs(docs, exists, today);
  if (problems.length) {
    console.error(problems.join('\n'));
    console.error(`\n${problems.length} problema(s) en la documentación.`);
    process.exitCode = 1;
  } else {
    console.log('Documentación: frontmatter, enlaces, rutas e IDs citados verificados.');
  }
}
