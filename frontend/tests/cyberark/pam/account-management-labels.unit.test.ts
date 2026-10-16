import assert from 'node:assert/strict';
import test from 'node:test';

import {
  automaticManagementLabel,
  managementStatusLabel,
} from '../../../src/cyberark/pam/lib/account-management.ts';

test('account management labels distinguish explicit values from missing data', () => {
  assert.equal(automaticManagementLabel(true), 'Activada');
  assert.equal(automaticManagementLabel(false), 'Deshabilitada');
  assert.equal(automaticManagementLabel(null), 'Sin dato');
  assert.equal(automaticManagementLabel(undefined), 'Sin dato');
  assert.equal(managementStatusLabel('success'), 'Correcto');
  assert.equal(managementStatusLabel('failure'), 'Falló');
  assert.equal(managementStatusLabel('in_process'), 'En proceso');
  assert.equal(managementStatusLabel(null), 'Sin estado');
  assert.equal(managementStatusLabel(undefined), 'Sin estado');
});
