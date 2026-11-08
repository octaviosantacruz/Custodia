import assert from 'node:assert/strict';
import test from 'node:test';
import { EMPTY_IDENTITY_USERS_CRITERIA, identityUsersCriteriaFromSearch, identityUsersQueryString } from '../../../src/cyberark/identity_administration/lib/identity-users-url.ts';

test('criteria round-trip through the query string', () => {
  const criteria = { search: 'ada', active: 'inactive' as const, standardSeat: 'unreconciled' as const };
  assert.equal(identityUsersQueryString(criteria), 'q=ada&active=inactive&seat=unreconciled');
  assert.deepEqual(identityUsersCriteriaFromSearch('?q=ada&active=inactive&seat=unreconciled'), criteria);
});

test('only allowlisted values are read back and an empty URL means no criteria', () => {
  assert.equal(identityUsersCriteriaFromSearch(''), null);
  assert.equal(identityUsersCriteriaFromSearch('?active=maybe&seat=other&utm=1'), null);
  assert.deepEqual(identityUsersCriteriaFromSearch('?q=x&active=maybe'), { search: 'x', active: '', standardSeat: '' });
  assert.equal(identityUsersQueryString(EMPTY_IDENTITY_USERS_CRITERIA), '');
});
