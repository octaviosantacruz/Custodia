import assert from 'node:assert/strict';
import test from 'node:test';

import { findingGuidance } from '../src/lib/finding-guidance.ts';

test('returns actionable guidance for a known finding rule', () => {
  const guidance = findingGuidance({ rule_id: 'ACCOUNT_PLATFORM_MISSING' });
  assert.match(guidance.observation, /sin identificador ni nombre/);
  assert.match(guidance.action, /fuente/);
});

test('returns safe fallback guidance for an unknown rule', () => {
  assert.equal(findingGuidance({ rule_id: 'FUTURE_RULE' }).actionShort, 'Revisar evidencia en la fuente');
});
