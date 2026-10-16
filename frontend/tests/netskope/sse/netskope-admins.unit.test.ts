import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EMPTY_ADMINS_QUERY, adminKindLabel, adminMfaLabel, adminState, hasAdminFilters, permissionLabel, permissionTone,
} from '../../../src/netskope/sse/lib/netskope-admins.ts';

test('NSK-RBAC-001 permission levels read in Spanish and an unknown level is shown as received', () => {
  assert.deepEqual(['r', 'rw', 'rwa'].map(permissionLabel), ['Lectura', 'Escritura', 'Administración']);
  assert.equal(permissionLabel('rwx'), 'rwx');
  assert.deepEqual(['r', 'rw', 'rwa', 'rwx'].map(permissionTone), ['read', 'write', 'admin', 'other']);
});

test('NSK-RBAC-001 a locked account reads as locked even when active, and an unknown state reads as inactive', () => {
  assert.deepEqual(adminState({ active: true, is_locked: true }), { label: 'Bloqueado', tone: 'locked' });
  assert.deepEqual(adminState({ active: true, is_locked: false }), { label: 'Activo', tone: 'ok' });
  assert.deepEqual(adminState({ active: false, is_locked: null }), { label: 'Inactivo', tone: 'off' });
  assert.deepEqual(adminState({ active: null, is_locked: null }), { label: 'Inactivo', tone: 'off' });
});

test('NSK-RBAC-001 MFA does not apply to service accounts and a missing value is not reported as "No"', () => {
  assert.equal(adminMfaLabel({ record_type: 'SERVICE_ACCOUNT', mfa_enabled: false }), '—');
  assert.equal(adminMfaLabel({ record_type: 'USER', mfa_enabled: true }), 'Sí');
  assert.equal(adminMfaLabel({ record_type: 'USER', mfa_enabled: false }), 'No');
  assert.equal(adminMfaLabel({ record_type: 'USER', mfa_enabled: null }), 'Sin dato');
  assert.deepEqual([adminKindLabel('USER'), adminKindLabel('SERVICE_ACCOUNT'), adminKindLabel(null)], ['Persona', 'Cuenta de servicio', 'Sin dato']);
});

test('NSK-RBAC-001 filters count as active only when one is set', () => {
  assert.equal(hasAdminFilters(EMPTY_ADMINS_QUERY), false);
  assert.equal(hasAdminFilters({ ...EMPTY_ADMINS_QUERY, search: '  ' }), false);
  assert.equal(hasAdminFilters({ ...EMPTY_ADMINS_QUERY, role: 'none' }), true);
  assert.equal(hasAdminFilters({ ...EMPTY_ADMINS_QUERY, search: 'ana' }), true);
});
