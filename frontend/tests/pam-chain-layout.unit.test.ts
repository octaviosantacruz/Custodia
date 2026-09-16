import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateRoleRoutes, chainPathRows, groupRowsByRole } from '../src/lib/pam-chain-layout.ts';
import type { PamUserChain } from '../src/types/pam.ts';

test('PAM chain layout renders each Safe, platform and PSM once per role', () => {
  const sharedPsm = { object_id: 40, display_name: 'PSM-01', source_id: 'psm-01' };
  const unix = { object_id: 30, display_name: 'Unix', source_id: 'unix', psms: [sharedPsm] };
  const windows = { object_id: 31, display_name: 'Windows', source_id: 'windows', psms: [sharedPsm] };
  const chain = {
    roles: [{
      object_id: 10,
      display_name: 'Operations',
      source_id: 'operations',
      safe_count: 2,
      safes: [
        { object_id: 20, display_name: 'Finance', safe_number: 'FIN', account_count: 2, platform_count: 2, platforms: [unix, windows] },
        { object_id: 21, display_name: 'Treasury', safe_number: 'TRE', account_count: 1, platform_count: 1, platforms: [unix] },
      ],
    }],
  } as PamUserChain;

  const rows = chainPathRows(chain);
  const [group] = groupRowsByRole(rows);
  const routes = aggregateRoleRoutes(group.rows);

  assert.equal(rows.length, 3, 'the verified branch count stays intact');
  assert.deepEqual(routes.safes.map((safe) => safe.display_name), ['Finance', 'Treasury']);
  assert.deepEqual(routes.platforms.map(({ platform }) => platform.display_name), ['Unix', 'Windows']);
  assert.deepEqual(routes.platforms[0].safeNames, ['Finance', 'Treasury']);
  assert.deepEqual(routes.psms.map(({ psm }) => psm.display_name), ['PSM-01']);
  assert.deepEqual(routes.psms[0].platformNames, ['Unix', 'Windows']);
});
