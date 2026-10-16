/* FE-API-001: fail `npm run verify` when the committed generated types drift
   from the app's current OpenAPI contract. Regenerates to a temp file and
   byte-compares. The comparison is exported so a unit test can exercise both
   outcomes without running the Python + generator pipeline. */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { GENERATED_PATH, generateTo } from './generate-chains-types.mjs';

export function verifyGeneratedTypes({ generatedPath = GENERATED_PATH, generate = generateTo } = {}) {
  const hint = 'Regeneralo con: npm --prefix frontend run generate:chains-types';
  if (!existsSync(generatedPath)) {
    throw new Error(`Falta ${relative(process.cwd(), generatedPath)}. ${hint}`);
  }
  const committed = readFileSync(generatedPath, 'utf8');
  const tempDir = mkdtempSync(join(tmpdir(), 'dshub-openapi-check-'));
  try {
    const regeneratedPath = join(tempDir, 'chains-api.generated.ts');
    generate(regeneratedPath);
    const regenerated = readFileSync(regeneratedPath, 'utf8');
    if (regenerated === committed) return;
    const committedLines = committed.split('\n');
    const regeneratedLines = regenerated.split('\n');
    const firstDifference = committedLines.findIndex((line, index) => line !== regeneratedLines[index]);
    const context = firstDifference < 0 ? '' : [
      '',
      `Primera diferencia, línea ${firstDifference + 1}:`,
      `  committeado: ${committedLines[firstDifference] ?? '<sin línea>'}`,
      `  regenerado:  ${regeneratedLines[firstDifference] ?? '<sin línea>'}`,
    ].join('\n');
    throw new Error(`${relative(process.cwd(), generatedPath)} no coincide con el OpenAPI actual. ${hint}${context}`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function main() {
  verifyGeneratedTypes();
  console.log('Tipos generados de Cadenas al día.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
