import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Search } from 'lucide-react';
import { ApiError } from '../../../cross/lib/api';
import { formatNumber } from '../../../cross/lib/format';
import { DateTime } from '../../../cross/components/date-time';
import { HelpHint } from '../../../cross/components/help-hint';
import { LoadMore } from '../../../cross/components/load-more';
import { StateBlock } from '../../../cross/components/state-block';
import { fetchConnectorCatalog, type ConnectorCatalog } from '../lib/connector-manager-api';
import './connector-manager-catalog.css';

type Props = {
  catalog: ConnectorCatalog; selector: ReactNode; refreshKey: number;
  authChecked: boolean; authenticated: boolean; onUnauthorized: () => void;
};
const PAGE_SIZE = 50;
const count = (value: number | null) => value == null ? t('Sin dato') : formatNumber(value);

export function ConnectorManagerCatalog({ catalog, selector, refreshKey, authChecked, authenticated, onUnauthorized }: Props) {
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const query = useQuery({
    queryKey: ['connector-manager', catalog, refreshKey],
    enabled: authChecked && authenticated,
    queryFn: ({ signal }) => fetchConnectorCatalog(catalog, signal),
    staleTime: 0,
  });
  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401) onUnauthorized();
  }, [query.error, onUnauthorized]);
  const rows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return (query.data?.rows || []).filter((row) => `${row.name} ${'description' in row ? row.description || '' : ''}`.toLocaleLowerCase().includes(term));
  }, [query.data, search]);
  const label = catalog === 'pools' ? 'pools' : 'redes';
  return <section className="list-panel database-surface connector-manager-catalog" aria-label={t('Inventario de Connector Manager')} aria-busy={query.isFetching}>
    <header className="connector-manager-heading"><div><h2>{catalog === 'pools' ? t('Pools de conectores') : t('Redes de conectores')}</h2>
      <p>Connector Manager · Consulta en vivo{query.data && !query.error ? <> · <DateTime value={query.data.queried_at} hint="Consulta completa de este catálogo" /></> : null}
        <HelpHint label={t('Qué informa Connector Manager')}><p>Catálogo independiente de PSM y SIA, consultado en vivo. Los conteos son los informados por Connector Manager; no miden salud, capacidad ni cobertura. Se excluyen valores de red, hostnames y valores de identificadores. Sin un conteo informado se muestra «Sin dato».</p></HelpHint>
      </p></div><div className="connector-manager-actions"><span className="database-toolbar-count">{query.error || !query.data ? t('Sin dato') : `${formatNumber(query.data.total)} ${label}`}</span>{selector}<button className="button subtle" type="button" disabled={query.isFetching || !authChecked || !authenticated} onClick={() => void query.refetch()}><RefreshCw size={14} aria-hidden />{query.isFetching ? 'Consultando…' : 'Consultar ahora'}</button></div></header>
    <div className="search-row"><label className="search-box"><Search size={16} aria-hidden /><input type="search" aria-label={t('Buscar {value} de Connector Manager', { value: label })} placeholder={t('Buscar por nombre')} value={search} onChange={(event) => { setSearch(event.target.value); setVisible(PAGE_SIZE); }} /></label></div>
    {query.error ? <StateBlock variant="error" title={t('No se pudo consultar Connector Manager')} hint={query.error.message} action={<button type="button" className="button subtle" onClick={() => void query.refetch()}>Reintentar</button>} />
      : !authChecked || !authenticated || query.isPending ? <StateBlock variant="loading" title="Consultando Connector Manager…" />
        : !rows.length ? <StateBlock variant={search ? 'no-results' : 'empty'} title={search ? t('Sin resultados para esta búsqueda') : t('Connector Manager no informó {value}', { value: label })} action={search ? <button type="button" className="button subtle" onClick={() => { setSearch(''); setVisible(PAGE_SIZE); }}>{t('Limpiar búsqueda')}</button> : undefined} />
          : <><div className="compact-table-wrap"><table className="compact-table connector-manager-table"><caption className="sr-only">{t('{Redes} de Connector Manager', { Redes: catalog === 'pools' ? 'Pools' : 'Redes' })}</caption><thead><tr><th scope="col">{t('Nombre')}</th>{catalog === 'pools' ? <><th scope="col">{t('Descripción')}</th><th scope="col">Redes asociadas</th><th scope="col">Identificadores</th><th scope="col">{t('Conectores de plataforma')}</th><th scope="col">{t('Conectores de acceso')}</th></> : <th scope="col">Pools asociados</th>}<th scope="col">{t('Creación')}</th><th scope="col">{t('Actualización')}</th></tr></thead><tbody>{rows.slice(0, visible).map((row) => <tr key={row.id}><th scope="row">{row.name}</th>{'description' in row ? <><td className="connector-manager-description">{row.description || t('Sin dato')}</td><td>{count(row.assigned_network_count)}</td><td>{count(row.identifiers_count)}</td><td>{count(row.platform_connectors_count)}</td><td>{count(row.access_connectors_count)}</td></> : <td>{count(row.assigned_pool_count)}</td>}<td><DateTime value={row.created_at} /></td><td><DateTime value={row.updated_at} /></td></tr>)}</tbody></table></div>
            <LoadMore loaded={Math.min(visible, rows.length)} total={rows.length} pageSize={PAGE_SIZE} loading={false} onLoadMore={() => setVisible((current) => current + PAGE_SIZE)} /></>}
  </section>;
}

import { t } from '../../../cross/i18n/index.ts';