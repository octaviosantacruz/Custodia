import { api } from '../../../cross/lib/api';
import { RETIRED_LIMIT_MAX } from './retired-safes';
import type { RetiredCandidates } from '../types/safe';

export type RetiredSafesOptions = { signal?: AbortSignal };

/** Bounded request path; mirrors the 1..500 range enforced by the API. */
export function retiredSafesPath(limit: number): string {
  const requested = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : RETIRED_LIMIT_MAX;
  const bounded = Math.min(Math.max(requested, 1), RETIRED_LIMIT_MAX);
  return `/lifecycle/retired?limit=${bounded}`;
}

/**
 * Read-only fetch of Safes that stopped appearing after a complete sync run.
 * The response is normalized so a malformed payload cannot crash the list and
 * `deletion_enabled` is treated as informational only (always false today).
 */
export async function fetchRetiredSafes(limit: number, { signal }: RetiredSafesOptions = {}): Promise<RetiredCandidates> {
  const data = await api<RetiredCandidates>(retiredSafesPath(limit), { signal });
  return {
    rows: Array.isArray(data.rows) ? data.rows : [],
    total: typeof data.total === 'number' ? data.total : 0,
    deletion_enabled: data.deletion_enabled === true,
  };
}
