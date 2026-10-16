import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chainInventoryView,
  diffChainHops,
} from '../../src/cross/lib/chain-trail.ts';
import type { ChainHop, ChainNode } from '../../src/cross/lib/chains-api.ts';

function node(type: ChainNode['type'], id: number, label: string): ChainNode {
  return { type, id, label, sublabel: String(id), counts: { forward: 1, back: 0 } };
}

function hop(type: ChainHop['type'], id: number, label: string): ChainHop {
  return { ...node(type, id, label), relation: { kind: 'persisted', basis: 'user_has_role' } };
}

test('chain inventory views map every pivot type except identity-less assets', () => {
  assert.equal(chainInventoryView('safe'), 'safes');
  assert.equal(chainInventoryView('role'), 'roles');
  assert.equal(chainInventoryView('platform'), 'platforms');
  assert.equal(chainInventoryView('psm'), 'connectors');
  assert.equal(chainInventoryView('user'), 'identityUsers');
  assert.equal(chainInventoryView('access_asset'), 'assets');
});

test('diff groups hops into only A, only B and both', () => {
  const a = [hop('safe', 1, 'Finance'), hop('safe', 2, 'Treasury')];
  const b = [hop('safe', 2, 'Treasury'), hop('safe', 3, 'Audit')];
  const diff = diffChainHops(a, b);
  assert.deepEqual(diff.onlyA.map((item) => item.id), [1]);
  assert.deepEqual(diff.onlyB.map((item) => item.id), [3]);
  assert.deepEqual(diff.both.map((item) => item.id), [2]);
});
