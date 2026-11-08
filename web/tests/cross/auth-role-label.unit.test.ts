import assert from 'node:assert/strict';
import test from 'node:test';

import { primaryRoleLabel } from '../../src/cross/lib/auth-role-label.ts';

test('uses the catalog display name for an OIDC or custom role', () => {
  assert.equal(primaryRoleLabel({
    mode: 'oidc',
    authenticated: true,
    permissions: ['access:manage'],
    user: { actor_id: 'octavio', roles: ['security_lead'], role_names: ['Responsable de seguridad'] },
  }), 'Responsable de seguridad');
});

test('does not label an unmapped identity as reader', () => {
  assert.equal(primaryRoleLabel({
    mode: 'oidc',
    authenticated: true,
    permissions: [],
    user: { actor_id: 'external-user', roles: [] },
  }), 'Sin rol asignado');
});
