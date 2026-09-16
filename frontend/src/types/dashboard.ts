import type { IngestionRun } from './ingestion';

export type Summary = {
  safes: number;
  business_safes: number;
  internal_safes: number;
  scope_pending_safes: number;
  scope_candidate_safes: number;
  clean_business_safes: number;
  obsolete_safes: number;
  duplicate_safes: number;
  accounts: number;
  pending_classification: number;
  assigned: number;
  review: number;
  safe_health: {
    denominator: number;
    missing_cpm: number;
    no_accounts: number;
    olac_disabled: number;
    retention_unconfigured: number;
    manage_safe_concentration: number;
  };
  latest_run: IngestionRun | null;
};

export type InventoryFreshness = {
  safes: number;
  last_mod_unknown: number;
  last_mod_30d: number;
  last_mod_90d: number;
  last_mod_365d: number;
  last_mod_over_year: number;
  safes_without_accounts: number;
  accounts_active: number;
  accounts_retired: number;
  accounts_not_seen_30d: number;
};

export type ConcentrationEntry = { name: string; safe_count: number };
export type AccessConcentration = {
  users: ConcentrationEntry[];
  roles: ConcentrationEntry[];
  totals: { users: number; roles: number; safes: number };
};
