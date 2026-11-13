import type { ChainHop, ChainNodeType } from './chains-api';
import type { WorkspaceView } from './workspaces';
import { t } from '../i18n/index.ts';

export const CHAIN_NODE_LABELS: Record<ChainNodeType, string> = {
  user: t('Usuario PAM'),
  role: 'Rol',
  safe: 'Safe',
  platform: 'Plataforma',
  psm: 'PSM',
  access_asset: 'Asset',
  access_policy: t('Política SIA'),
  netskope_user: t('Usuario Netskope'),
  netskope_device: 'Dispositivo',
  netskope_client_version: t('Versión de cliente'),
  netskope_os: 'SO',
};

const INVENTORY_VIEWS: Partial<Record<ChainNodeType, WorkspaceView>> = {
  user: 'identityUsers',
  role: 'roles',
  safe: 'safes',
  platform: 'platforms',
  psm: 'connectors',
  access_asset: 'assets',
  access_policy: 'sia',
  netskope_user: 'netskopeUsers',
  netskope_device: 'netskopeDevices',
  netskope_client_version: 'netskopeInventory',
  netskope_os: 'netskopeInventory',
};

export function chainInventoryView(type: ChainNodeType): WorkspaceView | null {
  return INVENTORY_VIEWS[type] ?? null;
}

export type ChainDiff = {
  onlyA: ChainHop[];
  onlyB: ChainHop[];
  both: ChainHop[];
};

/** Diff two nodes' same-direction hops by (type, id), preserving A/B order. */
export function diffChainHops(a: ChainHop[], b: ChainHop[]): ChainDiff {
  const key = (hop: ChainHop) => `${hop.type}:${hop.id}`;
  const bKeys = new Set(b.map(key));
  const aKeys = new Set(a.map(key));
  return {
    onlyA: a.filter((hop) => !bKeys.has(key(hop))),
    onlyB: b.filter((hop) => !aKeys.has(key(hop))),
    both: a.filter((hop) => bKeys.has(key(hop))),
  };
}
