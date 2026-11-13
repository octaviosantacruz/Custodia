import { DateTime } from '../../../cross/components/date-time';
import { Fragment, memo } from 'react';
import { ChevronDown, Save, Trash2 } from 'lucide-react';
import { CompactSelect, type CompactSelectOption } from '../../../cross/components/compact-select';
import { StateBlock } from '../../../cross/components/state-block';
import { StatusBadge } from '../../../cross/components/semantic';
import { actionLabel, dateTimeHint, formatDate, formatNumber, nextActionOptions } from '../../../cross/lib/format';
import { retentionLabel, retiredAccountsLabel, showsRetiredAccounts, workflowLabel, workflowStatusesFor } from '../lib/safe-labels';
import { RetiredAccountsSection } from './retired-accounts-section';
import { automaticManagementLabel, managementStatusLabel } from '../lib/account-management';
import type { Account, SafeRow, WorkflowStatus } from '../types/safe';
import './account-type-chip.css';
import { t } from '../../../cross/i18n/index.ts';

type Assignment = { business_unit_id: number | null; responsible_id: number | null };

type SafeTableRowProps = {
  safe: SafeRow;
  selected: boolean;
  checked: boolean;
  bulkDisabled: boolean;
  assignment: Assignment;
  assignmentChanged: boolean;
  expanded: boolean;
  accounts: Account[];
  accountsTotal: number;
  accountsLoading: boolean;
  accountsError: string | null;
  accountSearch: string;
  unitOptions: CompactSelectOption[];
  responsibleOptions: CompactSelectOption[];
  actionOptions: string[];
  saving: boolean;
  saved: boolean;
  onSelect: (safeNumber: number) => void;
  onToggleCheck: (safeNumber: number) => void;
  onToggleAccounts: (safeNumber: number) => void;
  onRetryAccounts: (safeNumber: number) => void;
  onAssignmentChange: (safeNumber: number, assignment: Assignment) => void;
  onAssignmentSave: (safeNumber: number, assignment: Assignment) => Promise<void>;
  onQuickUpdate: (safe: SafeRow, updates: { workflow_status?: WorkflowStatus; next_action?: string | null }) => void;
  onAccountTypeChange: (safe: SafeRow, value: 'nominal' | 'no_nominal' | 'internal') => Promise<void>;
  canManage: boolean;
  onAddBusinessUnit: () => void | Promise<void>;
  onAddResponsible: () => void | Promise<void>;
};

function actionTone(action: string): string {
  const value = action.toLowerCase();
  if (value.includes('migrar')) return 'migrate';
  if (value.includes('rotar')) return 'rotate';
  if (value.includes('consultar')) return 'consult';
  if (value.includes('revisar') || value.includes('baja')) return 'retire';
  return 'undefined';
}

function accountTypeTone(key: string): string {
  const value = key.toLowerCase();
  if (value.includes('no nominal')) return 'nonominal';
  if (value.includes('interno') || value.includes('cyberark managed')) return 'cyberark';
  if (value.includes('nominal')) return 'nominal';
  if (value.includes('cyberark')) return 'cyberark';
  return 'other';
}

function automaticManagementTone(value: Account['attributes']['automatic_management_enabled']): 'success' | 'warning' | 'neutral' {
  return value === true ? 'success' : value === false ? 'warning' : 'neutral';
}

function managementStatusTone(value: Account['attributes']['management_status']): 'success' | 'danger' | 'warning' | 'neutral' {
  if (value === 'success') return 'success';
  if (value === 'failure') return 'danger';
  if (value === 'in_process') return 'warning';
  return 'neutral';
}

const ACCOUNT_TYPE_OPTIONS: CompactSelectOption[] = [{ value: '', label: t('Seleccionar tipo') }, { value: 'nominal', label: t('Nominal') }, { value: 'no_nominal', label: t('No nominal') }, { value: 'internal', label: t('Interno CyberArk') }];

function AccountTypes({ safe, canManage, saving, onChange }: { safe: SafeRow; canManage: boolean; saving: boolean; onChange: (value: 'nominal' | 'no_nominal' | 'internal') => Promise<void> }) {
  const entries = Object.entries(safe.account_type_counts || {});
  return <div className="account-type-list" onClick={(event) => event.stopPropagation()}><CompactSelect className="inline-select account-type-select" value={safe.account_type_classification || ''} ariaLabel={t('Tipo de cuenta de {safe_name}', { safe_name: safe.safe_name })} disabled={!canManage || saving} options={ACCOUNT_TYPE_OPTIONS} onChange={(value) => { if (value) void onChange(value as 'nominal' | 'no_nominal' | 'internal'); }} />{entries.length ? entries.map(([key]) => <span className={'account-type-chip ' + accountTypeTone(key)} key={key}>{key}</span>) : null}</div>;
}

export const SafeTableRow = memo(function SafeTableRow({
  safe, selected, checked, bulkDisabled, assignment, assignmentChanged, expanded, accounts, accountsTotal, accountsLoading, accountsError, accountSearch,
  unitOptions, responsibleOptions, actionOptions, saving, saved, onSelect, onToggleCheck, onToggleAccounts, onRetryAccounts, onAssignmentChange, onAssignmentSave,
  onQuickUpdate, onAddBusinessUnit, onAddResponsible, onAccountTypeChange, canManage,
}: SafeTableRowProps) {
  const currentAction = actionLabel(safe.next_action);
  const availableActions = Array.from(new Set([...nextActionOptions.map(actionLabel), ...actionOptions, ...(currentAction !== 'Sin definir' ? [currentAction] : [])]));
  const updateAssignment = (updates: Partial<Assignment>) => onAssignmentChange(safe.safe_number, { ...assignment, ...updates });

  return <Fragment>
    <tr className={[selected && 'selected', assignmentChanged && 'has-pending-changes', saving && 'is-saving', saved && 'just-saved'].filter(Boolean).join(' ')} onClick={() => onSelect(safe.safe_number)} onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) { event.preventDefault(); onSelect(safe.safe_number); } }} tabIndex={0}>
      <td><div className="safe-name-row"><input type="checkbox" className="row-select-checkbox" checked={checked} disabled={bulkDisabled} aria-label={'Seleccionar ' + safe.safe_name} onClick={(event) => event.stopPropagation()} onChange={() => onToggleCheck(safe.safe_number)} /><span className="safe-name">{safe.internal_name || safe.safe_name}</span>{currentAction === 'Dar de baja' ? <span className="safe-decommission-indicator" title={t('Marcado para dar de baja')} aria-label={t('Marcado para dar de baja')}><Trash2 size={13} aria-hidden /></span> : null}</div><div className="safe-identity-meta"><span className="safe-id">#{safe.safe_number} / {safe.safe_url_id}</span>{(safe.workflow_status === 'retention_hold' || currentAction === 'Dar de baja') && <span className="safe-id safe-retention" title={t('Retención informada por CyberArk; no es una fecha de borrado')}>{retentionLabel(safe.number_of_days_retention, safe.number_of_versions_retention)}</span>}{showsRetiredAccounts(safe) && <span className="safe-id safe-retention" title={t('Cuentas que CyberArk ya no informa; su retención puede impedir borrar la Safe. La fecha es cuando Custodia lo detectó, no cuando se borraron · {last_account_retired_at}', { last_account_retired_at: dateTimeHint(safe.last_account_retired_at) })}>{retiredAccountsLabel(safe.retired_account_count ?? 0, safe.last_account_retired_at, formatDate)}</span>}{safe.scope_hint === 'possible_internal_accounts_safe' && <span className="scope-hint">{t('Candidato interno')}</span>}</div><button className={'account-expand ' + (expanded ? 'expanded' : '')} type="button" title={expanded ? t('Ocultar cuentas') : t('Ver cuentas')} aria-label={t('{Ver} cuentas de {safe_name}', { Ver: expanded ? t('Ocultar') : t('Ver'), safe_name: safe.safe_name })} aria-expanded={expanded} onClick={(event) => { event.stopPropagation(); onToggleAccounts(safe.safe_number); }}><ChevronDown size={14} /><span>{expanded ? t('Ocultar cuentas') : t('Ver cuentas')}</span></button></td>
      <td className="number account-count">{formatNumber(safe.account_count)}</td>
      <td className="number">{formatNumber(safe.member_count)}</td>
      <td><AccountTypes safe={safe} canManage={canManage} saving={saving} onChange={(value) => onAccountTypeChange(safe, value)} /></td>
      <td className="assignment-cell" onClick={(event) => event.stopPropagation()}><div className="assignment-control"><CompactSelect className={`inline-select assignment-select unit-select${assignment.business_unit_id ? '' : ' is-unassigned'}`} value={assignment.business_unit_id ? String(assignment.business_unit_id) : ''} ariaLabel={t('Unidad de ') + safe.safe_name} disabled={saving} onAdd={onAddBusinessUnit} addLabel="Agregar unidad" options={unitOptions} onChange={(value) => updateAssignment({ business_unit_id: value ? Number(value) : null })} /></div></td>
      <td className="assignment-cell" onClick={(event) => event.stopPropagation()}><div className="assignment-control"><CompactSelect className="inline-select assignment-select responsible-select" value={assignment.responsible_id ? String(assignment.responsible_id) : ''} ariaLabel={t('Responsable de ') + safe.safe_name} disabled={saving} onAdd={onAddResponsible} addLabel="Agregar responsable" options={responsibleOptions} onChange={(value) => updateAssignment({ responsible_id: value ? Number(value) : null })} />{assignmentChanged && <button className="button primary assignment-save-btn" type="button" title={t('Cambios sin guardar en la asignación')} aria-label={t('Guardar asignación de ') + safe.safe_name} disabled={saving} onClick={() => void onAssignmentSave(safe.safe_number, assignment)}><Save size={13} aria-hidden="true" /> {t('Guardar')}</button>}</div></td>
      <td onClick={(event) => event.stopPropagation()}><CompactSelect className={`inline-select status-select ${safe.workflow_status}`} value={safe.workflow_status} ariaLabel={t('Estado de {safe_name}', { safe_name: safe.safe_name })} disabled={saving} options={workflowStatusesFor(safe.workflow_status).map((status) => ({ value: status, label: workflowLabel(status) }))} onChange={(value) => onQuickUpdate(safe, { workflow_status: value as WorkflowStatus })} /></td>
      <td onClick={(event) => event.stopPropagation()}><CompactSelect className={`inline-select action-select ${actionTone(currentAction)}`} value={safe.workflow_status === 'resolved' ? '' : (safe.next_action ? actionLabel(safe.next_action) : '')} ariaLabel={t('Accion siguiente de {safe_name}', { safe_name: safe.safe_name })} disabled={saving || safe.workflow_status === 'resolved'} options={[{ value: '', label: safe.workflow_status === 'resolved' ? t('Sin acción') : t('Sin definir') }, ...availableActions.map((action) => ({ value: action, label: t(action) }))]} onChange={(value) => onQuickUpdate(safe, { next_action: value || null })} /></td>
    </tr>
    {expanded && <tr className="account-subrow"><td colSpan={8}><div className="account-subrow-grid"><div className="account-subrow-content">
      {accountsError
        ? <StateBlock variant="error" title={t('No se pudieron cargar las cuentas')} hint={accountsError} action={<button type="button" className="button subtle" onClick={() => onRetryAccounts(safe.safe_number)}>{t('Reintentar')}</button>} />
        : accountsLoading
          ? <StateBlock variant="loading" title={t('Cargando cuentas...')} />
          : accounts.length
            ? <>
                <div className="account-inline-list">
                  <div className="account-inline-row account-inline-header" aria-hidden="true"><span>{t('Nombre')}</span><span>{t('Cuenta')}</span><span>{t('Plataforma')}</span><span>{t('Dirección IP')}</span><span>{t('Gestión automática')}</span><span>{t('Estado CPM')}</span><span>{t('Último cambio de secreto o alta')}</span></div>
                  {accounts.map((account) => {
                    const query = accountSearch.toLocaleLowerCase();
                    const matchesQuery = query && [account.account_name, account.user_name, account.address]
                      .some((value) => value?.toLocaleLowerCase().includes(query));
                    return <div className={'account-inline-row' + (matchesQuery ? ' account-inline-row-match' : '')} key={account.account_id}>
                    <strong>{account.account_name}</strong>
                    <span>{account.user_name || t('Sin usuario')}</span>
                    <span>{account.platform_name || account.platform_id || t('Sin plataforma')}</span>
                    <span>{account.address || t('Sin dirección')}</span>
                    <StatusBadge tone={automaticManagementTone(account.attributes.automatic_management_enabled)}>{automaticManagementLabel(account.attributes.automatic_management_enabled)}</StatusBadge>
                    <StatusBadge tone={managementStatusTone(account.attributes.management_status)}>{managementStatusLabel(account.attributes.management_status)}</StatusBadge>
                    <span><DateTime value={account.attributes.secret_modified_at} /></span>
                    </div>;
                  })}
                </div>
                {accountsTotal > accounts.length && <span className="muted account-truncated-note">{t('Mostrando las primeras {accounts} de {accountsTotal} cuentas. Usá la vista "Cuentas" para ver el resto.', { accounts: accounts.length, accountsTotal: accountsTotal })}</span>}
              </>
            : <StateBlock variant="empty" title={accountSearch ? t('Sin cuentas que coincidan') : t('Sin cuentas activas registradas')} />}
      {showsRetiredAccounts(safe) && <RetiredAccountsSection safeNumber={safe.safe_number} />}
    </div></div></td></tr>}
  </Fragment>;
});
