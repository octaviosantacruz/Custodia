import assert from 'node:assert/strict';
import test from 'node:test';
import { roleDetailEnabled } from '../../../src/cyberark/pam/lib/pam-identity-classification.ts';

/* Regression for use-pam-roles: its role-detail queries used to gate on the
   static `initialKind` prop, so switching the classification filter live to
   "Usuarios" kept firing role-detail requests. The behavioral unit under test
   is the predicate the hook now uses. */
test('role-detail fetches stay disabled only for user identities', () => {
  assert.equal(roleDetailEnabled('user'), false);
  assert.equal(roleDetailEnabled('cyberark_role'), true);
  assert.equal(roleDetailEnabled('okta_group'), true);
  assert.equal(roleDetailEnabled(''), true);
});
