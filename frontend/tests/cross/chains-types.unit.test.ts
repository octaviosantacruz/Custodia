import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GENERATED_PATH } from '../../scripts/generate-chains-types.mjs';
import { verifyGeneratedTypes } from '../../scripts/verify-chains-types.mjs';

/* FE-API-001: the drift check compares a fresh regeneration with the
   committed file. These tests exercise both outcomes with an injected
   generator; the real Python + openapi-typescript pipeline runs in
   `npm run verify` (scripts/verify.sh step 6). */

const committed = readFileSync(GENERATED_PATH, 'utf8');

test('the committed generated file keeps the no-edit header and the chain schemas', () => {
  assert.match(committed, /GENERATED FILE — DO NOT EDIT BY HAND/);
  assert.match(committed, /npm --prefix frontend run generate:chains-types/);
  assert.match(committed, /export interface components/);
  assert.match(committed, /ChainNodeResponse/);
  assert.match(committed, /PersonSummaryResponse/);
});

test('the drift check passes when the regeneration matches the committed file', () => {
  assert.doesNotThrow(() => {
    verifyGeneratedTypes({ generate: (path) => writeFileSync(path, committed) });
  });
});

test('the drift check fails with a regeneration hint when the file is stale', () => {
  assert.throws(
    () => verifyGeneratedTypes({ generate: (path) => writeFileSync(path, `${committed}\n// contrato desactualizado\n`) }),
    /no coincide con el OpenAPI actual[\s\S]*generate:chains-types/,
  );
});

test('the drift check fails when the generated file is missing', () => {
  const missing = join(tmpdir(), `dshub-missing-generated-${process.pid}`, 'chains-api.generated.ts');
  assert.throws(
    () => verifyGeneratedTypes({ generatedPath: missing, generate: () => {} }),
    /generate:chains-types/,
  );
});
