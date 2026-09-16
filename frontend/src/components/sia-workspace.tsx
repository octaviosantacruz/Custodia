import { Fragment, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { CompactSelect } from './compact-select';
import { TablePagination } from './table-pagination';
import { StateBlock } from './state-block';
import { IdentityChip, StatusBadge, TagChip, TagChipList } from './semantic';
import { useSia } from '../hooks/use-sia';
import { resultCountLabel, siaPolicyStatusLabel } from '../lib/format';
import { StatusGlossary } from './status-glossary';
import type { WorkspaceView } from '../lib/workspaces';
import { siaGranteeTarget, type SiaGranteeKind } from '../lib/sia-grantee';
import type { SiaPolicyRow } from '../types/sia';


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

function activateRow(event: KeyboardEvent<HTMLTableRowElement>, activate: () => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    activate();
  }
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
  const labels: Record<string, string> = { EXACTLY: 'Coincidencia exacta', PREFIX: 'Comienza con', WILDCARD: 'Patrón comodín' };
  return typeof value === 'string' ? labels[value] || value : '';
}

const linkageLabels = { linked: 'Vinculada por IP', multiple: 'Múltiples Safes', unlinked: 'Sin coincidencia' } as const;
const linkageTones = { linked: 'success', multiple: 'warning', unlinked: 'neutral' } as const;

function AssetRule({ value, kind }: { value: unknown; kind: 'ip' | 'fqdn' | 'logical' }): ReactNode {
  if (typeof value === 'string') return <TagChip label={value} />;
  const rule = recordValue(value);
  if (!rule) return <span className="muted">Sin valor</span>;
  if (kind === 'ip') {
    const ips = stringValues(rule.ipAddresses);
    const visibleIps = ips.slice(0, 8);
    return <div className="sia-rule-card"><div className="sia-rule-values">{visibleIps.length ? visibleIps.map((ip) => <TagChip key={ip} label={ip} />) : <span className="muted">Sin IP informada</span>}{ips.length > visibleIps.length && <TagChip label={`+${ips.length - visibleIps.length} IPs`} />}</div><div className="sia-rule-meta">{operatorLabel(rule.operator) && <span>{operatorLabel(rule.operator)}</span>}{textValue(rule.logicalName) && <span>Nombre lógico: <strong>{textValue(rule.logicalName)}</strong></span>}</div></div>;
  }
  if (kind === 'fqdn') return <div className="sia-rule-card"><div className="sia-rule-meta"><span>Dominio: <strong>{textValue(rule.domain) || 'No informado'}</strong></span><span>Patrón: <strong>{textValue(rule.computernamePattern) || 'No informado'}</strong></span>{operatorLabel(rule.operator) && <span>{operatorLabel(rule.operator)}</span>}</div></div>;
  return <div className="sia-rule-card"><div className="sia-rule-meta"><span>Nombre lógico: <strong>{textValue(rule.logicalName) || 'No informado'}</strong></span></div></div>;
}

function AssetRules({ values, kind }: { values: unknown[]; kind: 'ip' | 'fqdn' | 'logical' }) {
  const visible = values.slice(0, 5);
  return values.length ? <div className="sia-rule-list">{visible.map((value, index) => <AssetRule key={`${kind}-${index}`} value={value} kind={kind} />)}{values.length > visible.length && <span className="sia-expand-note">+{values.length - visible.length} reglas adicionales ocultas</span>}</div> : <span className="muted">Sin datos</span>;
}

const granteeKindLabel: Record<Grantee['kind'], string> = { user: 'usuario', group: 'grupo', role: 'rol' };

type SiaWorkspaceProps = {
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  initialQuery?: string;
  onNavigate: (view: WorkspaceView, query?: string) => void;
};

export function SiaWorkspace({ authChecked, authenticated, onUnauthorized, onError, initialQuery, onNavigate }: SiaWorkspaceProps) {
  const { search, setSearch, statusFilter, setStatusFilter, linkageFilter, setLinkageFilter, page, setPage, loading, policies, total, loadError, expanded, toggleExpanded, reload } = useSia({
    authChecked, authenticated, onUnauthorized, onError, initialQuery,
  });
  const [selectedPolicy, setSelectedPolicy] = useState<SiaPolicyRow | null>(null);
  const hasFilters = Boolean(search || statusFilter || linkageFilter);

  return <>
    <section className="database-toolbar">
      <div>
        <h2>Políticas de acceso</h2>
        <span className="database-caption">Políticas de acceso SIA. Explorá quién recibe acceso y buscá coincidencias en Identidades y Safes.</span>
      </div>
      <div className="database-toolbar-actions">
        <StatusGlossary scope="sia_policy" />
        <span className="database-toolbar-count">{resultCountLabel(total)}</span>
      </div>
    </section>
    <div className="sia-policies-layout"><section className="list-panel database-surface">
      <div className="search-row">
        <label className="search-box">
          <Search size={16} />
          <input type="search" aria-label="Buscar políticas SIA por nombre o descripción" placeholder="Buscar por nombre o descripción" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <CompactSelect
          className="inline-select"
          value={statusFilter}
          ariaLabel="Filtrar políticas SIA por estado"
          options={[{ value: '', label: 'Todos los estados' }, { value: 'Enabled', label: 'Habilitada' }, { value: 'Disabled', label: 'Deshabilitada' }]}
          onChange={setStatusFilter}
        />
        <CompactSelect
          className="inline-select"
          value={linkageFilter}
          ariaLabel="Filtrar políticas SIA por vinculación con Safes"
          options={[{ value: '', label: 'Todas las vinculaciones' }, { value: 'linked', label: 'Vinculadas por IP' }, { value: 'multiple', label: 'Múltiples Safes' }, { value: 'unlinked', label: 'Sin coincidencia' }]}
          onChange={setLinkageFilter}
        />
      </div>

      <div className="compact-table-wrap"><table className="compact-table"><thead><tr><th /><th>Política</th><th>Estado</th><th>Plataformas</th><th>Vinculación</th><th>Safes vinculables</th><th>Otorgado a</th></tr></thead><tbody>
        {loading
          ? <tr><td colSpan={7}><StateBlock variant="loading" title="Cargando políticas…" /></td></tr>
          : loadError
            ? <tr><td colSpan={7}><StateBlock variant="error" title="No se pudo conectar con SIA" hint={loadError} action={<button type="button" className="button subtle" onClick={() => void reload()}>Reintentar</button>} /></td></tr>
            : policies.length
              ? policies.map((policy) => {
                  const isExpanded = expanded.has(policy.object_id);
                  const grantee = leadGrantee(policy);
                  const enabled = policy.attributes.status === 'Enabled';
                  const ipRules = policy.attributes.ip_rules || [];
                  const fqdnRules = policy.attributes.fqdn_rules || [];
                  const logicalNames = policy.attributes.logical_names || [];
                  const linkedSafes = policy.linked_safes || [];
                  const linkageStatus = policy.linkage_status || (linkedSafes.length > 1 ? 'multiple' : linkedSafes.length ? 'linked' : 'unlinked');
                  return <Fragment key={policy.object_id}>
                    <tr className={isExpanded || selectedPolicy?.object_id === policy.object_id ? 'selected' : ''} onClick={() => { setSelectedPolicy(policy); toggleExpanded(policy.object_id); }} onKeyDown={(event) => activateRow(event, () => { setSelectedPolicy(policy); toggleExpanded(policy.object_id); })} tabIndex={0} aria-expanded={isExpanded} aria-label={`${policy.display_name}: ${isExpanded ? 'ocultar' : 'ver'} detalle`} style={{ cursor: 'pointer' }}>
                      <td>{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                      <td><span className="cell-stack"><span className="cell-lead">{policy.display_name}</span><span className="cell-sub">{policy.attributes.policy_type || 'policy'}</span></span></td>
                      <td><StatusBadge tone={enabled ? 'success' : 'neutral'}>{siaPolicyStatusLabel(policy.attributes.status)}</StatusBadge></td>
                      <td><TagChipList values={policy.attributes.platforms} max={3} /></td>
                      <td><StatusBadge tone={linkageTones[linkageStatus]}>{linkageLabels[linkageStatus]}</StatusBadge></td>
                      <td>{linkedSafes.length ? <><span className="sia-destination-count">{linkedSafes.length}</span><span className="cell-sub">{linkedSafes[0].safe_name}{linkedSafes.length > 1 ? ` +${linkedSafes.length - 1}` : ''}</span></> : <span className="muted">Sin coincidencia IP</span>}</td>
                      <td>{grantee
                        ? <IdentityChip name={grantee.name} kind={grantee.kind} subtitle={grantee.total > 1 ? `${granteeKindLabel[grantee.kind]} · +${grantee.total - 1} más` : granteeKindLabel[grantee.kind]} />
                        : <span className="muted">Sin dato</span>}</td>
                    </tr>
                    {isExpanded && <tr><td /><td colSpan={6}>
                      {policy.attributes.description && <p className="detail-summary-copy">{policy.attributes.description}</p>}
                      <div className="sia-expand-grid">
                        <div>
                          <span className="sia-expand-label">Identificación</span>
                          <dl className="sia-fact-list">
                            <div><dt>ID de política</dt><dd className="mono">{policy.source_id}</dd></div>
                            <div><dt>Tipo</dt><dd>{policy.attributes.policy_type || 'No informado'}</dd></div>
                          </dl>
                        </div>
                        <div className="sia-destinations-panel">
                          <span className="sia-expand-label">Destinos / assets</span>
                          <div className="sia-asset-group"><strong>IP rules</strong><AssetRules values={ipRules} kind="ip" /></div>
                          <div className="sia-asset-group"><strong>FQDN rules</strong><AssetRules values={fqdnRules} kind="fqdn" /></div>
                          <div className="sia-asset-group"><strong>Nombres lógicos</strong><AssetRules values={logicalNames} kind="logical" /></div>
                        </div>
                        <div className="sia-destinations-panel sia-linked-safes-panel">
                          <span className="sia-expand-label">Safes vinculables por IP</span>
                          {linkedSafes.length ? <div className="sia-linked-safe-list">{linkedSafes.map((safe) => <div className="sia-linked-safe" key={safe.safe_number}><button type="button" className="pam-role-safe-link" onClick={(event) => { event.stopPropagation(); onNavigate('safes', safe.safe_name); }}><span>{safe.safe_name}</span><small>{safe.matched_ips.join(', ')}</small></button><div className="sia-linked-account-list">{(safe.accounts || []).map((account) => <span className="sia-linked-account" key={`${safe.safe_number}-${account.account_id}`}><strong>{account.account_name || account.account_id}</strong><small>{account.address || 'Sin dirección'}{account.platform_name ? ` · ${account.platform_name}` : ''}</small></span>)}</div></div>)}</div> : <span className="muted">No se encontró una cuenta activa con la misma IP.</span>}
                        </div>
                        <div>
                          <span className="sia-expand-label">Reglas de acceso</span>
                          {policy.attributes.rule_names.length
                            ? <div className="tag-chip-list">{policy.attributes.rule_names.map((name) => <TagChip key={name} label={name} />)}</div>
                            : <span className="muted">Sin nombres de regla informados</span>}
                        </div>
                        <div>
                          <span className="sia-expand-label">Otorgado a</span>
                          {(policy.attributes.granted_users.length + policy.attributes.granted_groups.length + policy.attributes.granted_roles.length)
                            ? <div className="sia-grantee-list">
                                {policy.attributes.granted_users.map((name) => <IdentityChip key={`u-${name}`} name={name} kind="user" subtitle="usuario · buscar en Identidades" onSelect={() => onNavigate('identityUsers', name)} />)}
                                {policy.attributes.granted_groups.map((name) => <IdentityChip key={`g-${name}`} name={name} kind="group" subtitle="grupo · buscar en Identidades" onSelect={() => onNavigate('identityGroups', name)} />)}
                                {policy.attributes.granted_roles.map((name) => { const target = siaGranteeTarget(name, 'role'); return <IdentityChip key={`r-${name}`} name={name} kind={target.kind} subtitle={target.kind === 'group' ? 'grupo Okta · buscar en Identidades' : 'rol · buscar en Identidades'} onSelect={() => onNavigate(target.view, name)} />; })}
                              </div>
                            : <span className="muted">Sin usuarios, roles o grupos otorgados</span>}
                        </div>
                      </div>
                    </td></tr>}
                  </Fragment>;
                })
              : <tr><td colSpan={7}><StateBlock variant={hasFilters ? 'no-results' : 'empty'} title={hasFilters ? 'Sin políticas para estos filtros' : 'Sin políticas de acceso registradas'} hint={hasFilters ? 'Ajustá la búsqueda o los filtros de vinculación.' : 'SIA está conectado pero todavía no devolvió políticas.'} action={hasFilters ? <button type="button" className="button subtle" onClick={() => { setSearch(''); setStatusFilter(''); setLinkageFilter(''); }}>Limpiar filtros</button> : undefined} /></td></tr>}
      </tbody></table></div>

      <TablePagination page={page} pageSize={50} total={total} onPageChange={setPage} />
    </section><aside className="sia-policy-sidebar database-surface" aria-label="Detalle de la política SIA">
      {selectedPolicy ? <>
        <div className="sia-sidebar-heading"><span className="sia-expand-label">Contexto de la cadena</span><button type="button" className="button subtle" onClick={() => setSelectedPolicy(null)}>Cerrar</button></div>
        <h3 className="sia-sidebar-destination">{selectedPolicy.display_name}</h3>
        <span className="sia-destination-type">{selectedPolicy.attributes.policy_type || 'Política SIA'}</span>
        <div className="sia-sidebar-section"><span className="sia-expand-label">Targets declarados</span>{selectedPolicy.attributes.platforms.length ? <div className="tag-chip-list">{selectedPolicy.attributes.platforms.map((name) => <TagChip key={name} label={name} />)}</div> : <span className="muted">Sin targets/plataformas informados</span>}</div>
        <div className="sia-sidebar-section"><span className="sia-expand-label">Vinculación con Safes</span><StatusBadge tone={linkageTones[selectedPolicy.linkage_status || ((selectedPolicy.linked_safes || []).length > 1 ? 'multiple' : (selectedPolicy.linked_safes || []).length ? 'linked' : 'unlinked')]}>{linkageLabels[selectedPolicy.linkage_status || ((selectedPolicy.linked_safes || []).length > 1 ? 'multiple' : (selectedPolicy.linked_safes || []).length ? 'linked' : 'unlinked')]}</StatusBadge>{(selectedPolicy.linked_safes || []).length ? <div className="sia-sidebar-safe-list">{(selectedPolicy.linked_safes || []).map((safe) => <button type="button" className="button subtle" key={safe.safe_number} onClick={() => onNavigate('safes', safe.safe_name)}>{safe.safe_name}</button>)}</div> : <span className="muted">No hay una cuenta activa con la misma IP.</span>}</div>
        <div className="sia-sidebar-section"><span className="sia-expand-label">Reglas de acceso</span>{selectedPolicy.attributes.rule_names.length ? <div className="tag-chip-list">{selectedPolicy.attributes.rule_names.map((name) => <TagChip key={name} label={name} />)}</div> : <span className="muted">Sin nombres de regla informados</span>}</div>
        <div className="sia-sidebar-actions"><button type="button" className="button subtle" onClick={() => onNavigate('safes', selectedPolicy.display_name)}>Buscar coincidencia en Safes</button>{selectedPolicy.attributes.granted_users[0] && <button type="button" className="button subtle" onClick={() => onNavigate('identityUsers', selectedPolicy.attributes.granted_users[0])}>Buscar usuario</button>}{selectedPolicy.attributes.granted_groups[0] && <button type="button" className="button subtle" onClick={() => onNavigate('identityGroups', selectedPolicy.attributes.granted_groups[0])}>Buscar grupo</button>}{selectedPolicy.attributes.granted_roles[0] && <button type="button" className="button subtle" onClick={() => { const name = selectedPolicy.attributes.granted_roles[0]; onNavigate(siaGranteeTarget(name, 'role').view, name); }}>{siaGranteeTarget(selectedPolicy.attributes.granted_roles[0], 'role').kind === 'group' ? 'Buscar grupo Okta' : 'Buscar rol'}</button>}</div>
        <p className="sia-sidebar-note">Las búsquedas hacia otros módulos son coincidencias por nombre. No representan una relación normalizada entre SIA y PAM.</p>
      </> : <StateBlock variant="empty" title="Seleccioná una política" hint="El contexto de targets y reglas aparecerá acá sin ocupar espacio en la tabla." />}
    </aside></div>
  </>;
}
