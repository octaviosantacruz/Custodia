import { useState } from 'react';
import { ArrowLeft, Search, UserCog } from 'lucide-react';
import { AgeCell } from '../../../cross/components/age-cell';
import { CompactSelect } from '../../../cross/components/compact-select';
import { DateTime } from '../../../cross/components/date-time';
import { HelpHint } from '../../../cross/components/help-hint';
import { StateBlock } from '../../../cross/components/state-block';
import { SummaryStats } from '../../../cross/components/summary-stats';
import { TablePagination } from '../../../cross/components/table-pagination';
import { useDebouncedValue } from '../../../cross/hooks/use-debounced-value';
import { formatNumber } from '../../../cross/lib/format';
import { useNetskopePanel } from '../hooks/use-netskope-panel';
import { NETSKOPE_ADMINS_PAGE_SIZE, fetchNetskopeAdminRole, fetchNetskopeAdminRoles, fetchNetskopeAdmins } from '../lib/netskope-api';
import {
  ADMINS_TITLE, ADMIN_KIND_OPTIONS, ADMIN_ROLE_OPTIONS, ADMIN_STATE_OPTIONS, EMPTY_ADMINS_QUERY,
  adminKindLabel, adminMfaLabel, adminState, hasAdminFilters, permissionLabel, permissionTone,
} from '../lib/netskope-admins';
import type { NetskopeAdminsQuery } from '../types/netskope';
import './netskope-admins.css';

type Props = {
  refreshKey: number;
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
};

type Tab = 'admins' | 'roles';
const LAST_LOGIN_AGE = { agingAfterHours: 24 * 90, staleAfterHours: 24 * 180 } as const;

/* NSK-RBAC-001: strict, read-only view (netskope:admin_inventory_read). Who administers the tenant, with which role and
   what each role opens. Credentials and who created or edited a role are never stored or shown. */
export function NetskopeAdminsWorkspace({ refreshKey, authChecked, authenticated, onUnauthorized }: Props) {
  const [tab, setTab] = useState<Tab>('admins');
  const [roleId, setRoleId] = useState<string | null>(null);
  const openRole = (id: string) => { setRoleId(id); setTab('roles'); };

  return <section className="netskope-workspace" aria-label="Administradores y roles de Netskope">
    <section className="list-panel database-surface">
      <section className="netskope-admins" aria-labelledby="netskope-admins-title">
        <header className="netskope-admins-heading">
          <div className="section-title"><UserCog size={17} aria-hidden="true" /><h2 id="netskope-admins-title">{ADMINS_TITLE}</h2>
            <HelpHint label={ADMINS_TITLE}>
              <p>Muestra las cuentas con acceso administrativo al tenant de Netskope, su rol y los permisos que abre cada rol. Se lee de Netskope y no incluye credenciales ni quién creó o editó un rol.</p>
              <p>Los permisos se agrupan por grupo de API y nivel (lectura, escritura o administración); junto a cada grupo se indican las páginas de la consola que abre.</p>
            </HelpHint>
          </div>
        </header>
        <div className="table-view-toggle" role="tablist" aria-label="Vistas de administración de Netskope">
          <button type="button" role="tab" aria-selected={tab === 'admins'} className={tab === 'admins' ? 'active' : ''} onClick={() => setTab('admins')}>Administradores</button>
          <button type="button" role="tab" aria-selected={tab === 'roles'} className={tab === 'roles' ? 'active' : ''} onClick={() => { setTab('roles'); setRoleId(null); }}>Roles</button>
        </div>
        {tab === 'admins'
          ? <AdminsTab refreshKey={refreshKey} authChecked={authChecked} authenticated={authenticated} onUnauthorized={onUnauthorized} onOpenRole={openRole} />
          : roleId
          ? <RoleDetail roleId={roleId} refreshKey={refreshKey} authChecked={authChecked} authenticated={authenticated} onUnauthorized={onUnauthorized} onBack={() => setRoleId(null)} />
          : <RolesTab refreshKey={refreshKey} authChecked={authChecked} authenticated={authenticated} onUnauthorized={onUnauthorized} onOpenRole={setRoleId} />}
      </section>
    </section>
  </section>;
}

type TabProps = Props & { onOpenRole: (roleId: string) => void };

function AdminsTab({ refreshKey, authChecked, authenticated, onUnauthorized, onOpenRole }: TabProps) {
  const [query, setQuery] = useState<NetskopeAdminsQuery>(EMPTY_ADMINS_QUERY);
  const debounced = useDebouncedValue(query);
  const update = (change: Partial<NetskopeAdminsQuery>) => setQuery((current) => ({ ...current, page: 0, ...change }));
  const panel = useNetskopePanel({
    cacheKey: ['admins', debounced],
    enabled: authChecked && authenticated,
    refreshKey,
    onUnauthorized,
    load: (signal) => fetchNetskopeAdmins(debounced, signal),
  });
  const data = panel.data;
  const clear = () => setQuery(EMPTY_ADMINS_QUERY);

  if (panel.loading && !data) return <StateBlock variant="loading" title="Cargando administradores…" />;
  if (panel.error && !data) {
    return <StateBlock variant="error" title="No se pudieron cargar los administradores" hint={panel.error} action={<button type="button" className="button subtle" onClick={() => void panel.reload()}>Reintentar</button>} />;
  }
  if (!data) return null;
  if (!data.configured || !data.last_observed_at) {
    return <StateBlock variant="empty" title="Sin administradores de Netskope" hint={data.configured ? 'Todavía no hay una lectura completa. Se completa en la próxima sincronización de Netskope.' : 'Un administrador debe habilitar la lectura de administradores y roles de Netskope.'} />;
  }
  return <>
    <SummaryStats ariaLabel="Resumen de administradores de Netskope" stats={[
      { key: 'active', label: 'Administradores activos', value: formatNumber(data.active), detail: `de ${formatNumber(data.total)}` },
      { key: 'no-role', label: 'Activos sin rol', value: formatNumber(data.active_without_role), active: query.role === 'none', onSelect: () => update({ role: query.role === 'none' ? '' : 'none', state: query.role === 'none' ? '' : 'active' }) },
      { key: 'service', label: 'Cuentas de servicio', value: formatNumber(data.service_accounts), active: query.recordType === 'SERVICE_ACCOUNT', onSelect: () => update({ recordType: query.recordType === 'SERVICE_ACCOUNT' ? '' : 'SERVICE_ACCOUNT' }) },
      { key: 'mfa', label: 'Personas activas sin MFA', value: formatNumber(data.active_people_without_mfa) },
    ]} />
    <div className="netskope-admins-toolbar">
      <label className="search-box netskope-admins-search"><Search size={16} aria-hidden="true" />
        <input type="search" aria-label="Buscar administrador por nombre o correo" value={query.search} placeholder="Nombre o correo" onChange={(event) => update({ search: event.target.value })} />
      </label>
      <CompactSelect ariaLabel="Filtrar por estado" value={query.state} options={[...ADMIN_STATE_OPTIONS]} onChange={(value) => update({ state: value as NetskopeAdminsQuery['state'] })} />
      <CompactSelect ariaLabel="Filtrar por tipo de cuenta" value={query.recordType} options={[...ADMIN_KIND_OPTIONS]} onChange={(value) => update({ recordType: value as NetskopeAdminsQuery['recordType'] })} />
      <CompactSelect ariaLabel="Filtrar por rol" value={query.role} options={[...ADMIN_ROLE_OPTIONS]} onChange={(value) => update({ role: value as NetskopeAdminsQuery['role'] })} />
    </div>
    {!data.filtered_total
      ? <StateBlock variant="no-results" title="Sin administradores que coincidan" action={hasAdminFilters(query) ? <button type="button" className="button subtle" onClick={clear}>Limpiar filtros</button> : undefined} />
      : <>
        <table className="netskope-admins-table">
          <caption className="sr-only">{ADMINS_TITLE}</caption>
          <thead><tr>
            <th scope="col">Administrador</th><th scope="col">Estado</th><th scope="col">Tipo</th>
            <th scope="col">Rol</th><th scope="col">Último acceso</th><th scope="col">MFA</th>
          </tr></thead>
          <tbody>
            {data.rows.map((row) => {
              const state = adminState(row);
              return <tr key={row.id}>
                <th scope="row"><strong className="cell-lead">{row.name}</strong></th>
                <td><span className={`netskope-admins-chip is-${state.tone}`}>{state.label}</span></td>
                <td>{adminKindLabel(row.record_type)}</td>
                <td>{row.role_id && row.role_name
                  ? <button type="button" className="netskope-admins-link" onClick={() => onOpenRole(row.role_id!)}>{row.role_name}</button>
                  : <span className="netskope-admins-none">Sin rol</span>}</td>
                <td>{row.last_login ? <AgeCell value={row.last_login} thresholds={LAST_LOGIN_AGE} /> : 'Sin dato'}</td>
                <td>{adminMfaLabel(row)}</td>
              </tr>;
            })}
          </tbody>
        </table>
        <TablePagination page={query.page} pageSize={NETSKOPE_ADMINS_PAGE_SIZE} total={data.filtered_total} onPageChange={(page) => setQuery((current) => ({ ...current, page }))} />
      </>}
    <p className="netskope-admins-note">Última lectura: <DateTime value={data.last_observed_at} /></p>
    {panel.error ? <p className="netskope-admins-note" role="status">No se pudo refrescar la lectura; se muestra la anterior. <button type="button" className="button subtle" onClick={() => void panel.reload()}>Reintentar</button></p> : null}
  </>;
}

function RolesTab({ refreshKey, authChecked, authenticated, onUnauthorized, onOpenRole }: TabProps) {
  const panel = useNetskopePanel({
    cacheKey: ['admin-roles'], enabled: authChecked && authenticated, refreshKey, onUnauthorized, load: fetchNetskopeAdminRoles,
  });
  const data = panel.data;
  if (panel.loading && !data) return <StateBlock variant="loading" title="Cargando roles…" />;
  if (panel.error && !data) {
    return <StateBlock variant="error" title="No se pudieron cargar los roles" hint={panel.error} action={<button type="button" className="button subtle" onClick={() => void panel.reload()}>Reintentar</button>} />;
  }
  if (!data) return null;
  if (!data.configured || !data.rows.length) {
    return <StateBlock variant="empty" title="Sin roles de administración" hint={data.configured ? 'Todavía no hay una lectura completa.' : 'Un administrador debe habilitar la lectura de administradores y roles de Netskope.'} />;
  }
  return <>
    <table className="netskope-admins-table netskope-admins-roles">
      <caption className="sr-only">Roles de administración de Netskope</caption>
      <thead><tr>
        <th scope="col">Rol</th><th scope="col">Administradores</th><th scope="col">Lectura</th>
        <th scope="col">Escritura</th><th scope="col">Administración</th><th scope="col">Última edición</th>
      </tr></thead>
      <tbody>
        {data.rows.map((row) => <tr key={row.id}>
          <th scope="row"><button type="button" className="netskope-admins-link" onClick={() => onOpenRole(row.id)}>{row.name}</button></th>
          <td>{row.admins ? formatNumber(row.admins) : <span className="netskope-admins-none">Ninguno</span>}</td>
          <td>{formatNumber(row.read_groups)}</td>
          <td>{formatNumber(row.write_groups)}</td>
          <td>{formatNumber(row.admin_groups)}</td>
          <td>{row.last_edited ? <DateTime value={row.last_edited} /> : 'Sin dato'}</td>
        </tr>)}
      </tbody>
    </table>
    <p className="netskope-admins-note">Los niveles cuentan grupos de API que el rol abre; «Ninguno» marca un rol sin administradores.</p>
  </>;
}

function RoleDetail({ roleId, refreshKey, authChecked, authenticated, onUnauthorized, onBack }: Omit<TabProps, 'onOpenRole'> & { roleId: string; onBack: () => void }) {
  const panel = useNetskopePanel({
    cacheKey: ['admin-role', roleId], enabled: authChecked && authenticated, refreshKey, onUnauthorized,
    load: (signal) => fetchNetskopeAdminRole(roleId, signal),
  });
  const data = panel.data;
  const back = <button type="button" className="button subtle netskope-admins-back" onClick={onBack}><ArrowLeft size={14} aria-hidden="true" /> Roles</button>;
  if (panel.loading && !data) return <StateBlock variant="loading" title="Cargando el rol…" />;
  if (panel.error && !data) {
    return <><div>{back}</div><StateBlock variant="error" title="No se pudo cargar el rol" hint={panel.error} action={<button type="button" className="button subtle" onClick={() => void panel.reload()}>Reintentar</button>} /></>;
  }
  if (!data) return null;
  return <>
    <div className="netskope-admins-role-head">
      {back}
      <h3>{data.name}</h3>
      <span className="netskope-admins-note">{formatNumber(data.permissions.length)} de {formatNumber(data.api_groups_total ?? data.permissions.length)} grupos de API con acceso · {formatNumber(data.admins.length)} {data.admins.length === 1 ? 'administrador' : 'administradores'}</span>
    </div>
    {data.admins.length
      ? <ul className="netskope-admins-holders" aria-label="Administradores con este rol">
        {data.admins.map((admin) => <li key={admin.id}>{admin.name}{admin.active === false ? <small> · inactivo</small> : null}</li>)}
      </ul>
      : <p className="netskope-admins-note">Ningún administrador tiene este rol.</p>}
    {!data.permissions.length
      ? <StateBlock variant="empty" title="Este rol no abre ningún grupo de API" />
      : <table className="netskope-admins-table netskope-admins-permissions">
        <caption className="sr-only">Permisos del rol {data.name}</caption>
        <thead><tr><th scope="col">Nivel</th><th scope="col">Grupo de API</th><th scope="col">Páginas de la consola</th></tr></thead>
        <tbody>
          {data.permissions.map((item) => <tr key={item.group_id}>
            <td><span className={`netskope-admins-chip is-${permissionTone(item.permission)}`}>{permissionLabel(item.permission)}</span></td>
            <th scope="row">{item.group}</th>
            <td>{item.pages.length ? item.pages.join(' · ') : <span className="netskope-admins-none">Sin página asociada</span>}</td>
          </tr>)}
        </tbody>
      </table>}
  </>;
}
