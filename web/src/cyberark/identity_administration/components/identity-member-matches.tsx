import { DateTime } from '../../../cross/components/date-time';
import { HelpHint } from '../../../cross/components/help-hint';
import { IdentityChip, StatusBadge } from '../../../cross/components/semantic';
import type { IdentityRoleMatchRef, IdentityRoleMatches } from '../types/identity';
import type { RoleMatchIndex, RoleMatchInfo } from '../lib/identity-role-matches';
import './identity-member-matches.css';

export const MATCH_SCOPE = t('Coincidencia de miembros: no prueba permisos iguales ni autoriza retirar roles. Sin acciones de eliminación.');

type BarProps = {
  requested: boolean;
  loading: boolean;
  error: boolean;
  data: IdentityRoleMatches | undefined;
  index: RoleMatchIndex | null;
  onlyMatches: boolean;
  onRequest: () => void;
  onRetry: () => void;
  onToggleOnly: () => void;
};

/** Summary strip above the roles table: the member-match analysis is part of
 *  the listing, not a separate panel. It stays lazy (the analysis walks every
 *  role) and only gains row chips and the filter once it has been requested. */
export function IdentityMatchBar({ requested, loading, error, data, index, onlyMatches, onRequest, onRetry, onToggleOnly }: BarProps) {
  const matched = index ? index.objectIds.length : 0;
  return <div className="identity-match-bar" aria-label={t('Coincidencia de miembros')}>
    <span className="identity-match-title">{t('Coincidencia de miembros')}</span>
    <HelpHint label={t('coincidencia de miembros')}>{MATCH_SCOPE}</HelpHint>
    {!requested ? <button type="button" className="button subtle" onClick={onRequest}>Analizar coincidencias</button> : null}
    {requested && loading && !data ? <span role="status" className="muted">{t('Cargando coincidencias…')}</span> : null}
    {requested && error ? <span role="alert" className="identity-match-error">{t('No se pudo cargar la coincidencia de miembros.')} <button type="button" className="button subtle" onClick={onRetry}>Reintentar</button></span> : null}
    {data && index ? <>
      {matched === 0
        ? <span role="status" className="muted">{data.complete ? t('Sin coincidencias de miembros') : t('Sin coincidencias en el análisis parcial')}</span>
        : <>
          <StatusBadge tone="info">{t('{directGroups} {grupos} con los mismos miembros directos', { directGroups: index.directGroups, grupos: index.directGroups === 1 ? 'grupo' : 'grupos' })}</StatusBadge>
          <StatusBadge tone="identity">{t('{accountGroups} {grupos} con las mismas cuentas', { accountGroups: index.accountGroups, grupos: index.accountGroups === 1 ? 'grupo' : 'grupos' })}</StatusBadge>
          <button type="button" className={`identity-match-filter${onlyMatches ? ' active' : ''}`} aria-pressed={onlyMatches} onClick={onToggleOnly}>{t('Solo con coincidencias ({matched})', { matched: matched })}</button>
        </>}
      {!data.complete ? <span role="alert" className="identity-match-incomplete"><StatusBadge tone="warning">{t('Análisis incompleto · {roles_excluded} {excluidos}', { roles_excluded: data.roles_excluded, excluidos: data.roles_excluded === 1 ? 'rol excluido' : 'roles excluidos' })}</StatusBadge>
        <HelpHint label={t('análisis incompleto')}>{t('Hay roles excluidos por camino incompleto o la última corrida no terminó, así que pueden faltar coincidencias.')}</HelpHint></span> : null}
      <span className="identity-match-provenance muted">Última corrida: {data.source.last_run_status ?? t('Sin dato')} · {data.source.last_run_finished_at ? <DateTime value={data.source.last_run_finished_at} /> : 'fecha no disponible'}</span>
    </> : null}
  </div>;
}

function plural(count: number, one: string, many: string) { return `${count} ${count === 1 ? one : many}`; }

/** Compact chips shown in the row's Membresía cell. */
export function RoleMatchChips({ info }: { info: RoleMatchInfo | undefined }) {
  if (!info || (!info.sameMembers.length && !info.sameAccounts.length)) return null;
  return <span className="identity-match-chips">
    {info.sameMembers.length ? <StatusBadge tone="info">{t('{roles} con los mismos miembros', { roles: plural(info.sameMembers.length, 'rol', 'roles') })}</StatusBadge> : null}
    {info.sameAccounts.length ? <StatusBadge tone="identity">{t('{roles} con las mismas cuentas', { roles: plural(info.sameAccounts.length, 'rol', 'roles') })}</StatusBadge> : null}
  </span>;
}

function RoleRefs({ refs, onOpen }: { refs: IdentityRoleMatchRef[]; onOpen: (ref: IdentityRoleMatchRef) => void }) {
  return <span className="identity-match-refs">{refs.map((ref) => <IdentityChip key={ref.id} name={ref.name} kind="role" onSelect={ref.object_id === null ? undefined : () => onOpen(ref)} />)}</span>;
}

/** Detail shown inside the expanded row, above the membership panel. */
export function RoleMatchDetails({ info, onOpen }: { info: RoleMatchInfo | undefined; onOpen: (ref: IdentityRoleMatchRef) => void }) {
  if (!info || (!info.sameMembers.length && !info.sameAccounts.length)) return null;
  return <div className="identity-match-details">
    {info.sameMembers.length ? <div className="identity-match-detail">
      <span className="identity-match-detail-label">Mismos miembros directos <span className="muted">({info.directMembers ?? 0})</span></span>
      <RoleRefs refs={info.sameMembers} onOpen={onOpen} />
    </div> : null}
    {info.sameAccounts.length ? <div className="identity-match-detail">
      <span className="identity-match-detail-label">{t('Mismas cuentas por todos los caminos')} <span className="muted">({info.referencedAccounts ?? 0})</span></span>
      <RoleRefs refs={info.sameAccounts} onOpen={onOpen} />
      {info.reaches.length ? <span className="identity-match-reaches muted" role="list" aria-label={t('Recorrido de este rol')}>Alcanza: {info.reaches.map((step, position) => <span role="listitem" key={step.id}>{position ? ', ' : ''}{step.name}</span>)}</span> : null}
    </div> : null}
    <p className="identity-match-scope muted">{MATCH_SCOPE}</p>
  </div>;
}

import { t } from '../../../cross/i18n/index.ts';