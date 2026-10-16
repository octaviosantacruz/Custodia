/* FE-CSS-001/002: static checks over the CSS ownership rules in styles/README.md.
   Pure functions over an in-memory { path: content } map so they can be unit tested. */
import { posix } from 'node:path';

const THIRD_PARTY = /^(lucide|react-aria|recharts|echarts)/;
const IMPORT_RE = /^\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm;
const DYNAMIC_IMPORT_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
const EXTENSIONS = ['', '.tsx', '.ts', '/index.tsx', '/index.ts'];

export function stripCssComments(text) { return text.replace(/\/\*[\s\S]*?\*\//g, ''); }
/** Text of className attributes only: avoids matching ordinary words that happen to be class names. */
export function classNameText(text) {
  const pieces = [];
  for (const match of stripSourceComments(text).matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\}|\{([^}]*)\})/g)) pieces.push(match[1] ?? match[2] ?? match[3] ?? match[4] ?? '');
  return pieces.join('\n');
}
export function stripSourceComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
}

/** Class names that appear in selectors (not in declarations) of a stylesheet. */
export function selectorClasses(css) {
  const classes = new Set();
  for (const match of stripCssComments(css).matchAll(/([^{}]+)(?=\{)/g)) {
    const prelude = match[1].trim();
    if (!prelude || prelude.startsWith('@')) continue;
    for (const cls of prelude.matchAll(/\.([A-Za-z_][\w-]*)/g)) classes.add(cls[1]);
  }
  return classes;
}

/** First class of every selector: the one that must be present for the rule to matter to a component. */
export function anchorClasses(css) {
  const classes = new Set();
  for (const match of stripCssComments(css).matchAll(/([^{}]+)(?=\{)/g)) {
    const prelude = match[1].trim();
    if (!prelude || prelude.startsWith('@')) continue;
    for (const selector of prelude.replace(/:(?:is|not|where|has)\([^()]*(?:\([^()]*\)[^()]*)*\)/g, '').split(',')) {
      const first = selector.match(/\.([A-Za-z_][\w-]*)/);
      if (first) classes.add(first[1]);
    }
  }
  return classes;
}

function resolveModule(files, from, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = posix.normalize(posix.join(posix.dirname(from), specifier));
  for (const extension of EXTENSIONS) if (files[base + extension] !== undefined && /\.(tsx?|css)$/.test(base + extension)) return base + extension;
  return null;
}

/** Static import graph (css files included) and the modules reached by dynamic import(). */
export function importGraph(files) {
  const edges = new Map();
  const dynamicTargets = new Set();
  const dynamicFrom = new Map();
  for (const [path, content] of Object.entries(files)) {
    if (!/\.tsx?$/.test(path)) continue;
    const source = stripSourceComments(content);
    const set = new Set();
    for (const match of source.matchAll(IMPORT_RE)) {
      if (/^\s*(import|export)\s+type\b/.test(match[0])) continue;
      const target = resolveModule(files, path, match[1] ?? match[2]);
      if (target) set.add(target);
    }
    edges.set(path, set);
    for (const match of source.matchAll(DYNAMIC_IMPORT_RE)) {
      const target = resolveModule(files, path, match[1]);
      if (!target) continue;
      dynamicTargets.add(target);
      if (!dynamicFrom.has(target)) dynamicFrom.set(target, new Set());
      dynamicFrom.get(target).add(path);
    }
  }
  return { edges, dynamicTargets, dynamicFrom };
}

function closure(edges, entry) {
  const seen = new Set([entry]);
  const stack = [entry];
  while (stack.length) {
    for (const next of edges.get(stack.pop()) ?? []) if (!seen.has(next)) { seen.add(next); stack.push(next); }
  }
  return seen;
}

/** A class defined only by component stylesheets must be available wherever a component uses it. */
export function findUnreachedStyleUsers(files, { mainEntry = 'src/main.tsx', globalStyles = [] } = {}) {
  const graph = importGraph(files);
  const entries = [mainEntry, ...graph.dynamicTargets].filter((entry) => graph.edges.has(entry));
  const closures = new Map(entries.map((entry) => [entry, closure(graph.edges, entry)]));
  const sources = Object.keys(files).filter((path) => /\.tsx?$/.test(path) && !path.endsWith('.d.ts'));
  const clean = Object.fromEntries(sources.map((path) => [path, classNameText(files[path])]));
  const cssPaths = Object.keys(files).filter((path) => path.endsWith('.css'));
  const alwaysLoaded = new Set([...globalStyles, ...[...(closures.get(mainEntry) ?? [])].filter((path) => path.endsWith('.css'))]);

  const definers = new Map();
  for (const cssPath of cssPaths) {
    for (const cls of anchorClasses(files[cssPath])) {
      if (!definers.has(cls)) definers.set(cls, new Set());
      definers.get(cls).add(cssPath);
    }
  }
  const importersOf = (cssPath) => new Set([...graph.edges].filter(([, set]) => set.has(cssPath)).map(([from]) => from));
  const loadedBy = (entry, importers, seen = new Set()) => {
    const reached = closures.get(entry);
    if ([...importers].some((importer) => reached.has(importer))) return true;
    if (seen.has(entry)) return false;
    seen.add(entry);
    // A lazy entry is always loaded after the module that imports it, so it inherits that module's styles.
    const froms = graph.dynamicFrom.get(entry);
    if (!froms?.size) return false;
    for (const from of froms) {
      const parents = entries.filter((parent) => parent !== entry && closures.get(parent).has(from));
      if (!parents.length || !parents.every((parent) => loadedBy(parent, importers, new Set(seen)))) return false;
    }
    return true;
  };

  const problems = [];
  for (const [cls, defs] of definers) {
    if (THIRD_PARTY.test(cls) || [...defs].some((def) => alwaysLoaded.has(def))) continue;
    const importers = new Set([...defs].flatMap((def) => [...importersOf(def)]));
    const pattern = new RegExp(`(^|[^\\w-])${cls.replace(/-/g, '\\-')}($|[^\\w-])`);
    for (const source of sources) {
      if (importers.has(source) || !pattern.test(clean[source])) continue;
      if (entries.every((entry) => !closures.get(entry).has(source) || loadedBy(entry, importers))) continue;
      problems.push({ css: [...defs].join(', '), user: source, classes: [cls] });
    }
  }
  const merged = new Map();
  for (const problem of problems) {
    const key = `${problem.user}|${problem.css}`;
    if (merged.has(key)) merged.get(key).classes.push(...problem.classes);
    else merged.set(key, { ...problem, classes: [...problem.classes] });
  }
  return [...merged.values()].map((problem) => ({ ...problem, classes: problem.classes.slice(0, 5) }));
}

/** Classes defined in a stylesheet that no source file mentions, as a whole word or as a dynamic prefix. */
export function findDeadClasses(files, cssPaths) {
  const sources = Object.entries(files).filter(([path]) => /\.(tsx?|html)$/.test(path) && !path.endsWith('.d.ts'));
  const text = sources.map(([, content]) => stripSourceComments(content)).join('\n');
  const dead = [];
  for (const cssPath of cssPaths) {
    for (const cls of selectorClasses(files[cssPath])) {
      if (THIRD_PARTY.test(cls)) continue;
      if (new RegExp(`(^|[^\\w-])${cls.replace(/-/g, '\\-')}($|[^\\w-])`).test(text)) continue;
      const parts = cls.split('-');
      const dynamic = parts.some((_, index) => index > 0 && (() => { const prefix = `${parts.slice(0, index).join('-')}-`; return text.includes(`${prefix}\${`) || text.includes(`'${prefix}' +`) || text.includes(`"${prefix}" +`); })());
      if (!dynamic) dead.push({ css: cssPath, cls });
    }
  }
  return dead;
}
