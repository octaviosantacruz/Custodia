import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, UsersRound, X } from 'lucide-react';
import { useDialogFocusTrap } from '../hooks/use-dialog-focus-trap';
import { grantUserRole, listPeople, revokeUserRole, roleAssignments, type User } from '../lib/users-api';
import { StateBlock } from './state-block';
import { TablePagination } from './table-pagination';
import './role-members.css';
import { t } from '../i18n/index.ts';

type Props = { roleCode: string; roleName: string; count: number; canAssign: boolean; canGrant?: boolean; currentActorId?: string; onChanged: () => void; onNotice: (message: string) => void; onError: (message: string) => void };

const PAGE_SIZE = 20;
const accountLabel = (user: User) => user.auth_source === 'oidc' ? 'Okta' : user.is_active ? t('Local') : t('Local desactivado');

/** ACCESS-UI-001: "Miembros (N)" opens a side panel listing who has the role; Custodia assignments are added and removed there. */
export function RoleMembers(props: Props) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="button subtle" onClick={() => setOpen(true)}><UsersRound size={14} /> Miembros ({props.count})</button>
    {open && createPortal(<MembersPanel {...props} onClose={() => setOpen(false)} />, document.body)}
  </>;
}

function MembersPanel({ roleCode, roleName, canAssign, canGrant = canAssign, currentActorId, onChanged, onNotice, onError, onClose }: Props & { onClose: () => void }) {
  const panelRef = useDialogFocusTrap<HTMLDivElement>({ active: true, onClose });
  const [rows, setRows] = useState<User[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<User[]>([]);

  useEffect(() => {
    let cancelled = false;
    setError('');
    listPeople({ search: '', roleFilter: roleCode, statusFilter: '', page, pageSize: PAGE_SIZE })
      .then((result) => { if (cancelled) return; setRows(result.rows.flatMap((person) => person.identities.filter((identity) => identity.roles.includes(roleCode)))); setTotal(result.total); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : t('No se pudieron cargar los miembros')); });
    return () => { cancelled = true; };
  }, [roleCode, page, attempt]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setCandidates([]); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      listPeople({ search: term, roleFilter: '', statusFilter: '', page: 0, pageSize: 8 })
        .then((result) => { if (!cancelled) setCandidates(result.rows.flatMap((person) => person.identities).filter((identity) => !identity.roles.includes(roleCode) && identity.actor_id !== currentActorId).slice(0, 6)); })
        .catch(() => { if (!cancelled) setCandidates([]); });
    }, 200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, roleCode, currentActorId]);

  const change = async (user: User, action: 'grant' | 'revoke') => {
    setBusy(true);
    try {
      await (action === 'grant' ? grantUserRole : revokeUserRole)(user.actor_id, roleCode);
      onNotice(action === 'grant' ? `${user.display_name} ahora tiene ${roleName}` : `${roleName} quitado a ${user.display_name}`);
      if (action === 'grant') { setQuery(''); setCandidates([]); }
      setAttempt((value) => value + 1);
      onChanged();
    } catch (reason) { onError(reason instanceof Error ? reason.message : t('No se pudo cambiar el miembro')); } finally { setBusy(false); }
  };

  return <div className="role-members-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={panelRef} className="role-members-panel" role="dialog" aria-modal="true" aria-labelledby="role-members-title" tabIndex={-1}>
      <header><h3 id="role-members-title">{t('Miembros de {roleName}', { roleName: roleName })}</h3><button type="button" className="icon-button" aria-label={t('Cerrar miembros')} onClick={onClose}><X size={16} /></button></header>
      {canGrant && <div className="role-members-add">
        <label className="sr-only" htmlFor="role-member-search">Agregar miembro a {roleName}</label>
        <input id="role-member-search" type="search" placeholder={t('Agregar por nombre o correo')} value={query} disabled={busy} onChange={(event) => setQuery(event.target.value)} autoComplete="off" />
        {candidates.length > 0 && <ul aria-label={t('Personas para agregar')}>{candidates.map((user) => <li key={user.actor_id}>
          <span>{user.display_name} <small>{user.email} · {accountLabel(user)}</small></span>
          <button type="button" className="icon-button" disabled={busy} aria-label={t('Agregar {display_name} ({user})', { display_name: user.display_name, user: accountLabel(user) })} onClick={() => void change(user, 'grant')}><Plus size={14} /></button>
        </li>)}</ul>}
      </div>}
      {error ? <StateBlock compact variant="error" title={t('No se pudieron cargar los miembros')} hint={error} action={<button className="button subtle" type="button" onClick={() => setAttempt((value) => value + 1)}>{t('Reintentar')}</button>} />
        : !rows ? <StateBlock compact variant="loading" title={t('Cargando miembros')} />
          : !rows.length ? <p className="role-members-empty">{t('Nadie tiene este rol.')}</p>
            : <ul className="role-members-list" aria-label={t('Miembros de {roleName}', { roleName: roleName })}>{rows.map((user) => {
              const source = roleAssignments(user).find((assignment) => assignment.role_code === roleCode)?.source;
              const removable = canAssign && source === 'manual' && user.actor_id !== currentActorId;
              return <li key={user.actor_id}>
                <span>{user.display_name} <small>{user.email || t('Sin correo')} · {accountLabel(user)}{source === 'oidc' ? t(' · por Okta') : ''}</small></span>
                {removable ? <button type="button" className="icon-button" disabled={busy} aria-label={t('Quitar {roleName} a {display_name}', { roleName: roleName, display_name: user.display_name })} onClick={() => void change(user, 'revoke')}><X size={14} /></button> : null}
              </li>;
            })}</ul>}
      {total > PAGE_SIZE && <TablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />}
    </div>
  </div>;
}
