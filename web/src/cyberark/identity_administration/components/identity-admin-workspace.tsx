import { DateTime } from '../../../cross/components/date-time';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../../cross/lib/api';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { CompactSelect } from '../../../cross/components/compact-select';
import { TablePagination } from '../../../cross/components/table-pagination';
import { StateBlock } from '../../../cross/components/state-block';
import { SortableHeader } from '../../../cross/components/sortable-header';
import { identityRoleKind, IDENTITY_ROLE_KIND_LABELS, type IdentityRoleKindName } from '../lib/identity-role-kind';
import type { IdentityRoleRow } from '../types/identity';
import { IdentityChip, StatusBadge } from '../../../cross/components/semantic';
import { IdentityMembershipPanel } from './identity-membership';
import { IdentityDrawer } from './identity-drawer';
import { StandardSeatBadge } from '../../shared/components/standard-seat-badge';
import { formatNumber, resultCountLabel } from '../../../cross/lib/format';
import { federationBadgeLabel, federationBadgeTone } from '../lib/federation-resolution';
import { useIdentityAdmin } from '../hooks/use-identity-admin';
import { useIdentityDrawer } from '../hooks/use-identity-drawer';
import { handleTablistKeyDown } from '../../../cross/lib/tablist-keyboard';
import { IdentityMatchBar, RoleMatchChips, RoleMatchDetails } from './identity-member-matches';
import { useIdentityRoleMatches } from '../hooks/use-identity-role-matches';
import { buildRoleMatchIndex } from '../lib/identity-role-matches';
import type { WorkspaceView } from '../../../cross/lib/workspaces';
import { t } from '../../../cross/i18n/index.ts';


type IdentityAdminWorkspaceProps = {
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  onNavigate: (view: WorkspaceView, query?: string) => void;
  initialTab?: 'users' | 'roles';
  initialQuery?: string;
  roleKind?: '' | 'role' | 'okta_group';
  embedded?: boolean;
  canReadIdentityCatalogs?: boolean;
};

/** Type as a smart chip: it names the kind and, when clicked, filters the table to it (click again to clear). */
function RoleKindChip({ kind, active, locked, onToggle }: { kind: IdentityRoleKindName; active: boolean; locked: boolean; onToggle: (next: IdentityRoleKindName | '') => void }) {
  const label = IDENTITY_ROLE_KIND_LABELS[kind];
  const badge = <StatusBadge tone={kind === 'okta_group' ? 'identity' : 'info'}>{label}</StatusBadge>;
  if (locked) return badge;
  return <button type="button" className={'identity-kind-chip' + (active ? ' active' : '')} aria-pressed={active} title={active ? t('Quitar el filtro {value}', { value: label }) : t('Mostrar solo: {value}', { value: label })} onClick={(event) => { event.stopPropagation(); onToggle(active ? '' : kind); }}>{badge}</button>;
}

/** Only the membership evidence the sync delivered: complete, partial or not reported. */
function MembershipChip({ attributes }: { attributes: IdentityRoleRow['attributes'] }) {
  if (attributes.membership_status === 'not_reported') return <StatusBadge tone="warning">{t('No reportada')}</StatusBadge>;
  const unresolved = attributes.unresolved_member_count ?? 0;
  if (unresolved > 0) return <span title={t('Miembros que la API entregó sin poder resolverlos a una cuenta')}><StatusBadge tone="warning">{t('{unresolved} sin resolver', { unresolved: formatNumber(unresolved) })}</StatusBadge></span>;
  if (attributes.membership_status === 'complete') return <StatusBadge tone="success">Completa</StatusBadge>;
  return <span className="muted">{t('Sin dato')}</span>;
}

export function IdentityAdminWorkspace({ authChecked, authenticated, onUnauthorized, onError, onNavigate, initialTab = 'users', initialQuery = '', roleKind = '', embedded = false, canReadIdentityCatalogs = false }: IdentityAdminWorkspaceProps) {
  const drawer = useIdentityDrawer();
  const [matchesRequested, setMatchesRequested] = useState(false);
  const [onlyMatches, setOnlyMatches] = useState(false);
  const matchesQuery = useIdentityRoleMatches(canReadIdentityCatalogs && matchesRequested && authChecked && authenticated);
  const matchIndex = useMemo(() => (matchesQuery.data ? buildRoleMatchIndex(matchesQuery.data) : null), [matchesQuery.data]);
  useEffect(() => {
    if (matchesQuery.error instanceof ApiError && matchesQuery.error.status === 401) onUnauthorized();
  }, [matchesQuery.error, onUnauthorized]);
  const {
    tab, setTab, search, setSearch, activeFilter, setActiveFilter, standardSeat, setStandardSeat, kindFilter, setKindFilter, roleSort, toggleRoleSort, page, setPage, loading, loadError,
    users, userTotal, roles, roleTotal,
    expandedUsers, rolesByUser, toggleUserRoles,
    expandedRoles, toggleRoleMembers,
    expandLoading, rolesError, retryUserRoles, reload,
  } = useIdentityAdmin({ authChecked, authenticated, onUnauthorized, onError, initialTab, initialQuery, roleKind, roleObjectIds: onlyMatches && matchIndex ? matchIndex.objectIds : null });

  const total = tab === 'users' ? userTotal : roleTotal;
  const hasFilters = Boolean(search || activeFilter || standardSeat || kindFilter);
  const usersCols = 9;
  const rolesCols = 4;

  const stateRow = (cols: number) => {
    if (loading) return <tr><td colSpan={cols}><StateBlock variant="loading" title={t('Cargando…')} /></td></tr>;
    if (loadError) return <tr><td colSpan={cols}><StateBlock variant="error" title={t('No se pudo cargar Identity Administration')} hint={loadError} action={<button type="button" className="button subtle" onClick={() => void reload()}>Reintentar</button>} /></td></tr>;
    return null;
  };

  const emptyRow = (cols: number, label: string) => <tr><td colSpan={cols}><StateBlock
    variant={hasFilters ? 'no-results' : 'empty'}
    title={hasFilters ? t('Sin resultados para esta búsqueda') : label}
    action={hasFilters ? <button type="button" className="button subtle" onClick={() => { setSearch(''); setActiveFilter(''); setStandardSeat(''); setKindFilter(''); }}>Limpiar filtros</button> : undefined}
  /></td></tr>;

  return <>
    {!(embedded && tab === 'roles') && <section className="database-toolbar">
      <div className="database-toolbar-actions">
        <span className="database-toolbar-count">{resultCountLabel(total)}</span>
      </div>
    </section>}
    <section className={`list-panel database-surface${tab === 'roles' ? ' identity-role-list' : ''}`}>
      {!embedded && <div className="table-view-toggle" role="tablist" aria-label={t('Vista de Identity Administration')} onKeyDown={handleTablistKeyDown}>
        <button type="button" role="tab" aria-selected={tab === 'users'} tabIndex={tab === 'users' ? 0 : -1} className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>{t('Usuarios')}</button>
        <button type="button" role="tab" aria-selected={tab === 'roles'} tabIndex={tab === 'roles' ? 0 : -1} className={tab === 'roles' ? 'active' : ''} onClick={() => setTab('roles')}>Roles</button>
      </div>}

      {tab === 'roles' && canReadIdentityCatalogs && <IdentityMatchBar
        requested={matchesRequested} loading={matchesQuery.isFetching} error={Boolean(matchesQuery.error)} data={matchesQuery.data} index={matchIndex} onlyMatches={onlyMatches}
        onRequest={() => setMatchesRequested(true)} onRetry={() => void matchesQuery.refetch()}
        onToggleOnly={() => { setOnlyMatches((current) => !current); setPage(0); }}
      />}

      <div className="search-row">
        {tab === 'roles' && embedded && <span className="database-toolbar-count">{resultCountLabel(total)}</span>}
        <label className="search-box">
          <Search size={16} />
          <input
            type="search"
            aria-label={tab === 'users' ? t('Buscar usuarios de Identity Administration') : t('Buscar roles y grupos')}
            placeholder={tab === 'users' ? t('Buscar por nombre, usuario o email') : t('Buscar por nombre de rol o grupo')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {tab === 'users' && <CompactSelect
          className="inline-select"
          value={activeFilter}
          ariaLabel={t('Filtrar usuarios por estado')}
          options={[{ value: '', label: t('Todos los estados') }, { value: 'active', label: t('Activos') }, { value: 'inactive', label: 'Inactivos' }]}
          onChange={(value) => setActiveFilter(value as 'active' | 'inactive' | '')}
        />}
        {tab === 'roles' && !roleKind && <CompactSelect
          className="inline-select"
          value={kindFilter}
          ariaLabel={t('Filtrar por tipo de rol o grupo')}
          options={[{ value: '', label: t('Todos los tipos') }, { value: 'role', label: t('Roles de CyberArk') }, { value: 'okta_group', label: t('Grupos de Okta') }]}
          onChange={(value) => setKindFilter(value as '' | 'role' | 'okta_group')}
        />}
        {tab === 'users' && <CompactSelect className="inline-select" value={standardSeat} ariaLabel={t('Filtrar usuarios por consumo de licencia Standard')} options={[{ value: '', label: t('Todas las licencias') }, { value: 'reconciled', label: 'Consume licencia Standard' }, { value: 'unreconciled', label: t('Sin licencia Standard') }]} onChange={(value) => setStandardSeat(value as '' | 'reconciled' | 'unreconciled')} />}
      </div>

      {tab === 'users'
        ? <div className="compact-table-wrap"><table className="compact-table"><thead><tr><th><span className="sr-only">Expandir</span></th><th>{t('Usuario')}</th><th>Email</th><th>{t('Estado')}</th><th>{t('Tipo')}</th><th>Roles</th><th>{t('Último acceso')}</th><th>{t('Federación')}</th><th>Consume licencia</th></tr></thead><tbody>
          {stateRow(usersCols) || (users.length ? users.map((user) => {
            const expanded = expandedUsers.has(user.object_id);
            return <Fragment key={user.object_id}>
              <tr className={expanded ? 'selected' : ''} onClick={() => void toggleUserRoles(user.object_id)} style={{ cursor: 'pointer' }}>
                <td><button type="button" className="row-expand-button" aria-expanded={expanded} aria-controls={`identity-user-roles-${user.object_id}`} aria-label={t('{Ver} roles de {display_name}', { Ver: expanded ? t('Ocultar') : t('Ver'), display_name: user.display_name })} title={expanded ? t('Ocultar roles') : t('Ver roles')} onClick={(event) => { event.stopPropagation(); void toggleUserRoles(user.object_id); }}>{expanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}</button></td>
                <td><div className="identity-user-cell"><IdentityChip name={user.display_name} kind={user.attributes.service_user ? 'system' : 'user'} subtitle={user.attributes.user_name === user.attributes.email ? undefined : user.attributes.user_name} onSelect={() => drawer.open({ kind: 'user', objectId: user.object_id, name: user.display_name })} /></div></td>
                <td>{user.attributes.email || <span className="muted">{t('Sin dato')}</span>}</td>
                <td><StatusBadge tone={user.attributes.active ? 'success' : 'neutral'}>{user.attributes.active === true ? t('Activo') : user.attributes.active === false ? t('Inactivo') : t('Sin dato')}</StatusBadge></td>
                <td>{user.attributes.service_user ? t('Cuenta técnica') : 'Persona'}</td>
                <td><span className="metric-num">{formatNumber(user.role_count)}</span></td>
                <td>{user.attributes.last_login_date ? <DateTime value={user.attributes.last_login_date} /> : <span className="muted">{t('Sin dato')}</span>}</td>
                <td>
                  {/* IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §3.1/§7: a
                      business rule derived from the email domain, not
                      evidence CyberArk's API delivered -- StatusBadge here
                      is a compact label only, never phrased as "belongs to". */}
                  {user.federation_resolution
                    ? <span title={t('Federación esperada por dominio de correo (asociación derivada, no entregada por la API)')}><StatusBadge tone={federationBadgeTone(user.federation_resolution)}>{federationBadgeLabel(user.federation_resolution)}</StatusBadge></span>
                    : <span className="muted">{t('Sin dato')}</span>}
                </td>
                <td>{user.standard_seat_reconciled ? <StandardSeatBadge reconciled context="identity" /> : null}</td>
              </tr>
              {expanded && <tr id={`identity-user-roles-${user.object_id}`}><td /><td colSpan={8}>
                {expandLoading.has(user.object_id) ? <span className="muted">{t('Cargando roles…')}</span> : rolesError.has(user.object_id) ? <StateBlock compact variant="error" title={t('No se pudieron cargar los roles')} action={<button type="button" className="button subtle" onClick={(event) => { event.stopPropagation(); retryUserRoles(user.object_id); }}>Reintentar</button>} /> : (rolesByUser[user.object_id]?.length
                  ? <div className="identity-expand-list">{rolesByUser[user.object_id].map((role) => <IdentityChip key={role.object_id} name={role.display_name} kind={role.display_name.toLowerCase().startsWith('sg_cyberark') ? 'group' : 'role'} subtitle={role.display_name.toLowerCase().startsWith('sg_cyberark') ? t('Grupo de Okta') : t('Rol de CyberArk')} onSelect={() => drawer.open({ kind: 'role', objectId: role.object_id, name: role.display_name })} />)}</div>
                  : <span className="muted">{t('Sin roles asignados')}</span>)}
              </td></tr>}
            </Fragment>;
          }) : emptyRow(usersCols, t('Todavía no hay usuarios sincronizados')))}
        </tbody></table></div>
        : <div className="compact-table-wrap"><table className="compact-table"><thead><tr><th><span className="sr-only">Expandir</span></th><SortableHeader label={t('Rol o grupo')} sortKey="name" activeKey={roleSort.key} direction={roleSort.direction} onSort={toggleRoleSort} /><SortableHeader label="Miembros directos" sortKey="members" activeKey={roleSort.key} direction={roleSort.direction} onSort={toggleRoleSort} className="identity-role-numeric" /><th>{t('Membresía')}</th><SortableHeader label={t('Última modificación')} sortKey="modified" activeKey={roleSort.key} direction={roleSort.direction} onSort={toggleRoleSort} /></tr></thead><tbody>
          {stateRow(rolesCols) || (roles.length ? roles.map((role) => {
            const expanded = expandedRoles.has(role.object_id);
            return <Fragment key={role.object_id}>
              <tr className={expanded ? 'selected' : ''} onClick={() => void toggleRoleMembers(role.object_id)} style={{ cursor: 'pointer' }}>
                <td><button type="button" className="row-expand-button" aria-expanded={expanded} aria-controls={`identity-role-members-${role.object_id}`} aria-label={t('{Ver} miembros de {display_name}', { Ver: expanded ? t('Ocultar') : t('Ver'), display_name: role.display_name })} title={expanded ? t('Ocultar miembros') : t('Ver miembros')} onClick={(event) => { event.stopPropagation(); void toggleRoleMembers(role.object_id); }}>{expanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}</button></td>
                <td><div className="identity-role-name">
                  <IdentityChip name={role.display_name} kind={identityRoleKind(role.display_name) === 'okta_group' ? 'group' : 'role'} onSelect={() => drawer.open({ kind: 'role', objectId: role.object_id, name: role.display_name })} />
                  <RoleKindChip kind={identityRoleKind(role.display_name)} active={(roleKind || kindFilter) === identityRoleKind(role.display_name)} locked={Boolean(roleKind)} onToggle={(next) => setKindFilter(next)} />
                </div></td>
                <td className="identity-role-numeric"><span className="metric-num">{role.attributes.direct_member_count === undefined ? t('Pendiente de sincronización') : formatNumber(role.attributes.direct_member_count)}</span></td>
                <td><MembershipChip attributes={role.attributes} /><RoleMatchChips info={matchIndex?.bySourceId.get(role.source_id)} /></td>
                <td><DateTime value={role.attributes.last_modified} /></td>
              </tr>
              {expanded && <tr id={`identity-role-members-${role.object_id}`}><td /><td colSpan={3}>
                <RoleMatchDetails info={matchIndex?.bySourceId.get(role.source_id)} onOpen={(ref) => ref.object_id !== null && drawer.open({ kind: 'role', objectId: ref.object_id, name: ref.name })} />
                <IdentityMembershipPanel objectId={role.object_id} />
              </td></tr>}
            </Fragment>;
          }) : emptyRow(rolesCols, t('Todavía no hay roles o grupos sincronizados')))}
        </tbody></table></div>}

      <TablePagination page={page} pageSize={50} total={total} onPageChange={setPage} />
    </section>
    <IdentityDrawer controller={drawer} onNavigate={onNavigate} />
  </>;
}
