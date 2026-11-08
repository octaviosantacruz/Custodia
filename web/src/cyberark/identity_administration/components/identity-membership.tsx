import { DateTime } from '../../../cross/components/date-time';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, KeyRound, Search, UserRound, UsersRound } from 'lucide-react';
import { fetchIdentityMembership } from '../lib/identity-admin-api';
import type { IdentityMembership, IdentityMembershipNode } from '../types/identity';
import { StateBlock } from '../../../cross/components/state-block';
import { usePamRefreshKey } from '../../shared/refresh-context';
import { formatNumber } from '../../../cross/lib/format';
import './identity-membership.css';

const LABELS = { user: 'Usuario', role: 'Rol de CyberArk', okta_group: 'Grupo de Okta' };
const ICONS = { user: UserRound, role: KeyRound, okta_group: UsersRound };

function indexMembership(data: IdentityMembership) {
  const nodes = new Map(data.nodes.map((node) => [node.object_id, node]));
  const children = new Map<number, IdentityMembershipNode[]>();
  for (const edge of data.edges) {
    const node = nodes.get(edge.member_id);
    if (node) children.set(edge.parent_id, [...children.get(edge.parent_id) ?? [], node]);
  }
  const people = new Map<number, { node: IdentityMembershipNode; paths: string[][] }>();
  let visits = 0;
  let limited = data.truncated;
  function visit(id: number, path: number[]) {
    if (path.includes(id)) return;
    if (++visits > 5000 || path.length >= 20) { limited = true; return; }
    const node = nodes.get(id);
    if (!node) return;
    const next = [...path, id];
    if (node.kind === 'user') {
      const person = people.get(id) ?? { node, paths: [] };
      person.paths.push(next.slice(0, -1).map((key) => nodes.get(key)!.display_name));
      people.set(id, person);
    } else for (const child of children.get(id) ?? []) visit(child.object_id, next);
  }
  visit(data.root_id, []);
  return { nodes, children, people: [...people.values()], limited };
}

function MembershipBranch({ node, index, ancestors = [] }: { node: IdentityMembershipNode; index: ReturnType<typeof indexMembership>; ancestors?: number[] }) {
  const [expanded, setExpanded] = useState(ancestors.length < 3);
  const Icon = ICONS[node.kind];
  if (ancestors.includes(node.object_id)) return <li className="membership-cycle"><KeyRound size={14} /><span>{node.display_name}<small>Referencia circular · ya aparece en este recorrido</small></span></li>;
  if (ancestors.length >= 20) return <li className="membership-note">Límite de profundidad alcanzado.</li>;
  if (node.kind === 'user') return <li className="membership-person"><Icon size={15} /><span>{node.user_name || node.display_name}{node.user_name && node.user_name !== node.display_name ? <small>{node.display_name}</small> : null}</span></li>;
  const members = index.children.get(node.object_id) ?? [];
  const path = [...ancestors, node.object_id];
  const pending = node.unresolved_members ?? [];
  const users = members.filter((member) => member.kind === 'user');
  const groups = members.filter((member) => member.kind !== 'user');
  const pendingUsers = pending.filter((member) => member.kind === 'user');
  const pendingGroups = pending.filter((member) => member.kind === 'role');
  const total = node.direct_member_count ?? members.length + node.unresolved_member_count;
  const userCount = users.length + pendingUsers.length;
  const groupCount = groups.length + pendingGroups.length;
  const composition = [userCount ? `${formatNumber(userCount)} ${userCount === 1 ? 'usuario' : 'usuarios'}` : '', groupCount ? `${formatNumber(groupCount)} ${groupCount === 1 ? 'rol/grupo' : 'roles/grupos'}` : ''].filter(Boolean).join(' · ');
  const countLabel = `${formatNumber(total)} ${total === 1 ? 'miembro directo' : 'miembros directos'}${composition ? ` · ${composition}` : ''}`;
  return <li><details className="membership-branch" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary><ChevronRight size={14} className="membership-chevron" /><Icon size={16} /><span><strong>{node.display_name}</strong><small>{LABELS[node.kind]}</small></span><span className="membership-count">{countLabel}</span></summary>
    {node.membership_status !== 'complete' && <p className="membership-note">Miembros pendientes de consultar · se actualizarán en la próxima sincronización.</p>}
    {node.unresolved_member_count > pending.length && <p className="membership-note">{formatNumber(node.unresolved_member_count)} referencia{node.unresolved_member_count === 1 ? '' : 's'} sin identificar en el inventario. La lista de usuarios puede estar incompleta.</p>}
    {!members.length && node.membership_status === 'complete' && !node.unresolved_member_count && <p className="membership-empty">Sin miembros directos.</p>}
    {expanded && <>
      {userCount > 0 && <div className="membership-layer"><h3>{node.kind === 'okta_group' ? 'Usuarios del grupo' : 'Usuarios directos'} <span>{formatNumber(userCount)}</span></h3><ul>
        {users.map((member) => <MembershipBranch key={member.object_id} node={member} index={index} ancestors={path} />)}
        {pendingUsers.map((member, idx) => <li className="membership-person membership-pending" key={idx}><UserRound size={15} /><span>{member.display_name || 'Usuario sin nombre'}<small>Sin ficha de usuario</small></span></li>)}
      </ul></div>}
      {groupCount > 0 && <div className="membership-layer"><h3>Roles y grupos <span>{formatNumber(groupCount)}</span></h3><ul>
        {groups.map((member) => <MembershipBranch key={member.object_id} node={member} index={index} ancestors={path} />)}
        {pendingGroups.map((member, idx) => <li className="membership-person membership-pending" key={idx}><KeyRound size={15} /><span>{member.display_name || 'Rol sin nombre'}<small>Sin ficha del rol o grupo</small></span></li>)}
      </ul></div>}
      {pending.filter((member) => member.kind === 'unknown').map((member, idx) => <p className="membership-note" key={idx}>{member.display_name || 'Miembro sin nombre'} · Sin ficha ni tipo informado</p>)}
    </>}
  </details></li>;
}

function MembershipContent({ data }: { data: IdentityMembership }) {
  const [view, setView] = useState<'layers' | 'users'>('layers');
  const [search, setSearch] = useState('');
  const index = useMemo(() => indexMembership(data), [data]);
  const root = index.nodes.get(data.root_id);
  const incomplete = data.nodes.some((node) => node.kind !== 'user' && (node.membership_status !== 'complete' || node.unresolved_member_count > 0));
  const people = index.people.filter(({ node }) => `${node.display_name} ${node.user_name ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <section className="identity-membership" aria-label={`Membresía de ${root?.display_name ?? 'rol'}`}>
    <header className="membership-header"><div><h2>Camino de membresía</h2><p>Identity Administration · {root?.last_seen_at ? <>Última sincronización: <DateTime value={root.last_seen_at} /></> : 'Fecha de sincronización no informada'}</p></div><span className="membership-total">{formatNumber(index.people.length)} usuario{index.people.length === 1 ? '' : 's'} único{index.people.length === 1 ? '' : 's'} conocido{index.people.length === 1 ? '' : 's'}</span></header>
    {(incomplete || index.limited) && <p className="membership-note">Cobertura parcial: {index.limited ? 'se alcanzó el límite del recorrido.' : 'hay ramas pendientes o referencias sin resolver.'} Los usuarios sin ficha se muestran en su rol, separados del conteo de usuarios confirmados.</p>}
    <div className="membership-view" role="group" aria-label="Presentación de membresía"><button type="button" aria-pressed={view === 'layers'} onClick={() => setView('layers')}>Jerarquía</button><button type="button" aria-pressed={view === 'users'} onClick={() => setView('users')}>Usuarios resultantes ({formatNumber(index.people.length)})</button></div>
    {view === 'layers' ? root && <ul className="membership-tree"><MembershipBranch node={root} index={index} /></ul> : <>
      <label className="search-box membership-search"><Search size={16} /><input type="search" aria-label="Buscar usuarios resultantes" placeholder="Buscar usuario en todas las capas" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <ul className="membership-results">{people.map(({ node, paths }) => <li key={node.object_id}><div><UserRound size={16} /><strong>{node.user_name || node.display_name}</strong><span>{formatNumber(paths.length)} recorrido{paths.length === 1 ? '' : 's'}</span></div><details><summary>Ver recorrido de {node.user_name || node.display_name}</summary>{paths.map((path, idx) => <p key={idx}>{path.join(' → ')} → {node.user_name || node.display_name}</p>)}</details></li>)}</ul>
      {!people.length && <p className="membership-empty">{search ? 'Sin usuarios para esta búsqueda.' : 'Sin usuarios confirmados en estas capas.'}</p>}
    </>}
  </section>;
}

export function IdentityMembershipPanel({ objectId }: { objectId: number }) {
  const refreshKey = usePamRefreshKey();
  const query = useQuery({ queryKey: ['identity-membership', objectId, refreshKey], queryFn: ({ signal }) => fetchIdentityMembership(objectId, signal) });
  if (query.isLoading) return <StateBlock variant="loading" title="Consultando capas de membresía…" />;
  if (query.error) return <StateBlock variant="error" title="No se pudieron consultar las capas" hint="Reintentá para consultar la membresía actual del rol." action={<button type="button" className="button subtle" onClick={() => void query.refetch()}>Reintentar capas</button>} />;
  return query.data ? <MembershipContent key={objectId} data={query.data} /> : null;
}
