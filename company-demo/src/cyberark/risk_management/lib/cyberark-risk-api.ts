import { api } from '../../../cross/lib/api';

export const CYBERARK_RISK_PAGE_SIZE = 50;

export type CyberarkRiskType = {
  risk_type_id: string;
  name: string | null;
  description: string | null;
  severity: string | null;
  entity_type: string | null;
  open_findings: number | null;
  status_counts: Record<string, number>;
  updated_at: string | null;
  recommendation_types: string[];
};

export type CyberarkRiskFinding = {
  finding_id: string;
  risk_type_id: string;
  entity_id: string;
  entity_name: string | null;
  entity_type: string | null;
  severity: string | null;
  status: string | null;
  first_detected_at: string | null;
  last_detected_at: string | null;
};

export type CyberarkRemediation = {
  remediation_id: string;
  remediation_type: string | null;
  entity_type: string | null;
  name: string | null;
  text: string | null;
};

export type CyberarkRiskOverview = {
  source: 'cyberark_risk_management';
  fetched_at: string;
  summary: {
    total_findings_by_severity: Record<string, number>;
    entity_types: Array<{
      entity_type: string;
      categories: Array<{ category: string; severity_counts: Record<string, number> }>;
    }>;
  };
  risk_types: CyberarkRiskType[];
  remediations: CyberarkRemediation[];
  progress: {
    total_onboarded_current: number | null;
    total_onboarded_through_discovery_current: number | null;
    points: Array<{ date_at: string; total_discovered: number | null; total_onboarded: number | null }>;
  };
  recommendations_status: 'catalog_options_only';
};

export type CyberarkRiskFindingsPage = {
  source: 'cyberark_risk_management';
  fetched_at: string;
  rows: CyberarkRiskFinding[];
  entity_names_visible: boolean;
  limit: number;
  offset: number;
  is_last_page: boolean;
};

export const fetchCyberarkRiskOverview = (signal?: AbortSignal) =>
  api<CyberarkRiskOverview>('/cyberark-risk/overview', { signal });

export const fetchCyberarkRiskFindings = (page: number, signal?: AbortSignal) => {
  const params = new URLSearchParams({
    limit: String(CYBERARK_RISK_PAGE_SIZE),
    offset: String(page * CYBERARK_RISK_PAGE_SIZE),
  });
  return api<CyberarkRiskFindingsPage>(`/cyberark-risk/findings?${params}`, { signal }).then((result) => ({
    ...result,
    entity_names_visible: result.entity_names_visible === true,
    rows: result.rows.map((finding) => ({
      ...finding,
      entity_name: typeof finding.entity_name === 'string' && finding.entity_name.trim()
        ? finding.entity_name
        : null,
    })),
  }));
};

export type CyberarkRiskAllFindings = Omit<CyberarkRiskFindingsPage, 'limit' | 'offset' | 'is_last_page'> & { complete: true };

/** Every finding for the grouped view; 422 means CyberArk reported more than the bounded read allows. */
export const fetchCyberarkRiskAllFindings = (signal?: AbortSignal) =>
  api<CyberarkRiskAllFindings>('/cyberark-risk/findings/all', { signal }).then((result) => ({
    ...result,
    entity_names_visible: result.entity_names_visible === true,
    rows: result.rows.map((finding) => ({
      ...finding,
      entity_name: typeof finding.entity_name === 'string' && finding.entity_name.trim() ? finding.entity_name : null,
    })),
  }));
