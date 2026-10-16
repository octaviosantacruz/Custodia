import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { findDeadClasses, findUnreachedStyleUsers } from './lib/style-cascade.mjs';

const frontendRoot = join(import.meta.dirname, '..');
const GLOBAL_STYLES = ['src/styles/foundation.css', 'src/styles.css', 'src/styles/application-shell.css', 'src/styles/motion.css'];

const files = {};
for (const entry of readdirSync(join(frontendRoot, 'src'), { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !/\.(tsx?|css)$/.test(entry.name)) continue;
  const full = join(entry.parentPath, entry.name);
  files[relative(frontendRoot, full).split(sep).join('/')] = readFileSync(full, 'utf8');
}
files['index.html'] = readFileSync(join(frontendRoot, 'index.html'), 'utf8');

const errors = [];
for (const problem of findUnreachedStyleUsers(files, { globalStyles: GLOBAL_STYLES })) {
  errors.push(`${problem.user} usa ${problem.classes.join(', ')} de ${problem.css}, pero no carga ese CSS. Importalo en el componente o movelo a un CSS que cargue siempre (main.tsx).`);
}
const cssFiles = Object.keys(files).filter((path) => path.endsWith('.css'));
for (const dead of findDeadClasses(files, cssFiles)) {
  errors.push(`${dead.css}: la clase .${dead.cls} no aparece en ningún componente; eliminá la regla.`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`\n${errors.length} problema(s) de estilos. Reglas de ubicación y cascada: src/styles/README.md.`);
  process.exit(1);
}
console.log('Alcance y clases de estilos verificados.');
