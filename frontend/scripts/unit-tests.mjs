import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const files = readdirSync('tests', { recursive: true })
  .filter((file) => file.endsWith('.unit.test.ts'))
  .sort()
  .map((file) => join('tests', file));

if (files.length === 0) {
  console.error('No se encontraron tests unitarios en tests/.');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
