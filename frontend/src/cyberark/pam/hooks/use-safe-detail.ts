import { useCallback, useState } from 'react';
import { api } from '../../../cross/lib/api';
import type { Account, MetadataForm, Member, SafeDetail } from '../types/safe';
import type { AuditEntry } from '../types/audit';

export type SafeDetailState = {
  safe: SafeDetail;
  members: Member[];
  accounts: Account[];
  audit: AuditEntry[];
};

type UseSafeDetailOptions = {
  onError: (message: string) => void;
};

export const emptyMetadataForm: MetadataForm = {
  internal_name: '', business_unit_id: '', responsible_id: '',
  classification_status: 'pending', inventory_scope: 'pending', data_quality_status: 'pending', workflow_status: 'pending',
  next_action: '', assigned_by: '', notes: '',
};

export function useSafeDetail({ onError }: UseSafeDetailOptions) {
  const [detail, setDetail] = useState<SafeDetailState | null>(null);
  const [form, setForm] = useState<MetadataForm>(emptyMetadataForm);

  const selectSafe = useCallback(async (safeNumber: number) => {
    onError('');
    try {
      const [data, accounts, audit] = await Promise.all([
        api<{ safe: SafeDetail; members: Member[] }>(`/safes/${safeNumber}`),
        api<{ rows: Account[] }>(`/safes/${safeNumber}/accounts?limit=200`),
        api<{ rows: AuditEntry[] }>(`/safes/${safeNumber}/audit`),
      ]);
      setDetail({ ...data, accounts: accounts.rows, audit: audit.rows });
      setForm({
        internal_name: data.safe.internal_name || '',
        business_unit_id: data.safe.business_unit_id || '',
        responsible_id: data.safe.responsible_id || '',
        classification_status: data.safe.classification_status || 'pending',
        inventory_scope: data.safe.inventory_scope || 'pending',
        data_quality_status: data.safe.data_quality_status || 'pending',
        workflow_status: data.safe.workflow_status || 'pending',
        next_action: data.safe.next_action || '',
        assigned_by: data.safe.assigned_by || '',
        notes: data.safe.notes || '',
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No se pudo abrir la safe');
    }
  }, [onError]);

  return { detail, setDetail, form, setForm, selectSafe };
}
