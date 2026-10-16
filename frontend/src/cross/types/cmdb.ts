export type CmdbCoverage = {
  objects: { object_type: 'user' | 'role' | 'safe' | 'platform' | 'psm' | 'access_policy' | 'sia'; active: number; clean: number; quality_issues: number }[];
  relationships: { relationship_type: string; count: number }[];
  chains: { pam: 'ready' | 'partial' | 'pending_sources'; sia: 'ready' | 'pending_sources' };
  identity_administration?: { user?: number; role?: number };
  sia?: { access_policy?: number };
};
