import { Fragment, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronRight, GitBranch, Search } from 'lucide-react';
import { IdentityChip, StatusBadge, TagChip } from './semantic';
import { CompactSelect } from './compact-select';
import { StateBlock } from './state-block';
import { LoadMore } from './load-more';
import { formatNumber, resultCountLabel } from '../lib/format';
import { usePamRoles } from '../hooks/use-pam-roles';
import { classifyPamIdentity, identityChipKind, PAM_IDENTITY_KIND_LABELS, type PamIdentityKind } from '../lib/pam-identity-classification';
import type { WorkspaceView } from '../lib/workspaces';


function activateRow(event: KeyboardEvent<HTMLTableRowElement>, activate: () => void) {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); }
}

type PamRolesWorkspaceProps = {
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  onNavigate: (view: WorkspaceView, query?: string) => void;
  initialKind?: PamIdentityKind;
  title?: string;
  description?: string;
  initialQuery?: string;
  embedded?: boolean;
  includeInternal?: boolean;
};

export function PamRolesWorkspace({ authChecked, authenticated, onUnauthorized, onError, onNavigate, initialKind = 'cyberark_role', title = 'Roles CyberArk', description = 'Objetos clasificados por nombre dentro del inventario PAM. La clasificación no modifica las relaciones verificadas.', initialQuery = '', embedded = false, includeInternal = true }: PamRolesWorkspaceProps) {
  const { search, setSearch, kind, setKind, page, setPage, loading, roles, total, loadError, expanded, details, detailLoading, detailErrors, toggleExpanded, loadDetail, reload } = usePamRoles({
    authChecked, authenticated, onUnauthorized, onError, includeInternal, initialKind, initialQuery,
  });
  const isUserView = initialKind === 'user';
  const subjectLabel = initialKind === 'user' ? 'Usuario' : initialKind === 'okta_group' ? 'Grupo' : 'Rol';
  const relationLabel = isUserView ? 'Roles' : 'Usuarios';

  return <>
    {!embedded && <section className="database-toolbar">
      <div>
        <h2>{title}</h2>
        <span className="database-caption">{description}</span>
      </div>
      <div className="database-toolbar-actions"><span className="database-toolbar-count">{resultCountLabel(total)}</span></div>
    </section>}
    <section className={`list-panel database-surface${embedded ? ' pam-role-embedded-panel' : ''}`}>
      <div className="search-row">
        <label className="search-box"><Search size={16} /><input type="search" aria-label={`Buscar ${title.toLowerCase()}`} placeholder="Buscar por nombre o identificador" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        {!initialKind && <CompactSelect
          className="inline-select"
          value={kind}
          ariaLabel="Filtrar identidades por clasificación"
          options={[{ value: '', label: 'Todas las clasificaciones' }, { value: 'user', label: 'Usuarios' }, { value: 'okta_group', label: 'Grupos Okta' }, { value: 'cyberark_role', label: 'Roles CyberArk' }]}
          onChange={(value) => setKind(value as PamIdentityKind | '')}
        />}
      </div>
      <div className="compact-table-wrap"><table className="compact-table pam-role-table"><thead><tr><th /><th>{subjectLabel}</th><th>{relationLabel}</th><th>Safes</th><th>Cuentas</th><th>SIA</th></tr></thead><tbody>
        {loading && !roles.length
          ? <tr><td colSpan={6}><StateBlock variant="loading" title="Cargando roles PAM…" /></td></tr>
            : loadError && !roles.length
            ? <tr><td colSpan={6}><StateBlock variant="error" title="No se pudieron cargar los roles PAM" hint={loadError} action={<button type="button" className="button subtle" onClick={() => void reload()}>Reintentar</button>} /></td></tr>
            : roles.length
              ? roles.map((role) => {
                  const isExpanded = expanded.has(role.object_id);
                  const detail = details[role.object_id];
                  const detailError = detailErrors[role.object_id];
                  const identityKind = classifyPamIdentity(role.display_name);
                  return <Fragment key={role.object_id}>
                    <tr className={isExpanded ? 'selected' : ''} onClick={() => void toggleExpanded(role.object_id)} onKeyDown={(event) => activateRow(event, () => void toggleExpanded(role.object_id))} tabIndex={0} aria-expanded={isExpanded} aria-label={`${role.display_name}: ${isExpanded ? 'ocultar' : 'ver'} conexiones`} title={`${isExpanded ? 'Ocultar' : 'Ver'} las conexiones de ${role.display_name}`} style={{ cursor: 'pointer' }}>
                      <td>{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                      <td><IdentityChip name={role.display_name} kind={identityChipKind(identityKind)} subtitle={`${PAM_IDENTITY_KIND_LABELS[identityKind]} · ID ${role.source_id}`} /></td>
                      <td><span className="metric-num">{formatNumber(role.member_count)}</span></td>
                      <td><span className="metric-num">{formatNumber(role.safe_count)}</span></td>
                      <td><span className="metric-num">{formatNumber(role.account_count)}</span></td>
                      <td>{role.sia_reference_count > 0 ? <StatusBadge tone="warning">{formatNumber(role.sia_reference_count)} referencia{role.sia_reference_count === 1 ? '' : 's'}</StatusBadge> : <span className="muted">Sin referencia</span>}</td>
                    </tr>
                    {isUserView && isExpanded && <tr className="pam-role-detail-row"><td /><td colSpan={5}>
                      <div className="pam-role-user-context">
                        <div><span className="pam-role-graph-label">Resumen de acceso PAM</span><p>Esta vista resume los conteos verificados de la identidad. Las búsquedas cruzadas usan el nombre visible y deben confirmarse en el módulo destino.</p></div>
                        <div className="pam-role-user-facts"><span><strong>{formatNumber(role.safe_count)}</strong> Safes alcanzables</span><span><strong>{formatNumber(role.account_count)}</strong> cuentas</span><span><strong>{formatNumber(role.sia_reference_count)}</strong> referencias SIA</span></div>
                        <div><span className="pam-role-graph-label">Roles vinculados</span><div className="pam-role-chip-list">{role.role_examples?.length ? role.role_examples.slice(0, 8).map((linkedRole) => <IdentityChip key={linkedRole.object_id} name={linkedRole.display_name} kind="role" subtitle={`Rol CyberArk · ID ${linkedRole.source_id}`} />) : <span className="muted">No se encontraron roles vinculados.</span>}{(role.role_examples?.length || 0) > 8 && <TagChip label={`+${formatNumber((role.role_examples?.length || 0) - 8)} más`} title="Hay más roles vinculados a esta identidad" />}</div></div>
                        <div className="pam-role-context-actions"><button type="button" className="button subtle" onClick={(event) => { event.stopPropagation(); onNavigate('safes', role.display_name); }}>Buscar coincidencia en Safes</button><button type="button" className="button subtle" onClick={(event) => { event.stopPropagation(); onNavigate('sia', role.display_name); }}>Buscar coincidencia en SIA</button></div>
                      </div>
                    </td></tr>}
                    {!isUserView && isExpanded && <tr className="pam-role-detail-row"><td /><td colSpan={5}>
                      {detailLoading.has(role.object_id) && <StateBlock variant="loading" title="Armando mapa de acceso…" />}
                      {detailError && <StateBlock variant="error" title="No se pudo cargar el mapa" hint={detailError} action={<button type="button" className="button subtle" title="Volver a cargar las conexiones del rol" onClick={() => void loadDetail(role.object_id)}>Reintentar</button>} />}
                      {detail && <div className="pam-role-detail">
                        <div className="pam-role-graph" aria-label={`Mapa de acceso de ${detail.role.display_name}`}>
                          <div className="pam-role-graph-column"><span className="pam-role-graph-label">Usuarios</span><strong>{formatNumber(detail.users.length)}</strong><div className="pam-role-chip-list">{detail.users.length ? detail.users.slice(0, 12).map((user) => <IdentityChip key={user.object_id} name={user.display_name} subtitle={user.source_id} />) : <span className="muted">Sin usuarios</span>}{detail.users.length > 12 && <TagChip label={`+${formatNumber(detail.users.length - 12)} más`} />}</div></div>
                          <GitBranch className="pam-role-graph-arrow" size={18} aria-hidden />
                          <div className="pam-role-graph-column"><span className="pam-role-graph-label">Safes alcanzables</span><strong>{formatNumber(detail.safes.length)}</strong><div className="pam-role-chip-list">{detail.safes.length ? detail.safes.slice(0, 12).map((safe) => <button key={safe.object_id} type="button" className="pam-role-safe-link" title={`Abrir el Safe ${safe.display_name}`} onClick={() => onNavigate('safes', safe.display_name)}><span>{safe.display_name}</span><small>{formatNumber(safe.account_count)} cuentas</small></button>) : <span className="muted">Sin Safes</span>}{detail.safes.length > 12 && <TagChip label={`+${formatNumber(detail.safes.length - 12)} más`} />}</div></div>
                        </div>
                        <div className="pam-role-sia-panel"><div><span className="pam-role-graph-label">SIA</span><h3>{detail.sia_references.length ? `${formatNumber(detail.sia_references.length)} políticas mencionan este nombre` : 'Sin política que mencione este nombre'}</h3><p>Referencia por nombre de rol; no es una relación normalizada ni confirma que el rol pertenezca al mismo espacio de IDs.</p></div><div className="pam-role-sia-list">{detail.sia_references.slice(0, 6).map((policy) => <button key={policy.object_id} type="button" className="pam-role-sia-link" onClick={() => onNavigate('sia', policy.display_name)}><span>{policy.display_name}</span><small>{policy.source_id}</small></button>)}{detail.sia_references.length > 6 && <TagChip label={`+${formatNumber(detail.sia_references.length - 6)} más`} />}</div></div>
                      </div>}
                    </td></tr>}
                  </Fragment>;
                })
              : <tr><td colSpan={6}><StateBlock variant="empty" title={search ? `Sin ${subjectLabel.toLowerCase()}s para esta búsqueda` : `Todavía no hay ${subjectLabel.toLowerCase()}s PAM sincronizados`} action={search ? <button type="button" className="button subtle" onClick={() => setSearch('')}>Limpiar búsqueda</button> : undefined} /></td></tr>}
      </tbody></table></div>
      {loadError && roles.length > 0 && <StateBlock variant="error" title="No se pudieron cargar más roles PAM" hint={loadError} action={<button type="button" className="button subtle" onClick={() => void reload()}>Reintentar</button>} />}
      {roles.length > 0 && <LoadMore loaded={roles.length} total={total} pageSize={50} loading={loading && page > 0} onLoadMore={() => setPage((current) => current + 1)} />}
    </section>
  </>;
}
