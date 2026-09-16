export type IngestionRun = {
  run_id: string;
  source_system?: 'cyberark' | 'identity_administration' | 'sia' | 'access';
  source_file?: string | null;
  status: string;
  enqueued_at?: string;
  started_at: string;
  completed_at: string | null;
  status_message?: string | null;
  attempt_count?: number;
  expected_safe_count: number | null;
  received_safe_count: number;
  received_member_count: number;
  received_object_count?: number;
  received_relationship_count?: number;
  retired_object_count?: number;
  retired_relationship_count?: number;
  error_count: number;
  error_details?: Array<{ safeName?: string; error?: string }>;
  triggered_by?: string | null;
  safes_created?: number;
  safes_updated?: number;
  safes_retired?: number;
  members_created?: number;
  members_updated?: number;
  members_retired?: number;
  pam_synced?: boolean;
};

export type FieldChange = { field: string; before: unknown; after: unknown };

export type IngestionPreview = {
  safe_counts: { incoming: number; current: number; new: number; changed: number; unchanged: number; retired: number };
  member_counts: { incoming: number; current: number; new: number; changed: number; unchanged: number; retired: number };
  samples: {
    new_safes: { safe_number: number; safe_name: string }[];
    changed_safes: { safe_number: number; safe_name: string; changes: FieldChange[] }[];
    retired_safes: { safe_number: number; safe_name: string }[];
    new_members: { safe_number: number; member_id: string; member_name: string }[];
    changed_members: { safe_number: number; member_id: string; member_name: string; changes: FieldChange[]; security_relevant: boolean }[];
    retired_members: { safe_number: number; member_id: string; member_name: string }[];
  };
  reported_safe_count: number | null;
  complete_snapshot: boolean;
  can_reconcile: boolean;
  warning: string | null;
};
