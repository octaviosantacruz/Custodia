import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, UserRound, X } from 'lucide-react';
import { ApiError } from '../../../cross/lib/api';
import { fetchNetskopeUsers } from '../lib/netskope-api';
import { EMPTY_NETSKOPE_USERS_FILTERS } from '../lib/netskope-device-filters';
import type { NetskopeAttentionRow, NetskopeRow } from '../types/netskope';
import { StateBlock } from '../../../cross/components/state-block';
import { NetskopeUserDrawer, type NetskopeUserSelection } from './netskope-user-drawer';
import { NetskopeAttentionQueue } from './netskope-attention-queue';
import { handleTablistKeyDown } from '../../../cross/lib/tablist-keyboard';
import { NetskopeUciCompanies } from './netskope-uci-companies';
import type { WorkspaceView } from '../../../cross/lib/workspaces';
import { useDebouncedValue } from '../../../cross/hooks/use-debounced-value';
import './netskope-workspace.css';
import './netskope-experience-workspace.css';
import { t } from '../../../cross/i18n/index.ts';

type Props = {
  refreshKey: number;
  authChecked: boolean;
  authenticated: boolean;
  canReadUba: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  onNavigate: (view: WorkspaceView) => void;
};

export function NetskopeExperienceWorkspace({ refreshKey, authChecked, authenticated, canReadUba, onUnauthorized, onError, onNavigate }: Props) {
  const [search, setSearch] = useState('');
  const [company, setCompany] = useState('');
  const [selectedUser, setSelectedUser] = useState<NetskopeUserSelection | null>(null);
  const [tab, setTab] = useState<'attention' | 'companies'>('attention');
  const searchRef = useRef<HTMLInputElement>(null);
  const enabled = authChecked && authenticated;
  const tabs = canReadUba ? [['attention', t('Para revisar')], ['companies', t('Por empresa')]] as const : [['attention', t('Para revisar')]] as const;
  const debouncedSearch = useDebouncedValue(search.trim());
  const users = useQuery({
    queryKey: ['netskope', 'experience', 'users', debouncedSearch, refreshKey],
    enabled: enabled && !selectedUser && debouncedSearch.length >= 2,
    queryFn: ({ signal }) => fetchNetskopeUsers(debouncedSearch, 0, EMPTY_NETSKOPE_USERS_FILTERS, signal),
    retry: false, staleTime: 60_000, refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (users.error instanceof ApiError && users.error.status === 401) onUnauthorized();
    else if (users.error) onError(users.error instanceof Error ? users.error.message : t('No se pudieron buscar usuarios Netskope'));
  }, [users.error, onError, onUnauthorized]);

  function openSearchUser(row: NetskopeRow) {
    setSelectedUser({ userId: row.object_id, email: String(row.attributes.email || ''), name: row.display_name });
    setSearch('');
  }
  function openQueueUser(row: NetskopeAttentionRow) {
    const id = row.user_id === null ? null : Number(row.user_id);
    setSelectedUser({ userId: id !== null && Number.isSafeInteger(id) && id > 0 ? id : null, email: row.email, name: row.name || row.email });
  }

  return <section className="netskope-workspace nsk-users-workspace" aria-label={t('Riesgo de personas en Netskope')}>
    <section className="list-panel database-surface nsk-users-search" aria-label={t('Consultar una persona')}>
      <div className="nsk-users-search-heading"><h2>{t('Consultar una persona')}</h2><p>{t('Abrí su ficha para revisar confianza, últimos 7 días, anomalías y equipos.')}</p></div>
      <label className="search-box"><Search size={16} aria-hidden /><input ref={searchRef}
        type="search" aria-label={t('Buscar usuario por nombre o correo')} placeholder={t('Nombre o correo (mínimo 2 caracteres)')}
        maxLength={160} value={search} onChange={(event) => setSearch(event.target.value)}
      />{search ? <button type="button" aria-label={t('Limpiar búsqueda')} onClick={() => setSearch('')}><X size={14} aria-hidden /></button> : null}</label>
      {!selectedUser && users.isFetching ? <StateBlock variant="loading" title={t('Buscando usuarios Netskope')} /> : null}
      {!selectedUser && users.isError ? <StateBlock variant="error" title={t('No se pudieron buscar usuarios')} action={<button className="button subtle" type="button" onClick={() => void users.refetch()}>{t('Reintentar búsqueda')}</button>} /> : null}
      {!selectedUser && debouncedSearch.length >= 2 && search.trim() === debouncedSearch && users.data?.total === 0 ? <StateBlock variant="empty" title={t('Sin usuarios Netskope para esta búsqueda')} /> : null}
      {!selectedUser && users.data && search.trim() === debouncedSearch && debouncedSearch.length >= 2 && !users.isError && users.data.rows.length > 0 ? <div className="netskope-experience-results">
        <div className="netskope-experience-results-options" role="listbox" aria-label={t('Usuarios Netskope encontrados')}>
          {users.data.rows.map((row) => <button key={row.object_id} type="button" role="option" aria-selected="false" onClick={() => openSearchUser(row)}>
            <span className="netskope-experience-result-icon"><UserRound size={15} aria-hidden /></span>
            <span><strong>{row.display_name}</strong><small>{String(row.attributes.email || row.source_id)}</small></span>
            <span className="netskope-experience-result-action">{t('Abrir ficha')}</span>
          </button>)}
        </div>
        {users.data.total > users.data.rows.length ? <p>{t('Se muestran los primeros {rows} resultados. Refiná la búsqueda para encontrar otro usuario.', { rows: users.data.rows.length })}</p> : null}
      </div> : null}
    </section>
    <nav className="workspace-subnav workspace-subnav-nested" role="tablist" aria-label={t('Secciones de Riesgo')} onKeyDown={handleTablistKeyDown}>
      {tabs.map(([id, label]) => <button
        key={id} type="button" role="tab" id={`nsk-users-tab-${id}`} aria-controls={`nsk-users-panel-${id}`}
        aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}
      ><strong>{label}</strong></button>)}
    </nav>
    {tabs.map(([id]) => <div key={id} role="tabpanel" id={`nsk-users-panel-${id}`} aria-labelledby={`nsk-users-tab-${id}`} hidden={tab !== id}>
      {tab === id ? <>
      {!canReadUba ? <StateBlock variant="empty" title={t('Revisión de riesgo no disponible para tu rol')} hint={t('Podés buscar una persona para consultar sus equipos.')} />
        : tab === 'attention' ? <NetskopeAttentionQueue company={company} onClearCompany={() => setCompany('')} enabled={enabled} refreshKey={refreshKey} onUnauthorized={onUnauthorized} onPick={openQueueUser} />
        : <section className="list-panel database-surface nsk-users-companies" aria-label={t('Resumen de riesgo por empresa')}>
          <NetskopeUciCompanies refreshKey={refreshKey} enabled={enabled} onUnauthorized={onUnauthorized} onReview={(name) => { setCompany(name); setTab('attention'); }} />
          <button type="button" className="button subtle" onClick={() => onNavigate('netskopeUci')}>{t('Ver usuarios con señales de riesgo')}</button>
        </section>}
      </> : null}
    </div>)}
    {selectedUser && enabled ? <NetskopeUserDrawer key={selectedUser.email || selectedUser.userId} user={selectedUser} refreshKey={refreshKey}
      canReadUba={canReadUba} onUnauthorized={onUnauthorized} onClose={() => setSelectedUser(null)} fallbackFocusRef={searchRef} /> : null}
  </section>;
}
