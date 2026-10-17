import { manualSyncForArea, runtimeForWorkspace, REGISTERED_CATEGORIES } from '../../src/sources.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_BY_ID, CATALOG_ENTRIES, type WorkspaceCatalogEntry, type WorkspaceView } from '../../src/cross/lib/workspace-catalog.ts';
import { hasWorkspaceAccess, workspaceFromPath, workspacePath } from '../../src/cross/lib/workspaces.ts';
import { WORKSPACE_DESCRIPTIONS } from '../../src/cross/lib/workspace-registry.ts';
import { areaOf, domainOf, domainWorkspaces, domains } from '../../src/cross/lib/domains.ts';

const ENTRIES: readonly WorkspaceCatalogEntry[] = CATALOG_ENTRIES;

test('every catalog entry is fully registered across the navigation maps', () => {
  const domainIds = new Set(domains.map((domain) => domain.id));
  const ids = ENTRIES.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, 'catalog ids must be unique');
  for (const entry of ENTRIES) {
    const view = entry.id as WorkspaceView;
    assert.ok(entry.label && entry.detail && entry.description, entry.id);
    assert.ok(domainIds.has(entry.domain), `${entry.id} domain`);
    assert.equal(workspacePath(view), entry.path);
    assert.notEqual(workspaceFromPath(entry.path), null, entry.id);
    assert.equal(areaOf(view), entry.domain);
    assert.equal(WORKSPACE_DESCRIPTIONS[view], entry.description);
    assert.equal(hasWorkspaceAccess(view, []), entry.gate === 'open');
    if (entry.alternatePermission) assert.ok(entry.gate === 'manage' || entry.gate === 'strict', entry.id);
  }
});

test('catalog switcher flags match domain navigation', () => {
  for (const entry of ENTRIES) {
    const view = entry.id as WorkspaceView;
    assert.equal(domainWorkspaces(entry.domain).includes(view), entry.switcher, entry.id);
  }
});

/* UX-IA-001: Personas is transversal to neutral Custodia, but the App
   shell still routes it through the PAM lazy router (App.tsx gates routers
   with `domainOf`). `areaOf` is what navigation/grouping/branding must use;
   `domainOf` only carries the temporary render host in one documented place. */
test('Conexiones groups Personas under its own neutral tool while keeping its PAM render host', () => {
  assert.equal(CATALOG_BY_ID.person.domain, 'cross');
  assert.equal(areaOf('person'), 'cross');
  assert.equal(domainOf('person'), 'pam');
  assert.equal(runtimeForWorkspace('person').id, 'cyberark');
  assert.equal(runtimeForWorkspace('assets').id, 'cyberark');
  const sync = manualSyncForArea(areaOf('person'));
  assert.equal(sync.kind, 'batch');
  if (sync.kind === 'batch') assert.equal(sync.scope, 'all');
  assert.equal(domains.find((domain) => domain.id === 'cross')?.label, 'Conexiones');
  assert.equal(domains.find((domain) => domain.id === 'admin')?.label, 'Administración');
  assert.match(domains.find((domain) => domain.id === 'admin')!.blurb, /Usuarios, permisos y actividad/);
  assert.doesNotMatch(domains.find((domain) => domain.id === 'admin')!.blurb, /riesgo/i);
  assert.equal(CATALOG_BY_ID.person.path, '/chains/person');
  assert.equal(CATALOG_BY_ID.person.gate, 'manage');
  assert.deepEqual(CATALOG_BY_ID.person.alternatePermissions, ['pam:catalogs_read', 'identity:catalogs_read', 'netskope:read']);
  assert.equal(CATALOG_BY_ID.assets.id, 'assets');
  assert.equal(CATALOG_BY_ID.assets.path, '/pam/assets');
  assert.deepEqual(CATALOG_BY_ID.assets.legacyPaths, ['/pam/ip-inventory', '/pam/access-assets']);
  assert.equal(CATALOG_BY_ID.assets.label, 'Cobertura');
  assert.equal(workspaceFromPath('/pam/ip-inventory'), 'assets');
  assert.equal(workspaceFromPath('/pam/assets'), 'assets');
});

/* UX-AUD-010: a `catalog:true` entry is an advertised destination, so every
   one must belong to a browse category; a view the app only accepts as a
   retired URL (no tab, no renderer) must not advertise itself. */
test('catalog destinations have a UI path and retired views stay unadvertised', () => {
  const categories = new Set(REGISTERED_CATEGORIES.map((category) => category.id));
  for (const entry of ENTRIES.filter((item) => item.catalog)) {
    assert.ok(entry.category && categories.has(entry.category.id), `${entry.id} must belong to a browse category`);
  }
  for (const view of ['identityFederations'] as const) {
    assert.equal(CATALOG_BY_ID[view].catalog, false, `${view} must not be advertised`);
    assert.equal(workspaceFromPath(CATALOG_BY_ID[view].path), view, `${view} must keep its path for the retired-URL redirect`);
  }
});

/* UX-AUD-013(c): the canonical path for a secondary hub tab is the hub's
   subnav, so it must not also be a top-level switcher destination. The list
   is the secondary tabs of every hub (PAM infra, Identidades, SIA, Netskope
   inventory); hub roots (Safes/Identidades/SIA/Inventario) stay switcher
   entries. */
test('secondary hub tabs are not switcher destinations', () => {
  const hubTabs: readonly WorkspaceView[] = [
    'platforms', 'connectors',
    'identityUsers', 'identityGroups', 'roles',
    'siaResources', 'siaDatabaseAccounts',
    'netskopeDevices', 'netskopeUsers',
  ];
  for (const view of hubTabs) {
    assert.equal(CATALOG_BY_ID[view].switcher, false, `${view} is a hub tab and must not be a switcher destination`);
    assert.equal(workspaceFromPath(CATALOG_BY_ID[view].path), view, `${view} must keep resolving its path`);
  }
  // The technical catalogs keep catalog:true so their deep links stay valid
  // and categorized; the Netskope device/user subviews are not catalogued.
  for (const view of ['platforms', 'pamHealth', 'identityUsers', 'identityRoles', 'siaResources', 'siaDatabaseAccounts'] as const) {
    assert.equal(CATALOG_BY_ID[view].catalog, true, `${view} stays catalog:true`);
  }
  for (const view of ['identityGroups', 'roles', 'connectors'] as const) {
    assert.equal(CATALOG_BY_ID[view].catalog, false, `${view} is a compatibility URL, not another destination`);
  }
});

test('PAM cleanup is a Postura tab (not a menu entry) gated by the narrow PAM read permission', () => {
  const entry = CATALOG_BY_ID.pamCleanup;
  assert.equal(entry.path, '/pam/cleanup');
  assert.equal(entry.domain, 'pam');
  assert.equal(entry.catalog, false);
  assert.equal(entry.switcher, false);
  assert.equal(entry.gate, 'manage');
  assert.equal(entry.alternatePermission, 'pam:catalogs_read');
  assert.equal(runtimeForWorkspace('pamCleanup').id, 'cyberark');
});
