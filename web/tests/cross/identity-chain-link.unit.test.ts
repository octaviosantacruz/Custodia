import assert from 'node:assert/strict';
import test from 'node:test';

import { PAM_IDENTITY_CHAIN_COLUMNS, parsePathQuery } from '../../src/cross/lib/chain-columns.ts';
import { withPerson } from '../../src/cross/lib/chain-person.ts';
import { identityChainLink } from '../../src/cross/lib/identity-chain-link.ts';

test('the Identity link opens Relaciones at the PAM account of the person', () => {
  assert.deepEqual(identityChainLink(8), { view: 'graph', path: '/pam/graph?type=user&id=8&dir=forward' });
  assert.deepEqual(parsePathQuery(PAM_IDENTITY_CHAIN_COLUMNS, identityChainLink(8).path.split('?')[1]), {
    root: { type: 'user', id: 8 },
    targets: { 0: { type: 'user', id: 8 } },
  });
});

test('a linked PAM user is shown as the person, keeping the account ids inside', () => {
  const linked = withPerson({
    type: 'user', id: 8, label: 'ada.lovelace', sublabel: 'ada@example.com',
    identity: { object_id: 31, display_name: 'Ada Lovelace', email: 'ada@example.com', basis: 'email_exact' as const },
  });
  assert.equal(linked.id, 8);
  assert.equal(linked.label, 'Ada Lovelace');
  assert.equal(linked.sublabel, 'ada@example.com');
  assert.deepEqual(linked.account, { label: 'ada.lovelace', sublabel: 'ada@example.com' });
});

test('unlinked users and other node types are left untouched', () => {
  const plain = { type: 'user', id: 9, label: 'bob', sublabel: 'b-9', identity: null };
  assert.equal(withPerson(plain), plain);
  const safe = { type: 'safe', id: 3, label: 'Finance', sublabel: 'FIN' };
  assert.equal(withPerson(safe), safe);
});
