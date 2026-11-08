/* FE-API-001: generate the Cadenas domain types from the app's real OpenAPI.
   Pipeline: scripts/dump_openapi.py (in-memory app, pruned to /api/chains)
   -> openapi-typescript -> repo header -> src/cross/lib/chains-api.generated.ts.
   The dump sorts keys and the generator is a pure function of that JSON, so
   `npm run verify:chains-types` can byte-compare a fresh regeneration against
   the committed file.

   openapi-typescript 7 needs the TypeScript 5 compiler API; the project runs
   TypeScript 7, so the CLI is spawned with a resolver that points its
   `typescript` import at the `typescript5` devDependency alias. The npm
   `overrides` entry in package.json keeps `npm install` from rejecting the
   peer range; neither touches the TypeScript the build uses. */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(frontendRoot, '..');
const dumpScript = join(repoRoot, 'scripts', 'dump_openapi.py');
const openapiTypescriptCli = join(frontendRoot, 'node_modules', 'openapi-typescript', 'bin', 'cli.js');
const typescript5Register = join(frontendRoot, 'scripts', 'register-typescript5.mjs');
const pathPrefix = '/api/chains';

export const GENERATED_PATH = join(frontendRoot, 'src', 'cross', 'lib', 'chains-api.generated.ts');

const HEADER = `/**
 * GENERATED FILE — DO NOT EDIT BY HAND (FE-API-001).
 *
 * Tipos del dominio Cadenas derivados del OpenAPI real de la app:
 * app.openapi() podado a ${pathPrefix} por scripts/dump_openapi.py.
 * Regenerar: npm --prefix frontend run generate:chains-types
 * Desfase:   npm --prefix frontend run verify:chains-types
 */
`;

function pythonBinary() {
  const venv = join(repoRoot, 'backend', '.venv', 'bin', 'python');
  return existsSync(venv) ? venv : 'python3';
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} falló (código ${result.status}):\n${result.stderr || result.stdout}`);
  }
}

/** Regenerates `outputPath` from the live OpenAPI schema. */
export function generateTo(outputPath) {
  const tempDir = mkdtempSync(join(tmpdir(), 'dshub-openapi-'));
  try {
    const schemaPath = join(tempDir, 'openapi-chains.json');
    run(pythonBinary(), [dumpScript, '--path-prefix', pathPrefix, '--output', schemaPath]);
    run(process.execPath, [
      '--import', pathToFileURL(typescript5Register).href,
      openapiTypescriptCli, schemaPath, '--output', outputPath,
    ]);
    writeFileSync(outputPath, HEADER + readFileSync(outputPath, 'utf8'));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function main() {
  generateTo(GENERATED_PATH);
  console.log(`Tipos generados: ${relative(repoRoot, GENERATED_PATH)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
