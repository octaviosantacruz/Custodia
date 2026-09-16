import type { WorkspaceView } from './workspaces';

export type SiaGranteeKind = 'user' | 'group' | 'role';

/**
 * SIA exposes grantees as names. The tenant convention `sg_cyberark` is an
 * operational classification for Okta groups, so route those names to the
 * Groups view instead of treating them as PAM roles.
 */
export function siaGranteeTarget(name: string, declaredKind: SiaGranteeKind): { kind: SiaGranteeKind; view: WorkspaceView } {
  if (name.toLowerCase().includes('sg_cyberark')) return { kind: 'group', view: 'identityGroups' };
  if (declaredKind === 'user') return { kind: 'user', view: 'identityUsers' };
  if (declaredKind === 'group') return { kind: 'group', view: 'identityGroups' };
  return { kind: 'role', view: 'roles' };
}
