import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RETIRED_LIMIT_MAX,
  RETIRED_PAGE_SIZE,
  hasMoreRetired,
  nextRetiredLimit,
  retiredLimitNote,
} from '../../../src/cyberark/pam/lib/retired-safes.ts';

test('retired Safes pagination uses 50-row batches under the 500-row API cap', () => {
  assert.equal(RETIRED_PAGE_SIZE, 50);
  assert.equal(RETIRED_LIMIT_MAX, 500);

  assert.equal(nextRetiredLimit(0, 120), 50);
  assert.equal(nextRetiredLimit(50, 120), 100);
  assert.equal(nextRetiredLimit(100, 120), 120);
  assert.equal(nextRetiredLimit(450, 600), 500);
  assert.equal(nextRetiredLimit(500, 600), 500);
  // Nothing to load: keep the current limit instead of asking for more.
  assert.equal(nextRetiredLimit(50, 30), 50);
  assert.equal(nextRetiredLimit(0, 0), 0);
});

test('hasMoreRetired stops at the API cap and when every row is loaded', () => {
  assert.equal(hasMoreRetired(0, 0), false);
  assert.equal(hasMoreRetired(0, 120), true);
  assert.equal(hasMoreRetired(100, 120), true);
  assert.equal(hasMoreRetired(120, 120), false);
  assert.equal(hasMoreRetired(499, 600), true);
  assert.equal(hasMoreRetired(500, 600), false);
  assert.equal(hasMoreRetired(600, 500), false);
});

test('retiredLimitNote only explains the cap when the tenant exceeds it', () => {
  assert.equal(retiredLimitNote(500, 600), `La API devuelve como máximo ${RETIRED_LIMIT_MAX} Safes retiradas por consulta; hay 100 más sin mostrar.`);
  assert.equal(retiredLimitNote(450, 600), null);
  assert.equal(retiredLimitNote(500, 500), null);
  assert.equal(retiredLimitNote(200, 600), null);
  assert.equal(retiredLimitNote(0, 0), null);
});
