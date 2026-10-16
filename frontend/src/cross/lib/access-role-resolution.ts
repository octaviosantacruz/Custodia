import type { AccessDomain, AccessRole, CustomRoleLevelRef } from './access-control-api';

export function resolveCompositePermissions(
  levelRefs: Array<Pick<CustomRoleLevelRef, 'domain_code' | 'level_code'>>,
  domains: AccessDomain[],
): string[] {
  const permissions = new Set<string>();
  const levelByKey = new Map(
    domains.flatMap((domain) => domain.levels.map((level) => [`${domain.domain_code}:${level.level_code}`, level] as const)),
  );
  levelRefs.forEach((ref) => {
    levelByKey.get(`${ref.domain_code}:${ref.level_code}`)?.permission_codes.forEach((code) => permissions.add(code));
  });
  return Array.from(permissions).sort();
}

export function findDuplicateCompositeRole(
  levelRefs: Array<Pick<CustomRoleLevelRef, 'domain_code' | 'level_code'>>,
  roles: AccessRole[],
  excludedRoleCode = '',
): AccessRole | null {
  const signature = compositionSignature(levelRefs);
  return roles.find((role) => role.role_kind === 'composite' && role.role_code !== excludedRoleCode && compositionSignature(role.level_refs) === signature) || null;
}

function compositionSignature(levelRefs: Array<Pick<CustomRoleLevelRef, 'domain_code' | 'level_code'>>): string {
  return levelRefs.map((ref) => `${ref.domain_code}:${ref.level_code}`).sort().join('|');
}
