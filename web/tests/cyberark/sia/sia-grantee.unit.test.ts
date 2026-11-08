import assert from 'node:assert/strict';
import test from 'node:test';

import { siaGranteeTarget } from '../../../src/cyberark/sia/lib/sia-grantee.ts';

test('routes sg_cyberark names to Okta groups', () => {
  assert.deepEqual(siaGranteeTarget('sg_cyberark_platform_admin', 'role'), {
    kind: 'group',
    view: 'identityGroups',
  });
});

test('keeps ordinary PAM roles in the Roles view', () => {
  assert.deepEqual(siaGranteeTarget('CyberArk PAM Admin', 'role'), {
    kind: 'role',
    view: 'roles',
  });
});
