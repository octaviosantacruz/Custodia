import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PAM_CHAIN_COLUMNS,
  PAM_IDENTITY_CHAIN_COLUMNS,
  buildPathQuery,
  clearColumn,
  columnIndexOf,
  columnSource,
  createPath,
  linkRelation,
  orderedPath,
  parsePathQuery,
  pathRange,
  selectInColumn,
  splitColumnHops,
  type ChainPath,
} from '../../src/cross/lib/chain-columns.ts';
import type { ChainHop, ChainNode, ChainRelation } from '../../src/cross/lib/chains-api.ts';

const C = PAM_CHAIN_COLUMNS;
const I = PAM_IDENTITY_CHAIN_COLUMNS;
const verified = (basis: string): ChainRelation => ({ kind: 'persisted', basis });

function node(type: ChainNode['type'], id: number, label = `${type}-${id}`): ChainNode {
  return { type, id, label, sublabel: String(id), counts: { forward: 1, back: 1 } };
}

function hop(type: ChainNode['type'], id: number, basis: string, kind: ChainRelation['kind'] = 'persisted'): ChainHop {
  return { ...node(type, id), relation: { kind, basis } };
}

function rootAt(type: ChainNode['type'], id: number): ChainPath {
  const path = createPath(C, node(type, id));
  assert.ok(path);
  return path;
}

test('every PAM node type lands in its canonical column; SIA stays lateral', () => {
  assert.deepEqual(
    ['user', 'role', 'safe', 'platform', 'psm', 'access_asset'].map((type) => columnIndexOf(C, type as ChainNode['type'])),
    [0, 1, 2, 3, 4, 4],
  );
  assert.equal(columnIndexOf(C, 'access_policy'), -1);
  assert.equal(createPath(C, node('access_policy', 1)), null);
});

test('a root in the middle feeds both neighbouring columns at once', () => {
  const path = rootAt('safe', 9);
  assert.deepEqual(columnSource(path, 1), { node: path.cells[2].node, direction: 'back' });
  assert.deepEqual(columnSource(path, 3), { node: path.cells[2].node, direction: 'forward' });
  assert.equal(columnSource(path, 0), null);
  assert.equal(columnSource(path, 4), null);
  assert.equal(columnSource(path, 2), null);
});

test('selecting extends the path outward and replacing a cell drops what hung on it', () => {
  let path = rootAt('user', 8);
  path = selectInColumn(path, 1, hop('role', 7, 'user_has_role'));
  path = selectInColumn(path, 2, hop('safe', 9, 'role_grants_access'));
  path = selectInColumn(path, 3, hop('platform', 4, 'safe_uses_platform'));
  assert.deepEqual(pathRange(path), { lo: 0, hi: 3 });
  assert.deepEqual(orderedPath(path).map((cell) => cell.node.label), ['user-8', 'role-7', 'safe-9', 'platform-4']);
  assert.deepEqual(path.cells[2].relation, verified('role_grants_access'));

  const swapped = selectInColumn(path, 2, hop('safe', 10, 'role_grants_access'));
  assert.deepEqual(pathRange(swapped), { lo: 0, hi: 2 });
  assert.equal(swapped.cells[2].node.id, 10);
  assert.equal(swapped.cells[3], undefined);
});

test('columns out of reach and the root cannot be selected into', () => {
  const path = rootAt('user', 8);
  assert.equal(selectInColumn(path, 3, hop('platform', 4, 'safe_uses_platform')), path);
  assert.equal(selectInColumn(path, 0, hop('user', 1, 'user_has_role')), path);
});

test('walking back from a PSM fills columns to the left', () => {
  let path = rootAt('psm', 5);
  path = selectInColumn(path, 3, hop('platform', 4, 'platform_uses_psm'));
  path = selectInColumn(path, 2, hop('safe', 9, 'safe_uses_platform'));
  assert.deepEqual(pathRange(path), { lo: 2, hi: 4 });
  assert.deepEqual(columnSource(path, 1), { node: path.cells[2].node, direction: 'back' });
  assert.deepEqual(linkRelation(path, 3), verified('platform_uses_psm'));
  assert.deepEqual(linkRelation(path, 2), verified('safe_uses_platform'));
  assert.equal(linkRelation(path, 1), null);
});

test('clearing a column trims outward only and never removes the root', () => {
  let path = rootAt('safe', 9);
  path = selectInColumn(path, 1, hop('role', 7, 'role_grants_access'));
  path = selectInColumn(path, 0, hop('user', 8, 'user_has_role'));
  path = selectInColumn(path, 3, hop('platform', 4, 'safe_uses_platform'));
  const cleared = clearColumn(path, 1);
  assert.deepEqual(pathRange(cleared), { lo: 2, hi: 3 });
  assert.equal(clearColumn(path, 2), path);
});

test('lateral hops (SIA references) are split from the column', () => {
  const split = splitColumnHops(C, 1, [hop('role', 7, 'user_has_role'), hop('access_policy', 3, 'display_name_reference_only', 'reference')]);
  assert.deepEqual(split.inColumn.map((item) => item.type), ['role']);
  assert.deepEqual(split.lateral.map((item) => item.type), ['access_policy']);
});

test('the shared link round-trips and stays compatible with explorer links', () => {
  let path = rootAt('role', 7);
  path = selectInColumn(path, 0, hop('user', 8, 'user_has_role'));
  path = selectInColumn(path, 2, hop('safe', 9, 'role_grants_access'));
  const query = buildPathQuery(path);
  assert.equal(new URLSearchParams(query).get('trail'), 'user:8>role:7>safe:9');
  const parsed = parsePathQuery(C, `?${query}`);
  assert.deepEqual(parsed?.root, { type: 'role', id: 7 });
  assert.deepEqual(Object.keys(parsed?.targets ?? {}).map(Number), [0, 1, 2]);

  // Previous explorer format: walk order and `dir` no longer matter.
  const legacy = parsePathQuery(C, '?type=psm&id=5&dir=back&trail=psm%3A5%3Eplatform%3A4');
  assert.deepEqual(legacy?.targets, { 3: { type: 'platform', id: 4 }, 4: { type: 'psm', id: 5 } });
});

test('broken links degrade to the root instead of inventing a chain', () => {
  const root = { 2: { type: 'safe', id: 9 } };
  assert.deepEqual(parsePathQuery(C, '?type=safe&id=9&trail=user:8>safe:9')?.targets, root);
  assert.deepEqual(parsePathQuery(C, '?type=safe&id=9&trail=role:7>role:6>safe:9')?.targets, root);
  assert.deepEqual(parsePathQuery(C, '?type=safe&id=9&trail=role:7>platform:4')?.targets, root);
  assert.equal(parsePathQuery(C, '?type=access_policy&id=3'), null);
  assert.equal(parsePathQuery(C, '?type=safe&id=-1'), null);
  assert.equal(parsePathQuery(C, ''), null);
});

test('the first column is the person only with Identity access, with the same node type', () => {
  assert.deepEqual(C.map(({ key }) => key), ['user', 'role', 'safe', 'platform', 'target']);
  assert.deepEqual(I.map(({ key }) => key), C.map(({ key }) => key));
  assert.deepEqual([C[0].label, I[0].label], ['Usuario PAM', 'Identidad']);
  assert.deepEqual(I.slice(1), C.slice(1));
  // Identity and PAM are one node: no separate Identity node type is addressable.
  assert.equal(columnIndexOf(I, 'identity_user' as ChainNode['type']), -1);
  assert.equal(parsePathQuery(I, '?type=identity_user&id=31'), null);
});

test('the person column reaches roles and the rest of the chain as a PAM user', () => {
  let path = createPath(I, node('user', 8));
  assert.ok(path);
  assert.deepEqual(columnSource(path, 1), { node: path.cells[0].node, direction: 'forward' });
  path = selectInColumn(path, 1, hop('role', 7, 'user_has_role'));
  path = selectInColumn(path, 2, hop('safe', 9, 'role_grants_access'));
  const parsed = parsePathQuery(I, `?${buildPathQuery(path)}`);
  assert.deepEqual(parsed?.root, { type: 'user', id: 8 });
  assert.deepEqual(parsed?.targets, {
    0: { type: 'user', id: 8 }, 1: { type: 'role', id: 7 }, 2: { type: 'safe', id: 9 },
  });
});
