import { useRef, useState, type ReactNode } from 'react';
import { ChevronRight, Search, X } from 'lucide-react';
import { CompactSelect } from '../../../cross/components/compact-select';
import { TablePagination } from '../../../cross/components/table-pagination';
import { StateBlock } from '../../../cross/components/state-block';
import { IdentityChip, StatusBadge, TagChip, TagChipList } from '../../../cross/components/semantic';
import { useDialogFocusTrap } from '../../../cross/hooks/use-dialog-focus-trap';
import { useSia } from '../hooks/use-sia';
import { resultCountLabel, siaPolicyStatusLabel } from '../../../cross/lib/format';
import { StatusGlossary } from '../../../cross/components/status-glossary';
import type { WorkspaceView } from '../../../cross/lib/workspaces';
import { siaGranteeTarget, type SiaGranteeKind } from '../lib/sia-grantee';
import { SiaGranteeDetail } from './sia-grantee-detail';
import { CopyIdButton } from '../../../cross/components/copy-id-button';
import { BarCell } from '../../../cross/components/bar-cell';
import { barShare } from '../../../cross/lib/bar-share';
import { policyTargetSummary } from '../lib/sia-format';
import './sia-workspace.css';
import type { SiaPolicyRow } from '../types/sia';
import { t } from '../../../cross/i18n/index.ts';


type Grantee = { name: string; kind: SiaGranteeKind; total: number };

function leadGrantee(policy: SiaPolicyRow): Grantee | null {
  const { granted_users: users, granted_groups: groups, granted_roles: roles } = policy.attributes;
  const total = users.length + groups.length + roles.length;
  if (!total) return null;
  if (users.length) return { name: users[0], kind: 'user', total };
  if (groups.length) return { name: groups[0], kind: 'group', total };
  const target = siaGranteeTarget(roles[0], 'role');
  return { name: roles[0], kind: target.kind, total };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

function operatorLabel(value: unknown): string {
  const labels: Record<string, string> = { EXACTLY: 'Coincidencia exacta', PREFIX: t('Comienza con'), WILDCARD: t('Patrón comodín') };
  return typeof value === 'string' ? labels[value] || value : '';
}

const linkageLabels = { linked: t('Vinculada por IP'), multiple: t('Múltiples Safes'), unlinked: t('Sin coincidencia') } as const;
const linkageTones = { linked: 'success', multiple: 'warning', unlinked: 'neutral' } as const;

function AssetRule({ value, kind }: { value: unknown; kind: 'ip' | 'fqdn' | 'logical' }): ReactNode {
  if (typeof value === 'string') return <TagChip label={value} />;
  const rule = recordValue(value);
  if (!rule) return <span className="muted">{t('Sin valor')}</span>;
  if (kind === 'ip') {
    const ips = stringValues(rule.ipAddresses);
    const visibleIps = ips.slice(0, 8);
    return <div className="sia-rule-card"><div className="sia-rule-values">{visibleIps.length ? visibleIps.map((ip) => <TagChip key={ip} label={ip} />) : <span className="muted">{t('Sin IP informada')}</span>}{ips.length > visibleIps.length && <TagChip label={`+${ips.length - visibleIps.length} IPs`} />}</div><div className="sia-rule-meta">{operatorLabel(rule.operator) && <span>{operatorLabel(rule.operator)}</span>}{textValue(rule.logicalName) && <span>{t('Nombre lógico:')} <strong>{textValue(rule.logicalName)}</strong></span>}</div></div>;
  }
  if (kind === 'fqdn') return <div className="sia-rule-card"><div className="sia-rule-meta"><span>Dominio: <strong>{textValue(rule.domain) || 'No informado'}</strong></span><span>{t('Patrón:')} <strong>{textValue(rule.computernamePattern) || 'No informado'}</strong></span>{operatorLabel(rule.operator) && <span>{operatorLabel(rule.operator)}</span>}</div></div>;
  return <div className="sia-rule-card"><div className="sia-rule-meta"><span>{t('Nombre lógico:')} <strong>{textValue(rule.logicalName) || 'No informado'}</strong></span></div></div>;
}

function AssetRules({ values, kind }: { values: unknown[]; kind: 'ip' | 'fqdn' | 'logical' }) {
  const visible = values.slice(0, 5);
  return <div className="sia-rule-list">{visible.map((value, index) => <AssetRule key={`${kind}-${index}`} value={value} kind={kind} />)}{values.length > visible.length && <span className="sia-expand-note">+{values.length - visible.length} reglas adicionales ocultas</span>}</div>;
}

const granteeKindLabel: Record<Grantee['kind'], string> = { user: 'usuario', group: 'grupo', role: 'rol' };

/* Row-level summary of what a policy grants access to: the first declared
   destination plus how many more of each kind SIA reported. */
function PolicyTargets({ policy }: { policy: SiaPolicyRow }) {
  const { ips, fqdnCount, firstFqdn, logicalCount, firstLogical } = policyTargetSummary(policy.attributes);
  const lead = ips[0] || firstFqdn || firstLogical;
  if (!lead) return <span className="muted">{t('Sin destinos')}</span>;
  const parts = [
    ips.length ? `${ips.length} ${ips.length === 1 ? 'IP' : 'IPs'}` : '',
    fqdnCount ? `${fqdnCount} FQDN` : '',
    logicalCount ? `${logicalCount} ${logicalCount === 1 ? t('nombre lógico') : t('nombres lógicos')}` : '',
  ].filter(Boolean);
  return <span className="cell-stack">
    <span className="cell-lead mono sia-target-lead" title={ips.length ? ips.join(', ') : lead}>{lead}</span>
    <span className="cell-sub">{parts.join(' · ')}</span>
  </span>;
}

type SiaWorkspaceProps = {
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  initialQuery?: string;
  onNavigate: (view: WorkspaceView, query?: string) => void;
};

function SiaPolicyDrawer({ policy, onClose, onNavigate }: { policy: SiaPolicyRow; onClose: () => void; onNavigate: (view: WorkspaceView, query?: string) => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogFocusTrap<HTMLDivElement>({ onClose, initialFocusRef: closeRef });
  const ipRules = policy.attributes.ip_rules || [];
  const fqdnRules = policy.attributes.fqdn_rules || [];
  const logicalNames = policy.attributes.logical_names || [];
  const linkedSafes = policy.linked_safes || [];
  const linkageStatus = policy.linkage_status || (linkedSafes.length > 1 ? 'multiple' : linkedSafes.length ? 'linked' : 'unlinked');
  const hasTargets = ipRules.length > 0 || fqdnRules.length > 0 || logicalNames.length > 0;
  return <div ref={dialogRef} id={`sia-policy-detail-${policy.object_id}`} className="drawer-layer" role="dialog" aria-modal="true" aria-labelledby="sia-policy-title" tabIndex={-1}>
    <button type="button" className="drawer-backdrop" aria-label={t('Cerrar detalle de política SIA')} onClick={onClose} />
    <aside className="detail-drawer sia-policy-drawer">
      <div className="detail-title"><div className="detail-heading"><h2 id="sia-policy-title">{policy.display_name}</h2></div><StatusGlossary scope="sia_policy" /><button ref={closeRef} type="button" className="icon-button drawer-close" aria-label="Cerrar" onClick={onClose}><X size={16} aria-hidden /></button></div>
      <section className="detail-section sia-policy-detail">
        <div className="sia-policy-summary">
          <StatusBadge tone={policy.attributes.status === 'Enabled' ? 'success' : 'neutral'}>{siaPolicyStatusLabel(policy.attributes.status)}</StatusBadge>
          {policy.attributes.policy_type && <TagChip label={policy.attributes.policy_type} />}
          <span className="sia-policy-id"><span className="muted">{t('ID de política')}</span> <span className="mono">{policy.source_id}</span><CopyIdButton value={policy.source_id} /></span>
        </div>
        {policy.attributes.description && <p className="detail-summary-copy">{policy.attributes.description}</p>}

        <div className="sia-drawer-section">
          <h3 className="sia-expand-label">Destinos</h3>
          {hasTargets
            ? <>
                {ipRules.length > 0 && <div className="sia-asset-group"><strong>Por IP</strong><AssetRules values={ipRules} kind="ip" /></div>}
                {fqdnRules.length > 0 && <div className="sia-asset-group"><strong>Por FQDN</strong><AssetRules values={fqdnRules} kind="fqdn" /></div>}
                {logicalNames.length > 0 && <div className="sia-asset-group"><strong>{t('Por nombre lógico')}</strong><AssetRules values={logicalNames} kind="logical" /></div>}
              </>
            : <p className="sia-drawer-empty">{t('La política no declara destinos por IP, FQDN ni nombre lógico.')}</p>}
        </div>

        <div className="sia-drawer-section">
          <div className="sia-drawer-section-head">
            <h3 className="sia-expand-label">{t('Safes vinculables por IP')}</h3>
            <StatusBadge tone={linkageTones[linkageStatus]}>{linkageLabels[linkageStatus]}</StatusBadge>
          </div>
          {linkedSafes.length
            ? <div className="sia-linked-safe-list">{linkedSafes.map((safe) => <div className="sia-linked-safe" key={safe.safe_number}><button type="button" className="sia-linked-safe-link" onClick={(event) => { event.stopPropagation(); onNavigate('safes', safe.safe_name); }}><span>{safe.safe_name}</span><small>{safe.matched_ips.join(', ')}</small></button>{(safe.accounts || []).length > 0 && <div className="sia-linked-account-list">{(safe.accounts || []).map((account) => <span className="sia-linked-account" key={`${safe.safe_number}-${account.account_id}`}><strong>{account.account_name || account.account_id}</strong><small>{account.address || t('Sin dirección')}{account.platform_name ? ` · ${account.platform_name}` : ''}</small></span>)}</div>}</div>)}</div>
            : <p className="sia-drawer-empty">{t('No se encontró una cuenta activa con la misma IP.')}</p>}
        </div>

        <div className="sia-drawer-section"><SiaGranteeDetail policy={policy} onNavigate={onNavigate} /></div>

        <div className="sia-drawer-section"><h3 className="sia-expand-label">Targets declarados</h3><TagChipList values={policy.attributes.platforms} max={policy.attributes.platforms.length || 1} /></div>
        <div className="sia-drawer-section"><h3 className="sia-expand-label">{t('Reglas de acceso')}</h3>{policy.attributes.rule_names.length ? <div className="tag-chip-list">{policy.attributes.rule_names.map((name) => <TagChip key={name} label={name} />)}</div> : <p className="sia-drawer-empty">{t('Sin nombres de regla informados')}</p>}</div>
        <div className="sia-sidebar-actions"><button type="button" className="button subtle" onClick={() => onNavigate('safes', policy.display_name)}>{t('Buscar coincidencia en Safes')}</button></div>
      </section>
    </aside>
  </div>;
}

export function SiaWorkspace({ authChecked, authenticated, onUnauthorized, onError, initialQuery, onNavigate }: SiaWorkspaceProps) {
  const { search, setSearch, statusFilter, setStatusFilter, linkageFilter, setLinkageFilter, page, setPage, loading, policies, total, loadError, reload } = useSia({
    authChecked, authenticated, onUnauthorized, onError, initialQuery,
  });
  const [selectedPolicy, setSelectedPolicy] = useState<SiaPolicyRow | null>(null);
  const hasFilters = Boolean(search || statusFilter || linkageFilter);
  const maxLinked = Math.max(0, ...policies.map((policy) => (policy.linked_safes || []).length));

  return <>
    <div className="sia-policies-layout"><section className="list-panel database-surface">
      <div className="search-row">
        <label className="search-box">
          <Search size={16} />
          <input type="search" aria-label={t('Buscar políticas SIA por nombre o descripción')} placeholder={t('Buscar por nombre o descripción')} value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <CompactSelect
          className="inline-select"
          value={statusFilter}
          ariaLabel={t('Filtrar políticas SIA por estado')}
          options={[{ value: '', label: t('Todos los estados') }, { value: 'Enabled', label: 'Habilitada' }, { value: 'Disabled', label: 'Deshabilitada' }]}
          onChange={setStatusFilter}
        />
        <CompactSelect
          className="inline-select"
          value={linkageFilter}
          ariaLabel={t('Filtrar políticas SIA por vinculación con Safes')}
          options={[{ value: '', label: t('Todas las vinculaciones') }, { value: 'linked', label: t('Vinculadas por IP') }, { value: 'multiple', label: t('Múltiples Safes') }, { value: 'unlinked', label: t('Sin coincidencia') }]}
          onChange={setLinkageFilter}
        />
        <span className="database-toolbar-count sia-policies-count" aria-live="polite">{resultCountLabel(total)}</span>
      </div>

      <div className="compact-table-wrap"><table className="compact-table sia-policies-table"><thead><tr><th /><th>{t('Política')}</th><th>{t('Estado')}</th><th>Destinos</th><th title={t('Safes con una cuenta activa en alguna IP de la política')}>{t('Safes por IP')}</th><th title={t('Los destinatarios de SIA son referencias por nombre')}>Otorgado a</th></tr></thead><tbody>
        {loading
          ? <tr><td colSpan={6}><StateBlock variant="loading" title={t('Cargando políticas…')} /></td></tr>
          : loadError
            ? <tr><td colSpan={6}><StateBlock variant="error" title={t('No se pudo conectar con SIA')} hint={loadError} action={<button type="button" className="button subtle" onClick={() => void reload()}>Reintentar</button>} /></td></tr>
            : policies.length
              ? policies.map((policy) => {
                  const isExpanded = selectedPolicy?.object_id === policy.object_id;
                  const grantee = leadGrantee(policy);
                  const enabled = policy.attributes.status === 'Enabled';
                  const linkedSafes = policy.linked_safes || [];
                  const linkageStatus = policy.linkage_status || (linkedSafes.length > 1 ? 'multiple' : linkedSafes.length ? 'linked' : 'unlinked');
                  const platforms = policy.attributes.platforms;
                  return <tr key={policy.object_id} className={isExpanded ? 'selected' : ''} onClick={() => setSelectedPolicy(policy)} style={{ cursor: 'pointer' }}>
                      <td><button type="button" className="row-expand-button" aria-haspopup="dialog" aria-expanded={isExpanded} aria-controls={`sia-policy-detail-${policy.object_id}`} aria-label={t('Ver detalle de {display_name}', { display_name: policy.display_name })} title={t('Ver detalle')} onClick={(event) => { event.stopPropagation(); setSelectedPolicy(policy); }}><ChevronRight size={14} aria-hidden /></button></td>
                      <td><span className="cell-stack">
                        <span className="cell-lead">{policy.display_name}</span>
                        <span className="sia-policy-meta">
                          {policy.attributes.policy_type && <TagChip label={policy.attributes.policy_type} />}
                          {platforms.length ? <span className="cell-sub" title={platforms.join(', ')}>{platforms.slice(0, 3).join(' · ')}{platforms.length > 3 ? ` +${platforms.length - 3}` : ''}</span> : null}
                        </span>
                      </span></td>
                      <td><StatusBadge tone={enabled ? 'success' : 'neutral'}>{siaPolicyStatusLabel(policy.attributes.status)}</StatusBadge></td>
                      <td><PolicyTargets policy={policy} /></td>
                      <td><span className="cell-stack sia-safe-cell">
                        {linkedSafes.length
                          ? <><BarCell label={linkedSafes.length} share={barShare(linkedSafes.length, maxLinked)} /><span className="cell-sub" title={linkedSafes.map((safe) => safe.safe_name).join(', ')}>{linkedSafes[0].safe_name}{linkedSafes.length > 1 ? ` +${linkedSafes.length - 1}` : ''}</span></>
                          : <StatusBadge tone={linkageTones[linkageStatus]}>{linkageLabels[linkageStatus]}</StatusBadge>}
                      </span></td>
                      <td>{grantee
                        ? <IdentityChip name={grantee.name} kind={grantee.kind} subtitle={`${t(granteeKindLabel[grantee.kind])} · ${t('por nombre')}${grantee.total > 1 ? ` · ${t('+{n} más', { n: grantee.total - 1 })}` : ''}`} />
                        : <span className="muted">Sin dato</span>}</td>
                    </tr>;
                })
              : <tr><td colSpan={6}><StateBlock variant={hasFilters ? 'no-results' : 'empty'} title={hasFilters ? t('Sin políticas para estos filtros') : t('Sin políticas de acceso registradas')} compact action={hasFilters ? <button type="button" className="button subtle" onClick={() => { setSearch(''); setStatusFilter(''); setLinkageFilter(''); }}>Limpiar filtros</button> : undefined} /></td></tr>}
      </tbody></table></div>

      <TablePagination page={page} pageSize={50} total={total} onPageChange={setPage} />
    </section></div>
    {selectedPolicy ? <SiaPolicyDrawer key={selectedPolicy.object_id} policy={selectedPolicy} onClose={() => setSelectedPolicy(null)} onNavigate={onNavigate} /> : null}
  </>;
}
