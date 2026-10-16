// Contract for the sanctioned read-only Identity Administration → PAM chain bridge.
export type IdentityPamChainPsm = {
  object_id: number;
  display_name: string;
  source_id: string;
};

export type IdentityPamChainPlatform = {
  object_id: number;
  display_name: string;
  source_id: string;
  psms: IdentityPamChainPsm[];
};

export type IdentityPamChainSafe = {
  object_id: number;
  display_name: string;
  safe_number: string;
  account_count: number;
  platform_count: number;
  platforms: IdentityPamChainPlatform[];
};

export type IdentityPamChainRole = {
  object_id: number;
  display_name: string;
  source_id: string;
  safe_count: number;
  safes: IdentityPamChainSafe[];
};

export type IdentityPamChain = {
  matched: boolean;
  pam_user: { object_id: number; display_name: string; source_id: string } | null;
  roles: IdentityPamChainRole[];
  roles_omitted: number;
  totals: { roles: number; safes: number; platforms: number; psms: number; accounts: number };
  /** Sanctioned link basis: shared UUID or exact email 1-to-1. */
  match_basis?: 'uuid' | 'email' | null;
  status?: 'matched' | 'ambiguous' | 'unmatched';
};

export type PamUserChain = IdentityPamChain;
