// Lista los textos envueltos con t('...') que todavía no tienen traducción
// al inglés en src/cross/i18n/en.ts. Con --keys imprime todas las claves.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EN } from '../src/cross/i18n/en.ts';

const files = readdirSync('src', { recursive: true }).filter((file) => /\.(ts|tsx)$/.test(file)).map((file) => join('src', file));
const keys = new Map();
const pattern = /\bt\(\s*'((?:[^'\\]|\\.)*)'/g;
for (const file of files) {
  for (const match of readFileSync(file, 'utf8').matchAll(pattern)) {
    const key = match[1].replace(/\\'/g, "'");
    if (!keys.has(key)) keys.set(key, file);
  }
}
const missing = [...keys].filter(([key]) => !(key in EN));
if (process.argv.includes('--keys')) {
  for (const [key] of keys) console.log(key);
} else if (process.argv.includes('--missing')) {
  for (const [key, file] of missing) console.log(`${file}\t${key}`);
}
const stale = Object.keys(EN).filter((key) => !keys.has(key));
console.error(`i18n: ${keys.size} textos, ${keys.size - missing.length} traducidos, ${missing.length} sin traducir, ${stale.length} traducciones sin uso.`);
