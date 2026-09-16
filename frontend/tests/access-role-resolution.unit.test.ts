import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCompositePermissions } from '../src/lib/access-role-resolution.ts';
import type { AccessDomain } from '../src/lib/access-control-api.ts';

test('a composite role resolves the union of its referenced base levels', () => {
  const domains: AccessDomain[] = [
    {
      domain_code: 'pam', display_name: 'CyberArk PAM', lifecycle_status: 'active', sort_order: 10,
      levels: [{ level_code: 'admin', display_name: 'Administrador', base_role_code: 'cyberark_admin', lifecycle_status: 'active', permission_codes: ['domain:pam', 'inventory:read'] }],
    },
    {
      domain_code: 'dlp', display_name: 'Netskope DLP', lifecycle_status: 'planned', sort_order: 20,
      levels: [{ level_code: 'reader', display_name: 'Lector', base_role_code: 'netskope_reader', lifecycle_status: 'planned', permission_codes: ['domain:dlp', 'inventory:read'] }],
    },
  ];
  const selected = [{ domain_code: 'pam', level_code: 'admin' }, { domain_code: 'dlp', level_code: 'reader' }];

  assert.deepEqual(resolveCompositePermissions(selected, domains), ['domain:dlp', 'domain:pam', 'inventory:read']);

  domains[1].levels[0].permission_codes.push('netskope:read');
  assert.deepEqual(resolveCompositePermissions(selected, domains), ['domain:dlp', 'domain:pam', 'inventory:read', 'netskope:read']);
});
