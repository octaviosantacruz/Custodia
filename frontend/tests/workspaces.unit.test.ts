import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalWorkspaceList, categorizedWorkspaces, categoryOfWorkspace, canonicalRecentWorkspace, hasWorkspaceAccess, workspaceFromPath, workspacePath, workspaceViews } from '../src/lib/workspaces.ts';
import { domainAccessible, domainMeta, domainOf, domainWorkspaces } from '../src/lib/domains.ts';

test('workspaceViews includes the assets workspace', () => {
  assert.ok(workspaceViews.includes('assets'));
  assert.ok(workspaceViews.includes('platforms'));
  assert.ok(workspaceViews.includes('connectors'));
});

test('categorized workspaces hide empty groups and unauthorized modules', () => {
  const reader = categorizedWorkspaces(['safes', 'assets', 'general', 'posture', 'sia', 'identity', 'roles']);
  assert.deepEqual(reader.map((category) => category.id), ['inventory', 'pam_access', 'identity_sia', 'posture']);
  assert.deepEqual(reader.find((category) => category.id === 'pam_access')?.views, ['roles']);
  assert.equal(reader.find((category) => category.id === 'administration'), undefined);
});

test('each catalogued workspace maps to one browse category', () => {
  assert.equal(categoryOfWorkspace('safes'), 'inventory');
  assert.equal(categoryOfWorkspace('graph'), 'pam_access');
  assert.equal(categoryOfWorkspace('identity'), 'identity_sia');
  assert.equal(categoryOfWorkspace('platforms'), 'technical_catalogs');
  assert.equal(categoryOfWorkspace('connectors'), 'technical_catalogs');
  assert.equal(categoryOfWorkspace('accessAssets'), 'technical_catalogs');
  assert.equal(categoryOfWorkspace('siaConnectors'), null);
  assert.equal(categoryOfWorkspace('siaResources'), 'identity_sia');
  assert.equal(categoryOfWorkspace('siaDatabaseAccounts'), 'identity_sia');
  assert.equal(categoryOfWorkspace('identityFederations'), 'identity_sia');
  assert.equal(categoryOfWorkspace('users'), 'administration');
});

test('tool navigation keeps PAM analysis separate from platform administration', () => {
  assert.deepEqual(domainWorkspaces('admin'), ['users', 'activity']);
  assert.equal(domainOf('posture'), 'pam');
  assert.equal(domainOf('graph'), 'pam');
  assert.equal(workspacePath('platforms'), '/pam/platforms');
  assert.equal(workspaceFromPath('/pam/connectors'), 'connectors');
  assert.equal(workspaceFromPath('/pam/sia/connectors'), 'connectors');
  assert.ok(!domainWorkspaces('pam').includes('identityGroups'));
  assert.ok(domainWorkspaces('pam').includes('identity'));
  assert.ok(domainWorkspaces('pam').includes('pamHealth'));
  assert.ok(!domainWorkspaces('pam').includes('aimApplications'));
  assert.equal(categoryOfWorkspace('aimApplications'), null);
  assert.ok(!domainWorkspaces('pam').includes('siaConnectors'));
  // IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §3.2 (Fase 2): Recursos/
  // Cobertura sub-views stay valid WorkspaceViews (deep links keep
  // working) but are no longer separate switcher destinations -- SIA is
  // the single one.
  assert.ok(!domainWorkspaces('pam').includes('accessAssets'));
  assert.ok(!domainWorkspaces('pam').includes('siaResources'));
  assert.ok(!domainWorkspaces('pam').includes('siaDatabaseAccounts'));
  assert.ok(!domainWorkspaces('pam').includes('assets'));
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
  assert.equal(workspaceFromPath('/pam/identity/federations'), 'identityFederations');
  assert.equal(workspacePath('assets'), '/pam/assets');
  assert.equal(workspaceFromPath('/pam/ip-inventory'), 'assets');
});

test('hasWorkspaceAccess lets an ungated workspace through regardless of permissions', () => {
  assert.equal(hasWorkspaceAccess('safes', []), true);
  assert.equal(hasWorkspaceAccess('general', []), true);
});

test('hasWorkspaceAccess still requires access:manage for genuine platform administration', () => {
  assert.equal(hasWorkspaceAccess('users', []), false);
  assert.equal(hasWorkspaceAccess('users', ['pam:catalogs_read']), false);
  assert.equal(hasWorkspaceAccess('users', ['access:manage']), true);
  assert.equal(hasWorkspaceAccess('activity', ['pam:catalogs_read']), false);
  assert.equal(hasWorkspaceAccess('graph', ['pam:catalogs_read']), false);
});

test('hasWorkspaceAccess accepts the narrow pam:catalogs_read permission for PAM technical catalogs', () => {
  for (const view of ['platforms', 'connectors', 'pamHealth', 'aimApplications', 'accessAssets'] as const) {
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

test('the former Identity roles path is a compatibility alias for consolidated CyberArk roles', () => {
  assert.ok(workspaceViews.includes('identityRoles'));
  assert.equal(workspacePath('identityRoles'), '/pam/roles');
  assert.equal(workspaceFromPath('/pam/identity/roles'), 'roles');
  assert.equal(categoryOfWorkspace('identityRoles'), 'pam_access');
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
  assert.deepEqual(canonicalWorkspaceList(['safes', 'roles', 'identityRoles', 'identity', 'assets', 'sia']), ['safes', 'identity', 'sia']);
});

test('canonicalRecentWorkspace maps every SIA subview to the single sia destination', () => {
  assert.equal(canonicalRecentWorkspace('siaResources'), 'sia');
  assert.equal(canonicalRecentWorkspace('siaDatabaseAccounts'), 'sia');
  assert.equal(canonicalRecentWorkspace('accessAssets'), 'sia');
  assert.equal(canonicalRecentWorkspace('assets'), 'sia');
  assert.equal(canonicalRecentWorkspace('sia'), 'sia');
});

test('canonicalRecentWorkspace leaves unrelated workspaces untouched', () => {
  assert.equal(canonicalRecentWorkspace('safes'), 'safes');
  assert.equal(canonicalRecentWorkspace('platforms'), 'platforms');
});

test('Netskope DLP is a navigable, non-planned domain gated by access:manage or netskope:read', () => {
  assert.equal(workspaceViews.includes('netskope'), true);
  assert.equal(workspacePath('netskope'), '/netskope');
  assert.equal(workspaceFromPath('/netskope'), 'netskope');
  assert.deepEqual(domainWorkspaces('dlp'), ['netskope']);
  assert.equal(domainOf('netskope'), 'dlp');
  assert.equal(domainMeta('dlp').status, 'active');

  assert.equal(hasWorkspaceAccess('netskope', []), false);
  assert.equal(hasWorkspaceAccess('netskope', ['access:manage']), true);
  assert.equal(hasWorkspaceAccess('netskope', ['netskope:read']), true);
  assert.equal(hasWorkspaceAccess('netskope', ['inventory:read']), false);
});

test('domainAccessible unlocks Netskope DLP for access:manage or domain:dlp grants', () => {
  assert.equal(domainAccessible('dlp', []), true);
  assert.equal(domainAccessible('dlp', ['domain:pam']), false);
  assert.equal(domainAccessible('dlp', ['domain:dlp']), true);
  assert.equal(domainAccessible('dlp', ['access:manage']), true);
});

test('BigID DSPM stays disabled and inaccessible', () => {
  assert.equal(domainMeta('dspm').status, 'coming-soon');
  assert.equal(domainAccessible('dspm', ['access:manage']), false);
  assert.deepEqual(domainWorkspaces('dspm'), []);
});
