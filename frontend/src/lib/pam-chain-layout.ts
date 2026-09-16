import type {
  IdentityPamChainPlatform, IdentityPamChainPsm, IdentityPamChainRole,
  IdentityPamChainSafe, PamUserChain,
} from '../types/pam';

export type PamChainPathRow = {
  id: string;
  role: IdentityPamChainRole;
  safe: IdentityPamChainSafe | null;
  platform: IdentityPamChainPlatform | null;
  psms: IdentityPamChainPsm[];
};

export type PamChainRoleGroup = {
  role: IdentityPamChainRole;
  rows: PamChainPathRow[];
};

export type AggregatedPlatformRoute = {
  platform: IdentityPamChainPlatform;
  safeNames: string[];
};

export type AggregatedPsmRoute = {
  psm: IdentityPamChainPsm;
  platformNames: string[];
};

export type AggregatedRoleRoutes = {
  safes: IdentityPamChainSafe[];
  platforms: AggregatedPlatformRoute[];
  psms: AggregatedPsmRoute[];
  missingSafe: boolean;
  missingPlatform: boolean;
  missingPsm: boolean;
};

export function chainPathRows(chain: PamUserChain): PamChainPathRow[] {
  const rows: PamChainPathRow[] = [];
  for (const role of chain.roles) {
    if (!role.safes.length) {
      rows.push({ id: `role-${role.object_id}`, role, safe: null, platform: null, psms: [] });
      continue;
    }
    for (const safe of role.safes) {
      if (!safe.platforms.length) {
        rows.push({ id: `role-${role.object_id}-safe-${safe.object_id}`, role, safe, platform: null, psms: [] });
        continue;
      }
      for (const platform of safe.platforms) {
        rows.push({
          id: `role-${role.object_id}-safe-${safe.object_id}-platform-${platform.object_id}`,
          role,
          safe,
          platform,
          psms: platform.psms,
        });
      }
    }
  }
  return rows;
}

export function groupRowsByRole(rows: PamChainPathRow[]): PamChainRoleGroup[] {
  const groups = new Map<number, PamChainRoleGroup>();
  for (const row of rows) {
    const current = groups.get(row.role.object_id);
    if (current) current.rows.push(row);
    else groups.set(row.role.object_id, { role: row.role, rows: [row] });
  }
  return [...groups.values()];
}

export function aggregateRoleRoutes(rows: PamChainPathRow[]): AggregatedRoleRoutes {
  const safes = new Map<number, IdentityPamChainSafe>();
  const platforms = new Map<number, { platform: IdentityPamChainPlatform; safeNames: Set<string> }>();
  const psms = new Map<number, { psm: IdentityPamChainPsm; platformNames: Set<string> }>();
  let missingSafe = false;
  let missingPlatform = false;
  let missingPsm = false;

  for (const row of rows) {
    if (!row.safe) {
      missingSafe = true;
      continue;
    }
    safes.set(row.safe.object_id, row.safe);
    if (!row.platform) {
      missingPlatform = true;
      continue;
    }
    const platformRoute = platforms.get(row.platform.object_id) ?? {
      platform: row.platform,
      safeNames: new Set<string>(),
    };
    platformRoute.safeNames.add(row.safe.display_name);
    platforms.set(row.platform.object_id, platformRoute);
    if (!row.psms.length) missingPsm = true;
    for (const psm of row.psms) {
      const psmRoute = psms.get(psm.object_id) ?? { psm, platformNames: new Set<string>() };
      psmRoute.platformNames.add(row.platform.display_name);
      psms.set(psm.object_id, psmRoute);
    }
  }

  return {
    safes: [...safes.values()],
    platforms: [...platforms.values()].map(({ platform, safeNames }) => ({ platform, safeNames: [...safeNames] })),
    psms: [...psms.values()].map(({ psm, platformNames }) => ({ psm, platformNames: [...platformNames] })),
    missingSafe,
    missingPlatform,
    missingPsm,
  };
}
