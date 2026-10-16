import type { ChainGraphNode } from '../components/chain-graph';
import type { IdentityPamChainRole, PamUserChain } from '../types/identity-pam-chain';

export function personGraphNodes(
  chain: PamUserChain,
  fallbackName: string,
  userDescription = 'usuario PAM seleccionado',
): ChainGraphNode[] {
  const roles: IdentityPamChainRole[] = chain.roles;
  const safes = roles.flatMap((role) => role.safes);
  const uniqueSafes = [...new Map(safes.map((safe) => [safe.object_id, safe])).values()];
  const platforms = uniqueSafes.flatMap((safe) => safe.platforms || []);
  const uniquePlatforms = [...new Map(platforms.map((platform) => [platform.object_id, platform])).values()];
  const psms = uniquePlatforms.flatMap((platform) => platform.psms || []);
  const uniquePsms = [...new Map(psms.map((psm) => [psm.object_id, psm])).values()];
  return [
    { id: 'person', label: 'Usuario', count: 1, description: userDescription, items: [chain.pam_user?.display_name || fallbackName] },
    { id: 'roles', label: 'Roles', count: chain.totals.roles, description: 'acceso concedido', items: roles.map((role) => role.display_name) },
    { id: 'safes', label: 'Safes', count: chain.totals.safes, description: 'alcanzables', items: uniqueSafes.map((safe) => safe.display_name), actionLabel: 'Abrir Safes' },
    { id: 'platforms', label: 'Plataformas', count: chain.totals.platforms, description: 'cuentas administradas', items: uniquePlatforms.map((platform) => platform.display_name), actionLabel: 'Abrir plataformas' },
    { id: 'psm', label: 'PSM', count: chain.totals.psms, description: 'sesiones controladas', items: uniquePsms.map((psm) => psm.display_name), actionLabel: 'Abrir conectores' },
  ];
}
