import type { AccessDomain, AccessPermission, AccessRole } from './access-control-api';

export type AccessTool = { id: string; name: string; dark?: string; light?: string };
const hub: AccessTool = { id: 'hub', name: 'Custodia y perfiles transversales' };
const cyberark: AccessTool = { id: 'cyberark', name: 'CyberArk', dark: '/cyberark-logo-white.png', light: '/cyberark-logo-dark.png' };
const netskope: AccessTool = { id: 'netskope', name: 'Netskope', dark: '/netskope-full-white.png', light: '/netskope-full-black.png' };
const bigid: AccessTool = { id: 'bigid', name: 'BigID', dark: '/bigid-full-white.png', light: '/bigid-full-black.png' };

// Access domains differ from navigation domains. Unknown catalog areas get their own
// compartment automatically; this registry only supplies known brand metadata.
const brands: Record<string, AccessTool> = { platform: hub, pam: cyberark, identity: cyberark, sia: cyberark, dlp: netskope, dspm: bigid };
export function accessTool(domainCode: string, domains: AccessDomain[]): AccessTool {
  return brands[domainCode] || { id: domainCode, name: domains.find((domain) => domain.domain_code === domainCode)?.display_name || 'Sin catalogar' };
}

export function groupAccessRoles(roles: AccessRole[], domains: AccessDomain[], permissions: AccessPermission[]) {
  const byCode = new Map(permissions.map((permission) => [permission.permission_code, permission.domain_code]));
  const groups = new Map<string, { tool: AccessTool; roles: AccessRole[]; areas: AccessDomain[] }>();
  for (const role of roles) {
    const owners = new Map<string, AccessTool>();
    for (const code of role.permission_codes) {
      const domain = byCode.get(code);
      const tool = domain ? accessTool(domain, domains) : hub;
      owners.set(tool.id, tool);
    }
    const tool = role.system_managed && role.domain_code ? accessTool(role.domain_code, domains)
      : owners.size === 1 ? [...owners.values()][0] : owners.size ? hub : role.domain_code ? accessTool(role.domain_code, domains) : hub;
    const group = groups.get(tool.id) || { tool, roles: [], areas: [] };
    group.roles.push(role);
    groups.set(tool.id, group);
  }
  for (const group of groups.values()) {
    group.areas = domains.filter((domain) => domain.lifecycle_status === 'active' && accessTool(domain.domain_code, domains).id === group.tool.id || group.roles.some((role) => role.level_refs.some((ref) => ref.domain_code === domain.domain_code) || role.permission_codes.some((code) => byCode.get(code) === domain.domain_code)));
  }
  return [...groups.values()].sort((a, b) => a.tool.id === 'hub' ? -1 : b.tool.id === 'hub' ? 1 : a.tool.name.localeCompare(b.tool.name));
}
