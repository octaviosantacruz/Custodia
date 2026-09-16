import { Fragment } from 'react';
import { ChevronDown, Save, Trash2 } from 'lucide-react';
import { CompactSelect } from './compact-select';
import { StateBlock } from './state-block';
import { actionLabel, formatNumber, nextActionOptions, workflowLabel, workflowStatusesFor } from '../lib/format';
import type { Account, Catalogs, SafeRow, WorkflowStatus } from '../types/safe';

type SafeTableCatalogs = Pick<Catalogs, 'business_units' | 'responsibles'>;

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
  catalogs: SafeTableCatalogs;
  actionOptions: string[];
  saving: boolean;
  saved: boolean;
  onSelect: () => void;
  onToggleCheck: () => void;
  onToggleAccounts: () => void;
  onRetryAccounts: () => void;
  onAssignmentChange: (assignment: Assignment) => void;
  onAssignmentSave: () => Promise<void>;
  onQuickUpdate: (updates: { workflow_status?: WorkflowStatus; next_action?: string | null }) => void;
  onAccountTypeChange: (value: 'nominal' | 'no_nominal' | 'internal') => Promise<void>;
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

function AccountTypes({ safe, canManage, saving, onChange }: { safe: SafeRow; canManage: boolean; saving: boolean; onChange: (value: 'nominal' | 'no_nominal' | 'internal') => Promise<void> }) {
  const entries = Object.entries(safe.account_type_counts || {});
  return <div className="account-type-list"><select className="safe-scope-select" aria-label={`Tipo de cuenta de ${safe.safe_name}`} value={safe.account_type_classification || ''} disabled={!canManage || saving} onClick={(event) => event.stopPropagation()} onChange={(event) => void onChange(event.target.value as 'nominal' | 'no_nominal' | 'internal')}><option value="" disabled>Seleccionar tipo</option><option value="nominal">Nominal</option><option value="no_nominal">No nominal</option><option value="internal">Interno CyberArk</option></select>{entries.length ? entries.map(([key]) => <span className={'account-type-chip ' + accountTypeTone(key)} key={key}>{key}</span>) : null}</div>;
}

export function SafeTableRow({
  safe, selected, checked, bulkDisabled, assignment, assignmentChanged, expanded, accounts, accountsTotal, accountsLoading, accountsError, catalogs,
  actionOptions, saving, saved, onSelect, onToggleCheck, onToggleAccounts, onRetryAccounts, onAssignmentChange, onAssignmentSave,
  onQuickUpdate, onAddBusinessUnit, onAddResponsible, onAccountTypeChange, canManage,
}: SafeTableRowProps) {
  const currentAction = actionLabel(safe.next_action);
  const availableActions = Array.from(new Set([...nextActionOptions.map(actionLabel), ...actionOptions, ...(currentAction !== 'Sin definir' ? [currentAction] : [])]));
  const updateAssignment = (updates: Partial<Assignment>) => onAssignmentChange({ ...assignment, ...updates });

  return <Fragment>
    <tr className={[selected && 'selected', saving && 'is-saving', saved && 'just-saved'].filter(Boolean).join(' ')} onClick={onSelect} onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) { event.preventDefault(); onSelect(); } }} tabIndex={0}>
      <td><div className="safe-name-row"><input type="checkbox" className="row-select-checkbox" checked={checked} disabled={bulkDisabled} aria-label={'Seleccionar ' + safe.safe_name} onClick={(event) => event.stopPropagation()} onChange={onToggleCheck} /><span className="safe-name">{safe.internal_name || safe.safe_name}</span>{currentAction === 'Dar de baja' ? <span className="safe-decommission-indicator" title="Marcado para dar de baja" aria-label="Marcado para dar de baja"><Trash2 size={13} aria-hidden /></span> : null}</div><span className="safe-id">#{safe.safe_number} / {safe.safe_url_id}</span>{safe.scope_hint === 'possible_internal_accounts_safe' && <span className="scope-hint">Candidato interno</span>}<button className={'account-expand ' + (expanded ? 'expanded' : '')} type="button" title={expanded ? 'Ocultar cuentas' : 'Ver cuentas'} aria-label={`${expanded ? 'Ocultar' : 'Ver'} cuentas de ${safe.safe_name}`} aria-expanded={expanded} onClick={(event) => { event.stopPropagation(); onToggleAccounts(); }}><ChevronDown size={14} /><span>{expanded ? 'Ocultar cuentas' : 'Ver cuentas'}</span></button></td>
      <td className="number account-count">{formatNumber(safe.account_count)}</td>
      <td className="number">{formatNumber(safe.member_count)}</td>
      <td><AccountTypes safe={safe} canManage={canManage} saving={saving} onChange={onAccountTypeChange} /></td>
      <td className="assignment-cell" onClick={(event) => event.stopPropagation()}><div className="assignment-control"><CompactSelect className="inline-select assignment-select unit-select" value={assignment.business_unit_id ? String(assignment.business_unit_id) : ''} ariaLabel={'Unidad de ' + safe.safe_name} disabled={saving} onAdd={onAddBusinessUnit} addLabel="Agregar unidad" options={[{ value: '', label: 'Sin asignar' }, ...catalogs.business_units.filter((unit) => unit.is_active !== false).map((unit) => ({ value: String(unit.business_unit_id), label: unit.unit_code }))]} onChange={(value) => updateAssignment({ business_unit_id: value ? Number(value) : null })} /></div></td>
      <td className="assignment-cell" onClick={(event) => event.stopPropagation()}><div className="assignment-control"><CompactSelect className="inline-select assignment-select responsible-select" value={assignment.responsible_id ? String(assignment.responsible_id) : ''} ariaLabel={'Responsable de ' + safe.safe_name} disabled={saving} onAdd={onAddResponsible} addLabel="Agregar responsable" options={[{ value: '', label: 'Sin asignar' }, ...catalogs.responsibles.filter((person) => person.is_active !== false).map((person) => ({ value: String(person.responsible_id), label: person.display_name }))]} onChange={(value) => updateAssignment({ responsible_id: value ? Number(value) : null })} /></div></td>
      <td className="assignment-save-cell" onClick={(event) => event.stopPropagation()}>{assignmentChanged && <button className="icon-button assignment-save-btn" type="button" title="Guardar asignación" aria-label={'Guardar asignación de ' + safe.safe_name} disabled={saving} onClick={() => void onAssignmentSave()}><Save size={14} /></button>}</td>
      <td onClick={(event) => event.stopPropagation()}><CompactSelect className={`inline-select status-select ${safe.workflow_status}`} value={safe.workflow_status} ariaLabel={`Estado de ${safe.safe_name}`} disabled={saving} options={workflowStatusesFor(safe.workflow_status).map((status) => ({ value: status, label: workflowLabel(status) }))} onChange={(value) => onQuickUpdate({ workflow_status: value as WorkflowStatus })} /></td>
      <td onClick={(event) => event.stopPropagation()}><CompactSelect className={`inline-select action-select ${actionTone(currentAction)}`} value={safe.workflow_status === 'resolved' ? '' : (safe.next_action ? actionLabel(safe.next_action) : '')} ariaLabel={`Accion siguiente de ${safe.safe_name}`} disabled={saving || safe.workflow_status === 'resolved'} options={[{ value: '', label: safe.workflow_status === 'resolved' ? 'Sin acción' : 'Sin definir' }, ...availableActions.map((action) => ({ value: action, label: action }))]} onChange={(value) => onQuickUpdate({ next_action: value || null })} /></td>
    </tr>
    {expanded && <tr className="account-subrow"><td colSpan={9}><div className="account-subrow-grid"><div className="account-subrow-content">
      {accountsError
        ? <StateBlock variant="error" title="No se pudieron cargar las cuentas" hint={accountsError} action={<button type="button" className="button subtle" onClick={onRetryAccounts}>Reintentar</button>} />
        : accountsLoading
          ? <StateBlock variant="loading" title="Cargando cuentas..." />
          : accounts.length
            ? <>
                <div className="account-inline-list">
                  <div className="account-inline-row account-inline-header" aria-hidden="true"><span>Nombre</span><span>Cuenta</span><span>Plataforma</span><span>Dirección IP</span></div>
                  {accounts.map((account) => <div className="account-inline-row" key={account.account_id}><strong>{account.account_name}</strong><span>{account.user_name || 'Sin usuario'}</span><span>{account.platform_name || account.platform_id || 'Sin plataforma'}</span><span>{account.address || 'Sin dirección'}</span></div>)}
                </div>
                {accountsTotal > accounts.length && <span className="muted account-truncated-note">Mostrando las primeras {accounts.length} de {accountsTotal} cuentas. Usá la vista "Cuentas" para ver el resto.</span>}
              </>
            : <StateBlock variant="empty" title="Sin cuentas activas registradas" />}
    </div></div></td></tr>}
  </Fragment>;
}
