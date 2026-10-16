import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRoleMatchIndex } from '../../../src/cyberark/identity_administration/lib/identity-role-matches.ts';
import type { IdentityRoleMatches } from '../../../src/cyberark/identity_administration/types/identity.ts';

const ref = (id: string, object_id: number | null, traversal?: Array<{ id: string; object_id: number | null; name: string }>) => ({ id, object_id, name: id.toUpperCase(), traversal });

const matches: IdentityRoleMatches = {
  same_direct_members: [{ roles: [ref('a', 1), ref('b', 2), ref('c', null)], direct_members: 4 }],
  same_user_references: [{ roles: [ref('a', 1, [ref('a', 1), ref('leaf', 9)]), ref('d', 5)], referenced_accounts: 7 }],
  roles_with_incomplete_user_paths: [], permissions_status: 'not_collected', scope: '',
  source: { source_system: 'identity_administration', last_run_status: 'completed', last_run_finished_at: null },
  complete: true, roles_analyzed: 4, roles_excluded: 0,
};

test('indexes every matched role by source id with the other members of its group', () => {
  const index = buildRoleMatchIndex(matches);
  const a = index.bySourceId.get('a')!;
  assert.deepEqual(a.sameMembers.map((r) => r.id), ['b', 'c']);
  assert.deepEqual(a.sameAccounts.map((r) => r.id), ['d']);
  assert.deepEqual(a.reaches.map((r) => r.id), ['leaf']);
  assert.equal(a.directMembers, 4);
  assert.equal(a.referencedAccounts, 7);
  assert.deepEqual(index.bySourceId.get('d')!.sameMembers, []);
  assert.equal(index.bySourceId.has('zzz'), false);
});

test('exposes sorted object ids (unresolved ones skipped) and group counts for the filter', () => {
  const index = buildRoleMatchIndex(matches);
  assert.deepEqual(index.objectIds, [1, 2, 5]);
  assert.equal(index.directGroups, 1);
  assert.equal(index.accountGroups, 1);
});
