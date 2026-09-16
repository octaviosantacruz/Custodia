import { Fragment, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronRight, Search, UserCog } from 'lucide-react';
import { CompactSelect } from './compact-select';
import { TablePagination } from './table-pagination';
import { StateBlock } from './state-block';
import { IdentityChip, StatusBadge } from './semantic';
import { IdentityDrawer } from './identity-drawer';
import { StandardSeatBadge } from './standard-seat-badge';
import { formatDate, formatNumber, resultCountLabel } from '../lib/format';
import { federationBadgeLabel, federationBadgeTone } from '../lib/federation-resolution';
import { useIdentityAdmin } from '../hooks/use-identity-admin';
import { useIdentityDrawer } from '../hooks/use-identity-drawer';
import { handleTablistKeyDown } from '../lib/tablist-keyboard';
import type { WorkspaceView } from '../lib/workspaces';


function activateRow(event: KeyboardEvent<HTMLTableRowElement>, activate: () => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    activate();
  }
}

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
};

export function IdentityAdminWorkspace({ authChecked, authenticated, onUnauthorized, onError, onNavigate, initialTab = 'users', initialQuery = '', roleKind = '', embedded = false }: IdentityAdminWorkspaceProps) {
  const drawer = useIdentityDrawer();
  const {
    tab, setTab, search, setSearch, activeFilter, setActiveFilter, standardSeat, setStandardSeat, page, setPage, loading, loadError,
    users, userTotal, roles, roleTotal,
    expandedUsers, rolesByUser, toggleUserRoles,
    expandedRoles, membersByRole, toggleRoleMembers,
    expandLoading, reload,
  } = useIdentityAdmin({ authChecked, authenticated, onUnauthorized, onError, initialTab, initialQuery, roleKind });

  const total = tab === 'users' ? userTotal : roleTotal;
  const hasFilters = Boolean(search || activeFilter || standardSeat);
  const usersCols = 8;
  const rolesCols = 3;

  const stateRow = (cols: number) => {
    if (loading) return <tr><td colSpan={cols}><StateBlock variant="loading" title="Cargando…" /></td></tr>;
    if (loadError) return <tr><td colSpan={cols}><StateBlock variant="error" title="No se pudo cargar Identity Administration" hint={loadError} action={<button type="button" className="button subtle" onClick={() => void reload()}>Reintentar</button>} /></td></tr>;
    return null;
  };

  const emptyRow = (cols: number, label: string) => <tr><td colSpan={cols}><StateBlock
    variant={hasFilters ? 'no-results' : 'empty'}
    title={hasFilters ? 'Sin resultados para esta búsqueda' : label}
    action={hasFilters ? <button type="button" className="button subtle" onClick={() => { setSearch(''); setActiveFilter(''); setStandardSeat(''); }}>Limpiar filtros</button> : undefined}
  /></td></tr>;

  return <>
    <section className="database-toolbar">
      <div>
        <h2>{initialTab === 'users' ? 'Usuarios' : roleKind === 'okta_group' ? 'Grupos de Okta' : roleKind === 'role' ? 'Roles' : 'Roles y grupos'}</h2>
        <span className="database-caption">Identidades administradas por SCIM, separadas de la cadena PAM. El badge Standard aparece sólo cuando el UUID coincide con un usuario PAM conciliado; no es un dato de facturación.</span>
      </div>
      <div className="database-toolbar-actions">
        <span className="database-toolbar-count">{resultCountLabel(total)}</span>
      </div>
    </section>
    <section className="list-panel database-surface">
      {!embedded && <div className="table-view-toggle" role="tablist" aria-label="Vista de Identity Administration" onKeyDown={handleTablistKeyDown}>
        <button type="button" role="tab" aria-selected={tab === 'users'} tabIndex={tab === 'users' ? 0 : -1} className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>Usuarios</button>
        <button type="button" role="tab" aria-selected={tab === 'roles'} tabIndex={tab === 'roles' ? 0 : -1} className={tab === 'roles' ? 'active' : ''} onClick={() => setTab('roles')}>Roles</button>
      </div>}

      <div className="search-row">
        <label className="search-box">
          <Search size={16} />
          <input
            type="search"
            aria-label={tab === 'users' ? 'Buscar usuarios de Identity Administration' : 'Buscar roles de Identity Administration'}
            placeholder={tab === 'users' ? 'Buscar por nombre, usuario o email' : 'Buscar por nombre de rol'}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {tab === 'users' && <CompactSelect
          className="inline-select"
          value={activeFilter}
          ariaLabel="Filtrar usuarios por estado"
          options={[{ value: '', label: 'Todos los estados' }, { value: 'active', label: 'Activos' }, { value: 'inactive', label: 'Inactivos' }]}
          onChange={(value) => setActiveFilter(value as 'active' | 'inactive' | '')}
        />}
        {tab === 'users' && <CompactSelect
          className="inline-select"
          value={standardSeat}
          ariaLabel="Filtrar usuarios de Identity Administration por conciliación de asiento Standard"
          options={[{ value: '', label: 'Todos los asientos' }, { value: 'reconciled', label: 'Asiento Standard conciliado' }, { value: 'unreconciled', label: 'Sin asiento Standard conciliado' }]}
          onChange={(value) => setStandardSeat(value as '' | 'reconciled' | 'unreconciled')}
        />}
      </div>

      {tab === 'users'
        ? <div className="compact-table-wrap"><table className="compact-table"><thead><tr><th><span className="sr-only">Expandir</span></th><th>Usuario</th><th>Email</th><th>Estado</th><th>Tipo</th><th>Roles</th><th>Último acceso</th><th>Federación</th></tr></thead><tbody>
          {stateRow(usersCols) || (users.length ? users.map((user) => {
            const expanded = expandedUsers.has(user.object_id);
            return <Fragment key={user.object_id}>
              <tr className={expanded ? 'selected' : ''} onClick={() => void toggleUserRoles(user.object_id)} onKeyDown={(event) => activateRow(event, () => void toggleUserRoles(user.object_id))} tabIndex={0} aria-expanded={expanded} aria-label={`${user.display_name}: ${expanded ? 'ocultar' : 'ver'} roles`} style={{ cursor: 'pointer' }}>
                <td>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                <td><div className="identity-user-cell"><IdentityChip name={user.display_name} kind={user.attributes.service_user ? 'system' : 'user'} subtitle={user.attributes.user_name} onSelect={() => drawer.open({ kind: 'user', objectId: user.object_id, name: user.display_name })} /><StandardSeatBadge reconciled={user.standard_seat_reconciled} context="identity" /></div></td>
                <td>{user.attributes.email || <span className="muted">Sin dato</span>}</td>
                <td><StatusBadge tone={user.attributes.active ? 'success' : 'neutral'}>{user.attributes.active ? 'Activo' : 'Inactivo'}</StatusBadge></td>
                <td>{user.attributes.service_user ? 'Cuenta técnica' : 'Persona'}</td>
                <td><span className="metric-num">{formatNumber(user.role_count)}</span></td>
                <td>{user.attributes.last_login_date ? formatDate(user.attributes.last_login_date) : <span className="muted">Sin dato</span>}</td>
                <td>
                  {/* IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §3.1/§7: a
                      business rule derived from the email domain, not
                      evidence CyberArk's API delivered -- StatusBadge here
                      is a compact label only, never phrased as "belongs to". */}
                  {user.federation_resolution
                    ? <span title="Federación esperada por dominio de correo (asociación derivada, no entregada por la API)"><StatusBadge tone={federationBadgeTone(user.federation_resolution)}>{federationBadgeLabel(user.federation_resolution)}</StatusBadge></span>
                    : <span className="muted">Sin dato</span>}
                </td>
              </tr>
              {expanded && <tr><td /><td colSpan={7}>
                {expandLoading.has(user.object_id) ? <span className="muted">Cargando roles…</span> : (rolesByUser[user.object_id]?.length
                  ? <div className="identity-expand-list">{rolesByUser[user.object_id].map((role) => <IdentityChip key={role.object_id} name={role.display_name} kind="role" subtitle={role.source_id} onSelect={() => drawer.open({ kind: 'role', objectId: role.object_id, name: role.display_name })} />)}</div>
                  : <span className="muted">Sin roles asignados</span>)}
              </td></tr>}
            </Fragment>;
          }) : emptyRow(usersCols, 'Todavía no hay usuarios sincronizados'))}
        </tbody></table></div>
        : <div className="compact-table-wrap"><table className="compact-table"><thead><tr><th><span className="sr-only">Expandir</span></th><th>Rol</th><th>Miembros</th></tr></thead><tbody>
          {stateRow(rolesCols) || (roles.length ? roles.map((role) => {
            const expanded = expandedRoles.has(role.object_id);
            return <Fragment key={role.object_id}>
              <tr className={expanded ? 'selected' : ''} onClick={() => void toggleRoleMembers(role.object_id)} onKeyDown={(event) => activateRow(event, () => void toggleRoleMembers(role.object_id))} tabIndex={0} aria-expanded={expanded} aria-label={`${role.display_name}: ${expanded ? 'ocultar' : 'ver'} miembros`} style={{ cursor: 'pointer' }}>
                <td>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                <td><IdentityChip name={role.display_name} kind="role" subtitle={role.source_id} onSelect={() => drawer.open({ kind: 'role', objectId: role.object_id, name: role.display_name })} /></td>
                <td><span className="metric-num">{formatNumber(role.member_count)}</span></td>
              </tr>
              {expanded && <tr><td /><td colSpan={2}>
                {expandLoading.has(role.object_id) ? <span className="muted">Cargando miembros…</span> : (membersByRole[role.object_id]?.length
                  ? <div className="identity-expand-list">{membersByRole[role.object_id].map((member) => <IdentityChip key={member.object_id} name={member.display_name} kind="user" subtitle={member.source_id} onSelect={() => drawer.open({ kind: 'user', objectId: member.object_id, name: member.display_name })} />)}</div>
                  : <span className="muted">Sin miembros</span>)}
              </td></tr>}
            </Fragment>;
          }) : emptyRow(rolesCols, 'Todavía no hay roles sincronizados'))}
        </tbody></table></div>}

      <TablePagination page={page} pageSize={50} total={total} onPageChange={setPage} />
    </section>
    <IdentityDrawer controller={drawer} onNavigate={onNavigate} />
  </>;
}

export const identityAdminWorkspaceIcon = UserCog;
