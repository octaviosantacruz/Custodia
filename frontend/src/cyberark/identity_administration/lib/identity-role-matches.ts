import type { IdentityRoleMatchRef, IdentityRoleMatches } from '../types/identity';

export type RoleMatchInfo = {
  /** Other roles sharing the same direct members. */
  sameMembers: IdentityRoleMatchRef[];
  /** Other roles that resolve to the same accounts through every path. */
  sameAccounts: IdentityRoleMatchRef[];
  /** Roles/groups this role reaches, excluding itself (names only; ids are opaque). */
  reaches: IdentityRoleMatchRef[];
  directMembers: number | null;
  referencedAccounts: number | null;
};

export type RoleMatchIndex = {
  /** Keyed by the role's source_id, which every table row carries. */
  bySourceId: Map<string, RoleMatchInfo>;
  /** object_id of every role that has at least one match, for server-side filtering. */
  objectIds: number[];
  directGroups: number;
  accountGroups: number;
};

function entry(index: Map<string, RoleMatchInfo>, id: string): RoleMatchInfo {
  let info = index.get(id);
  if (!info) {
    info = { sameMembers: [], sameAccounts: [], reaches: [], directMembers: null, referencedAccounts: null };
    index.set(id, info);
  }
  return info;
}

export function buildRoleMatchIndex(matches: IdentityRoleMatches): RoleMatchIndex {
  const bySourceId = new Map<string, RoleMatchInfo>();
  for (const group of matches.same_direct_members) {
    for (const role of group.roles) {
      const info = entry(bySourceId, role.id);
      info.sameMembers = group.roles.filter((other) => other.id !== role.id);
      info.directMembers = group.direct_members;
    }
  }
  for (const group of matches.same_user_references) {
    for (const role of group.roles) {
      const info = entry(bySourceId, role.id);
      info.sameAccounts = group.roles.filter((other) => other.id !== role.id);
      info.referencedAccounts = group.referenced_accounts;
      info.reaches = (role.traversal ?? []).filter((step) => step.id !== role.id);
    }
  }
  const objectIds = new Set<number>();
  for (const group of [...matches.same_direct_members, ...matches.same_user_references]) {
    for (const role of group.roles) if (role.object_id !== null) objectIds.add(role.object_id);
  }
  return {
    bySourceId,
    objectIds: [...objectIds].sort((a, b) => a - b),
    directGroups: matches.same_direct_members.length,
    accountGroups: matches.same_user_references.length,
  };
}
