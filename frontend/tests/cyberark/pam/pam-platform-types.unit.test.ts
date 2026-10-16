import assert from 'node:assert/strict';
import test from 'node:test';
import { platformTypeLabel } from '../../../src/cyberark/pam/lib/pam-platform-types.ts';

test('UX-QA-005: platform types are labelled in Spanish and keep the raw CyberArk value', () => {
  assert.deepEqual(platformTypeLabel('Operating System'), { label: 'Sistema operativo', raw: 'Operating System' });
  assert.deepEqual(platformTypeLabel('Imported Platforms'), { label: 'Plataformas importadas', raw: 'Imported Platforms' });
  assert.equal(platformTypeLabel('*NIX').label, 'Unix / Linux');
});

test('UX-QA-005: an unmapped type falls back to its original text and a missing one says so', () => {
  assert.deepEqual(platformTypeLabel('New CyberArk Type'), { label: 'New CyberArk Type', raw: 'New CyberArk Type' });
  assert.deepEqual(platformTypeLabel(''), { label: 'Sin tipo', raw: null });
  assert.deepEqual(platformTypeLabel(undefined), { label: 'Sin tipo', raw: null });
});
