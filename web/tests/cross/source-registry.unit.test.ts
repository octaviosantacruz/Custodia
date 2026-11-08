import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_ENTRIES } from '../../src/cross/lib/workspace-catalog.ts';
import { domains, domainMeta } from '../../src/cross/lib/domains.ts';
import {
  FRONTEND_SOURCES, REGISTERED_DOMAINS, REGISTERED_RUNTIMES, REGISTERED_WORKSPACES, SYNC_BY_SOURCE, manualSyncForArea, runtimeForWorkspace,
} from '../../src/sources.ts';

test('registered domains keep the editorial order and product labels', () => {
  assert.deepEqual(domains.map((domain) => domain.id), ['cross', 'admin', 'pam', 'dlp', 'dspm']);
  assert.equal(REGISTERED_DOMAINS.length, 5);
  assert.equal(domainMeta('pam').product.label, 'CyberArk');
  assert.equal(domainMeta('dlp').product.label, 'Netskope');
});

test('registrations, workspaces and runtimes have unique ids and every workspace resolves a runtime', () => {
  const unique = (values: string[]) => assert.equal(new Set(values).size, values.length);
  unique(FRONTEND_SOURCES.map((source) => source.id));
  unique(REGISTERED_WORKSPACES.map((workspace) => workspace.id));
  unique(REGISTERED_RUNTIMES.map((runtime) => runtime.id));
  assert.equal(CATALOG_ENTRIES.length, REGISTERED_WORKSPACES.length);
  for (const workspace of REGISTERED_WORKSPACES) assert.ok(runtimeForWorkspace(workspace.id), workspace.id);
});

test('sync registrations stay isolated by source and manual sync is scoped per area', () => {
  for (const source of ['cyberark', 'identity_administration', 'sia', 'access', 'netskope']) assert.ok(SYNC_BY_SOURCE[source], source);
  const netskope = manualSyncForArea('dlp');
  assert.equal(netskope.kind, 'direct');
  if (netskope.kind === 'direct') assert.equal(netskope.source, 'netskope');
  const pam = manualSyncForArea('pam');
  assert.equal(pam.kind === 'batch' && pam.scope, 'cyberark');
  const fallback = manualSyncForArea('dspm');
  assert.equal(fallback.kind === 'batch' && fallback.scope, 'all');
});
