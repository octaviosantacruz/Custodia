import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalWorkspaceList, canonicalRecentWorkspace, hasWorkspaceAccess, workspaceFromPath, workspacePath } from '../../src/cross/lib/workspaces.ts';
import { CATALOG_BY_ID } from '../../src/cross/lib/workspace-catalog.ts';
import { areaOf, domainAccessible, domainMeta, domainOf, domainWorkspaces, firstAccessibleDomainWorkspace } from '../../src/cross/lib/domains.ts';
import { WORKSPACE_DESCRIPTIONS } from '../../src/cross/lib/workspace-registry.ts';

test('tool navigation keeps PAM analysis separate from platform administration', () => {
  assert.deepEqual(domainWorkspaces('cross'), ['person', 'help']);
  assert.deepEqual(domainWorkspaces('admin'), ['users', 'activity']);
  assert.equal(domainOf('posture'), 'pam');
  assert.equal(domainOf('graph'), 'pam');
  assert.equal(workspacePath('platforms'), '/pam/platforms');
  assert.equal(workspacePath('pamCleanup'), '/pam/cleanup');
  assert.equal(workspaceFromPath('/pam/cleanup'), 'pamCleanup');
  assert.equal(workspaceFromPath('/pam/connectors'), 'connectors');
  assert.equal(workspaceFromPath('/pam/sia/connectors'), 'connectors');
  assert.ok(!domainWorkspaces('pam').includes('identityGroups'));
  assert.ok(domainWorkspaces('pam').includes('identity'));
  // UX-AUD-013(c): Plataformas/Conectores/Salud PAM are Safes hub tabs, not
  // switcher destinations (the canonical path is the subnav).
  assert.ok(domainWorkspaces('pam').includes('pamHealth'), 'Servicio is the menu entry for Salud and Conectores');
  assert.ok(!domainWorkspaces('pam').includes('platforms'));
  assert.ok(!domainWorkspaces('pam').includes('connectors'));
  assert.ok(!domainWorkspaces('pam').includes('siaConnectors'));
  // IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §3.2 (Fase 2): Recursos
  // sub-views stay valid WorkspaceViews (deep links keep working) but are
  // not separate switcher destinations -- SIA is the single one. The
  // migrated-connection Inventario is its own destination (2026-10-10).
  assert.ok(!domainWorkspaces('pam').includes('siaResources'));
  assert.ok(!domainWorkspaces('pam').includes('siaDatabaseAccounts'));
  assert.ok(domainWorkspaces('pam').includes('assets'));
  assert.ok(domainWorkspaces('pam').includes('sia'));
  // IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §3.1: Usuarios/Grupos/
  // Roles/Federaciones stay valid WorkspaceViews (deep links keep
  // working, see workspaceFromPath below) but are no longer separate
  // switcher/quick-access destinations -- Identidades is the single one.
  assert.ok(!domainWorkspaces('pam').includes('identityUsers'));
  assert.ok(!domainWorkspaces('pam').includes('identityRoles'));
  assert.ok(!domainWorkspaces('pam').includes('identityFederations'));
  assert.ok(!domainWorkspaces('pam').includes('roles'));
  assert.equal(workspacePath('siaDatabaseAccounts'), '/pam/sia/database-accounts');
  // Target sets and Access assets are no longer views; their old links land on a supported one.
  assert.equal(workspaceFromPath('/pam/sia/target-sets'), 'siaResources');
  assert.equal(workspaceFromPath('/pam/access-assets'), 'assets');
  assert.equal(workspaceFromPath('/netskope/steering'), 'netskopeOperations');
  assert.equal(workspaceFromPath('/netskope/policies'), 'netskopePosture');
  assert.equal(workspaceFromPath('/pam/identity/federations'), 'identityFederations');
  assert.equal(workspacePath('assets'), '/pam/assets');
  assert.equal(workspaceFromPath('/pam/ip-inventory'), 'assets');
});

test('CyberArk groups PAM, Identity and SIA while Netskope remains independent', () => {
  const cyberArk = domainWorkspaces('pam');
  for (const view of ['general', 'identity', 'sia'] as const) assert.ok(cyberArk.includes(view));
  assert.deepEqual(domainWorkspaces('dlp'), ['netskope', 'netskopePosture', 'netskopeOperations', 'netskopeInventory', 'netskopeDemSites', 'netskopeAdmins']);
  assert.equal(WORKSPACE_DESCRIPTIONS.identity.includes('Identity Administration'), true);
  assert.match(WORKSPACE_DESCRIPTIONS.sia, /\bSIA\b/);
});

test('hasWorkspaceAccess lets an ungated workspace through regardless of permissions', () => {
  assert.equal(hasWorkspaceAccess('safes', []), true);
  assert.equal(hasWorkspaceAccess('general', []), true);
});

test('hasWorkspaceAccess accepts only the declared narrow platform administration permissions', () => {
  assert.equal(hasWorkspaceAccess('users', []), false);
  assert.equal(hasWorkspaceAccess('users', ['pam:catalogs_read']), false);
  assert.equal(hasWorkspaceAccess('users', ['access:manage']), true);
  assert.equal(hasWorkspaceAccess('users', ['access:directory_read']), true);
  assert.equal(hasWorkspaceAccess('users', ['access:roles_read']), true);
  assert.equal(hasWorkspaceAccess('activity', ['pam:catalogs_read']), false);
  assert.equal(hasWorkspaceAccess('activity', ['inventory:read']), false);
  assert.equal(hasWorkspaceAccess('activity', ['audit:read']), true);
  assert.equal(hasWorkspaceAccess('netskope', ['inventory:read']), false);
});

test('hasWorkspaceAccess accepts the narrow pam:catalogs_read permission for PAM technical catalogs', () => {
  for (const view of ['platforms', 'connectors', 'pamHealth', 'pamCleanup', 'graph'] as const) {
    assert.equal(hasWorkspaceAccess(view, []), false, `${view} should still be gated`);
    assert.equal(hasWorkspaceAccess(view, ['pam:catalogs_read']), true, `${view} should accept the narrow permission`);
    assert.equal(hasWorkspaceAccess(view, ['access:manage']), true, `${view} must keep accepting access:manage`);
  }
});

test('hasWorkspaceAccess accepts the narrow sia:catalogs_read permission for SIA catalogs', () => {
  for (const view of ['siaConnectors', 'siaResources', 'siaDatabaseAccounts'] as const) {
    assert.equal(hasWorkspaceAccess(view, []), false);
    assert.equal(hasWorkspaceAccess(view, ['sia:catalogs_read']), true);
    assert.equal(hasWorkspaceAccess(view, ['pam:catalogs_read']), false);
  }
});

test('hasWorkspaceAccess accepts the narrow identity:catalogs_read permission for identity federations', () => {
  assert.equal(hasWorkspaceAccess('identityFederations', []), false);
  assert.equal(hasWorkspaceAccess('identityFederations', ['identity:catalogs_read']), true);
  assert.equal(hasWorkspaceAccess('identityFederations', ['sia:catalogs_read']), false);
});

test('Identity roles have a distinct path from PAM roles', () => {
  assert.ok(CATALOG_BY_ID.identityRoles.catalog);
  assert.equal(workspacePath('identityRoles'), '/pam/identity/roles');
  assert.equal(workspaceFromPath('/pam/identity/roles'), 'identityRoles');
  assert.equal(hasWorkspaceAccess('identityRoles', []), true);
});

test('canonicalRecentWorkspace maps every Identity subview to the single identity destination', () => {
  assert.equal(canonicalRecentWorkspace('identityUsers'), 'identity');
  assert.equal(canonicalRecentWorkspace('identityGroups'), 'identity');
  assert.equal(canonicalRecentWorkspace('identityRoles'), 'identity');
  assert.equal(canonicalRecentWorkspace('identityFederations'), 'identity');
  assert.equal(canonicalRecentWorkspace('roles'), 'identity');
  assert.equal(canonicalRecentWorkspace('identity'), 'identity');
});

test('canonicalWorkspaceList migrates nested saved shortcuts without duplicates', () => {
  assert.deepEqual(canonicalWorkspaceList(['safes', 'roles', 'identityRoles', 'identity', 'assets', 'sia']), ['safes', 'identity', 'assets', 'sia']);
});

test('canonicalRecentWorkspace maps every SIA subview to the single sia destination', () => {
  assert.equal(canonicalRecentWorkspace('siaResources'), 'sia');
  assert.equal(canonicalRecentWorkspace('siaDatabaseAccounts'), 'sia');
  assert.equal(canonicalRecentWorkspace('assets'), 'assets');
  assert.equal(canonicalRecentWorkspace('sia'), 'sia');
});

test('canonicalRecentWorkspace leaves unrelated workspaces untouched', () => {
  assert.equal(canonicalRecentWorkspace('safes'), 'safes');
  assert.equal(canonicalRecentWorkspace('platforms'), 'platforms');
});

test('Netskope DLP is a navigable, non-planned domain gated by access:manage or netskope:read', () => {
  assert.equal(CATALOG_BY_ID.netskope.catalog, true);
  assert.equal(CATALOG_BY_ID.netskopeOperations.catalog, true);
  assert.equal(CATALOG_BY_ID.netskopeChains.catalog, false);
  assert.equal(CATALOG_BY_ID.netskopeInventory.catalog, true);
  // Investigación was retired; users/devices remain filtered deep links into
  // the single Inventario destination.
  assert.equal(CATALOG_BY_ID.netskopeUsers.catalog, false);
  assert.equal(CATALOG_BY_ID.netskopeDevices.catalog, false);
  assert.equal(workspacePath('netskope'), '/netskope');
  assert.equal(workspacePath('netskopeOperations'), '/netskope/operations');
  assert.equal(workspacePath('netskopeChains'), '/netskope/chains');
  assert.equal(workspacePath('netskopeInventory'), '/netskope/inventory');
  assert.equal(workspacePath('netskopeUsers'), '/netskope/users');
  assert.equal(workspacePath('netskopeDevices'), '/netskope/devices');
  assert.equal(workspaceFromPath('/netskope'), 'netskope');
  assert.equal(workspaceFromPath('/netskope/operations'), 'netskopeOperations');
  assert.equal(workspaceFromPath('/netskope/inventory'), 'netskopeInventory');
  assert.equal(workspaceFromPath('/netskope/users'), 'netskopeUsers');
  assert.equal(workspaceFromPath('/netskope/devices'), 'netskopeDevices');
  // The retired /netskope/alerts deep link redirects to the Resumen view
  // (canonicalized by useWorkspaceRoute), never to Investigación.
  assert.equal(workspaceFromPath('/netskope/alerts'), 'netskope');
  assert.deepEqual(domainWorkspaces('dlp'), ['netskope', 'netskopePosture', 'netskopeOperations', 'netskopeInventory', 'netskopeDemSites', 'netskopeAdmins']);
  assert.equal(domainOf('netskope'), 'dlp');
  assert.equal(domainOf('netskopeOperations'), 'dlp');
  assert.equal(domainOf('netskopeInventory'), 'dlp');
  assert.equal(domainOf('netskopeUsers'), 'dlp');
  assert.equal(domainOf('netskopeDevices'), 'dlp');
  assert.equal(domainMeta('dlp').status, 'active');
  for (const view of ['netskope', 'netskopeOperations', 'netskopeInventory', 'netskopeUsers', 'netskopeDevices'] as const) {
    assert.equal(hasWorkspaceAccess(view, []), false);
    assert.equal(hasWorkspaceAccess(view, ['access:manage']), true);
    assert.equal(hasWorkspaceAccess(view, ['netskope:read']), true);
    assert.equal(hasWorkspaceAccess(view, ['inventory:read']), false);
  }
});

test('NSK-DLP-001 Alertas DLP is a strict workspace: only netskope:dlp_read unlocks it', () => {
  // Paused (NSK-POLICY-004): out of the menu, still a strict workspace reachable by URL.
  assert.equal(CATALOG_BY_ID.netskopeDlp.catalog, false);
  assert.equal(workspacePath('netskopeDlp'), '/netskope/dlp');
  assert.equal(workspaceFromPath('/netskope/dlp'), 'netskopeDlp');
  assert.equal(domainOf('netskopeDlp'), 'dlp');
  assert.equal(hasWorkspaceAccess('netskopeDlp', []), false);
  assert.equal(hasWorkspaceAccess('netskopeDlp', ['netskope:dlp_read']), true);
  // Segregation: neither access:manage nor the base Netskope read widens it.
  assert.equal(hasWorkspaceAccess('netskopeDlp', ['access:manage']), false);
  assert.equal(hasWorkspaceAccess('netskopeDlp', ['netskope:read']), false);
  assert.equal(hasWorkspaceAccess('netskopeDlp', ['netskope:read', 'netskope:dlp_read']), true);
});

test('NSK-UBA-002 Confianza de usuarios is strict: only netskope:uba_read unlocks it', () => {
  assert.equal(workspacePath('netskopeUci'), '/netskope/uci');
  assert.equal(workspaceFromPath('/netskope/uci'), 'netskopeUci');
  assert.equal(domainOf('netskopeUci'), 'dlp');
  assert.equal(hasWorkspaceAccess('netskopeUci', []), false);
  assert.equal(hasWorkspaceAccess('netskopeUci', ['netskope:uba_read']), true);
  // Segregation: neither access:manage, netskope:read nor dlp_read widens it.
  assert.equal(hasWorkspaceAccess('netskopeUci', ['access:manage']), false);
  assert.equal(hasWorkspaceAccess('netskopeUci', ['netskope:read']), false);
  assert.equal(hasWorkspaceAccess('netskopeUci', ['netskope:dlp_read']), false);
  assert.equal(domainAccessible('dlp', ['netskope:uba_read']), true);
});

test('NSK-RBAC-001 Administradores is strict: only netskope:admin_inventory_read unlocks it', () => {
  assert.equal(workspacePath('netskopeAdmins'), '/netskope/admins');
  assert.equal(workspaceFromPath('/netskope/admins'), 'netskopeAdmins');
  assert.equal(domainOf('netskopeAdmins'), 'dlp');
  assert.equal(hasWorkspaceAccess('netskopeAdmins', []), false);
  assert.equal(hasWorkspaceAccess('netskopeAdmins', ['netskope:admin_inventory_read']), true);
  // Privileged-account data: neither access:manage, netskope:read nor the other strict reads widen it.
  for (const permission of ['access:manage', 'netskope:read', 'netskope:dlp_read', 'netskope:uba_read']) {
    assert.equal(hasWorkspaceAccess('netskopeAdmins', [permission]), false, permission);
  }
  assert.equal(domainAccessible('dlp', ['netskope:admin_inventory_read']), true);
});

test('canonicalRecentWorkspace maps Netskope inventory deep links to Inventario', () => {
  assert.equal(canonicalRecentWorkspace('netskopeChains'), 'netskopeInventory');
  assert.equal(canonicalRecentWorkspace('netskopeDevices'), 'netskopeInventory');
  assert.equal(canonicalRecentWorkspace('netskopeUsers'), 'netskopeInventory');
  assert.equal(canonicalRecentWorkspace('netskopeInventory'), 'netskopeInventory');
});

test('Conexiones groups the person route while per-workspace gates stay unchanged', () => {
  assert.equal(workspacePath('person'), '/chains/person');
  assert.equal(workspaceFromPath('/chains/person'), 'person');
  // UX-IA-001: the navigation area is the neutral Conexiones tool, apart from
  // Administración; the App shell keeps the PAM render host until
  // UX-SEARCH-001 refactors its router gate.
  assert.equal(areaOf('person'), 'cross');
  assert.equal(domainOf('person'), 'pam');
  assert.equal(hasWorkspaceAccess('person', []), false);
  assert.equal(hasWorkspaceAccess('person', ['access:manage']), true);
  assert.equal(hasWorkspaceAccess('person', ['pam:catalogs_read']), true);
  assert.equal(hasWorkspaceAccess('person', ['identity:catalogs_read']), true);
  assert.equal(hasWorkspaceAccess('person', ['netskope:read']), true);
  assert.equal(hasWorkspaceAccess('person', ['sia:catalogs_read']), false);
  assert.equal(hasWorkspaceAccess('person', ['inventory:read']), false);
  assert.equal(hasWorkspaceAccess('users', ['netskope:read']), false);
  assert.equal(hasWorkspaceAccess('activity', ['identity:catalogs_read']), false);
});

test('retired client coverage bookmarks resolve to Personas without adding a menu destination', () => {
  assert.equal(workspaceFromPath('/connections/coverage'), 'person');
  assert.equal(workspacePath(workspaceFromPath('/connections/coverage')!), '/chains/person');
});

test('Conexiones and Administración are separate neutral tools with their own gates', () => {
  assert.equal(domainMeta('cross').label, 'Conexiones');
  assert.match(domainMeta('cross').blurb, /Alcance de cada persona en las herramientas/);
  assert.equal(domainMeta('admin').label, 'Administración');
  assert.match(domainMeta('admin').blurb, /Usuarios, permisos y actividad/);
  assert.doesNotMatch(domainMeta('admin').blurb, /riesgo/i);
  for (const permission of ['pam:catalogs_read', 'identity:catalogs_read', 'netskope:read'] as const) {
    assert.equal(hasWorkspaceAccess('person', [permission]), true, `${permission} opens Personas`);
    assert.equal(domainAccessible('cross', [permission]), true, `${permission} shows Conexiones`);
    assert.equal(firstAccessibleDomainWorkspace('cross', [permission]), 'person', `${permission} lands on Personas`);
    // Opening Personas must not reveal the administrative workspaces.
    assert.equal(hasWorkspaceAccess('users', [permission]), false);
    assert.equal(hasWorkspaceAccess('activity', [permission]), false);
  }
  // Ayuda keeps the neutral area open without granting Personas.
  assert.equal(domainAccessible('cross', []), true);
  assert.equal(domainAccessible('cross', ['access:manage']), true);
  assert.equal(hasWorkspaceAccess('person', []), false);
  assert.equal(firstAccessibleDomainWorkspace('cross', []), 'help');
  // Restricted administration remains hidden from readers without its grants.
  assert.equal(domainAccessible('admin', []), false);
  assert.equal(firstAccessibleDomainWorkspace('admin', []), null);
  assert.equal(firstAccessibleDomainWorkspace('admin', ['access:directory_read']), 'users');
  assert.equal(firstAccessibleDomainWorkspace('admin', ['audit:read']), 'activity');
  assert.equal(firstAccessibleDomainWorkspace('admin', ['access:manage']), 'users');
  assert.equal(hasWorkspaceAccess('help', []), true);
  assert.equal(workspacePath('help'), '/help');
  assert.equal(workspaceFromPath('/help'), 'help');
});

test('domainAccessible unlocks Netskope DLP for access:manage or domain:dlp grants', () => {
  assert.equal(domainAccessible('dlp', []), true);
  assert.equal(domainAccessible('dlp', ['domain:pam']), false);
  assert.equal(domainAccessible('dlp', ['domain:dlp']), true);
  assert.equal(domainAccessible('dlp', ['access:manage']), true);
  assert.equal(domainAccessible('dlp', ['domain:pam', 'access:manage']), true);
  assert.equal(domainAccessible('dlp', ['domain:pam', 'netskope:read']), true);
  assert.equal(domainAccessible('dlp', ['netskope:dlp_read']), true);
});

test('BigID DSPM stays disabled and inaccessible', () => {
  assert.equal(domainMeta('dspm').status, 'coming-soon');
  assert.equal(domainAccessible('dspm', ['access:manage']), false);
  assert.deepEqual(domainWorkspaces('dspm'), []);
});

test('Cadena Identity is folded into Relaciones, keeping its old path as an alias', () => {
  assert.equal(workspaceFromPath('/pam/identity/chain'), 'graph');
  assert.equal(workspacePath('graph'), '/pam/graph');
  assert.equal(hasWorkspaceAccess('graph', ['pam:catalogs_read']), true);
  assert.equal(hasWorkspaceAccess('graph', ['identity:catalogs_read']), false);
});
