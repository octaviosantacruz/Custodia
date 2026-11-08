import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { fetchAccessReview, type AccessReviewFilter, type AccessReviewFlag, type AccessReviewSummary } from '../lib/users-api';
import { formatNumber } from '../lib/format';
import { CompactSelect } from './compact-select';
import { DateTime } from './date-time';
import { StatusBadge } from './semantic';
import { StateBlock } from './state-block';
import { TablePagination } from './table-pagination';
import './access-review.css';
import { t } from '../i18n/index.ts';

const PAGE_SIZE = 25;
const DAY_OPTIONS = [30, 60, 90, 180, 365].map((days) => ({ value: String(days), label: `${days} días` }));
const FLAG_LABELS: Record<AccessReviewFlag, string> = {
  inactive_account: 'Cuenta inactiva con roles',
  manual_old: 'Asignación manual antigua',
  stale_login: 'Okta sin ingreso',
};

function Filters({ summary, flag, onChange }: { summary: AccessReviewSummary; flag: AccessReviewFilter; onChange: (flag: AccessReviewFilter) => void }) {
  const items: { value: AccessReviewFilter; label: string; count: number }[] = [
    { value: '', label: t('Todas'), count: summary.assignments },
    { value: 'attention', label: t('Requieren atención'), count: summary.attention },
    { value: 'inactive_account', label: FLAG_LABELS.inactive_account, count: summary.inactive_account },
    { value: 'manual_old', label: FLAG_LABELS.manual_old, count: summary.manual_old },
    { value: 'stale_login', label: FLAG_LABELS.stale_login, count: summary.stale_login },
  ];
  return <div className="access-review-filters" role="group" aria-label={t('Filtrar la revisión')}>
    {items.map((item) => <button key={item.value} type="button" className={`access-review-filter${flag === item.value ? ' is-active' : ''}`} aria-pressed={flag === item.value} onClick={() => onChange(item.value)}>
      <strong>{formatNumber(item.count)}</strong><span>{item.label}</span>
    </button>)}
  </div>;
}

/** ACCESS-REVIEW-001: who holds which role, how it was granted and the signals worth a second look. Read-only. */
export function AccessReview() {
  const [search, setSearch] = useState('');
  const [flag, setFlag] = useState<AccessReviewFilter>('attention');
  const [days, setDays] = useState(90);
  const [page, setPage] = useState(0);
  const deferredSearch = useDeferredValue(search.trim());
  const query = useQuery({
    queryKey: ['cross', 'access-review', deferredSearch, flag, days, page],
    queryFn: ({ signal }) => fetchAccessReview({ search: deferredSearch, flag, days, page, pageSize: PAGE_SIZE }, signal),
    placeholderData: (previous) => previous,
  });
  const data = query.data;

  return <section className="user-admin access-review">
    <header className="section-heading"><div><p className="eyebrow">{t('REVISIÓN PERIÓDICA')}</p><h2>{t('Revisión de accesos')}</h2><span className="database-caption">{t('Una fila por rol asignado. Sólo lectura: los cambios se hacen desde Usuarios.')}</span></div></header>
    <div className="user-directory-toolbar">
      <label className="search-box"><Search size={16} /><span className="sr-only">{t('Buscar en la revisión')}</span><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder={t('Buscar por persona, email o rol')} /></label>
      <CompactSelect value={String(days)} ariaLabel={t('Antigüedad para marcar')} options={DAY_OPTIONS} onChange={(value) => { setDays(Number(value)); setPage(0); }} />
    </div>
    {query.isLoading && <StateBlock variant="loading" title={t('Cargando la revisión')} />}
    {query.error && !data && <StateBlock variant="error" title={t('No se pudo cargar la revisión de accesos')} hint={query.error instanceof Error ? query.error.message : undefined} action={<button className="button subtle" type="button" onClick={() => void query.refetch()}>{t('Reintentar')}</button>} />}
    {data && <>
      <Filters summary={data.summary} flag={flag} onChange={(next) => { setFlag(next); setPage(0); }} />
      <p className="muted access-review-note">Se marca la asignación manual con {data.days} días o más y la identidad Okta sin ingreso en ese plazo. Las cuentas locales no registran ingreso y los roles de Okta se reescriben en cada login, por eso esos datos figuran «Sin dato» y no se estiman.</p>
      {data.rows.length === 0
        ? <StateBlock variant={flag || deferredSearch ? 'no-results' : 'empty'} title={flag === 'attention' && !deferredSearch ? t('Ninguna asignación requiere atención') : t('Sin asignaciones para estos filtros')} hint={flag === 'attention' ? `Con el plazo de ${data.days} días no hay señales. Probá «Todas» o un plazo menor.` : 'Ajustá la búsqueda o el filtro.'} />
        : <>
          <div className="user-directory-scroll"><table className="user-directory-table">
            <caption className="sr-only">{t('Asignaciones de rol para revisar')}</caption>
            <thead><tr><th scope="col">{t('Persona')}</th><th scope="col">{t('Rol')}</th><th scope="col">{t('Origen')}</th><th scope="col">{t('Asignado')}</th><th scope="col">{t('Último ingreso')}</th><th scope="col">{t('Señales')}</th></tr></thead>
            <tbody>
              {data.rows.map((row) => <tr key={`${row.actor_id}:${row.role_code}`}>
                <td><div className="user-row-identity"><strong>{row.display_name}</strong><span>{row.email || 'Sin email'}</span></div></td>
                <td>{row.role_name}</td>
                <td>{row.source === 'oidc' ? <span className="user-status-chip oidc">{t('Okta')}</span> : <span className="user-status-chip">{t('Custodia')}</span>}</td>
                <td>{row.source === 'manual' ? <div className="user-row-identity"><DateTime value={row.granted_at} /><span>{row.granted_by ? `por ${row.granted_by}` : 'Autor sin dato'}</span></div> : <span className="muted">{t('Según grupos de Okta')}</span>}</td>
                <td><DateTime value={row.last_login_at} /></td>
                <td>{row.flags.length ? <div className="access-review-flags">{row.flags.map((item) => <StatusBadge key={item} tone="warning">{FLAG_LABELS[item]}</StatusBadge>)}</div> : <span className="muted">{t('Sin señales')}</span>}</td>
              </tr>)}
            </tbody>
          </table></div>
          <TablePagination page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} />
        </>}
    </>}
  </section>;
}
