export type PamIdentityKind = 'user' | 'okta_group' | 'cyberark_role';

export const PAM_IDENTITY_KIND_LABELS: Record<PamIdentityKind, string> = {
  user: 'Usuario',
  okta_group: 'Grupo Okta',
  cyberark_role: 'Rol CyberArk',
};

/* These naming rules are display classification only; they do not create graph
   relationships or replace source identifiers. The backend scopes each kind
   by its persisted object_type. Keep this logic aligned with
   pam_role_queries.py. */
export function classifyPamIdentity(name: string): PamIdentityKind {
  const normalized = name.trim().toLowerCase();
  // A name with an email shape is a person's account, whatever its domain.
  if (normalized.includes('@')) return 'user';
  if (normalized.startsWith('sg_')) return 'okta_group';
  return 'cyberark_role';
}

export function identityChipKind(kind: PamIdentityKind): 'user' | 'group' | 'role' {
  return kind === 'user' ? 'user' : kind === 'okta_group' ? 'group' : 'role';
}

/* Role connections (Safe/platform/PSM detail) only exist for roles; expanding
   a user identity must never fetch them. The gate follows the live
   classification filter the caller drives, never a static initial prop:
   `use-pam-roles` used to read `initialKind` here, so a live filter change to
   "Usuarios" kept firing role-detail requests. */
export function roleDetailEnabled(kind: PamIdentityKind | ''): boolean {
  return kind !== 'user';
}
