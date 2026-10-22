/** Identity roles and Okta groups share one object type; the declared `sg_cyberark` prefix tells them apart (same rule as the backend `kind` filter). */
export type IdentityRoleKindName = 'role' | 'okta_group';

export function identityRoleKind(displayName: string): IdentityRoleKindName {
  return displayName.toLowerCase().startsWith('sg_cyberark') ? 'okta_group' : 'role';
}

export const IDENTITY_ROLE_KIND_LABELS: Record<IdentityRoleKindName, string> = { role: 'Rol de CyberArk', okta_group: 'Grupo de Okta' };
