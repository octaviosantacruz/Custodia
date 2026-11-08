import { DateTime } from '../../../cross/components/date-time';
import { Search } from 'lucide-react';
import { useId, useState } from 'react';
import { CompactSelect } from '../../../cross/components/compact-select';
import { StateBlock } from '../../../cross/components/state-block';
import {  formatNumber } from '../../../cross/lib/format.ts';
import type { PamCleanupInventoryEvidence, PamCleanupSignal, PamCleanupSignalItem, PamCleanupSignalsResponse } from '../types/pam';
import { t } from '../../../cross/i18n/index.ts';

type SignalKey = keyof PamCleanupSignalsResponse;

const SIGNALS: Array<{ key: SignalKey; title: string; denominator: string }> = [
  { key: 'empty_groups', title: t('Grupos sin miembros'), denominator: 'grupos activos' },
  { key: 'identical_member_groups', title: t('Grupos con miembros idénticos'), denominator: 'grupos activos con miembros' },
  { key: 'redundant_groups_with_access_peer', title: t('Grupos redundantes frente a un par con acceso'), denominator: 'grupos activos con miembros' },
  { key: 'orphan_psm', title: t('PSM activos sin plataforma'), denominator: 'PSM activos' },
  { key: 'platforms_without_accounts', title: t('Plataformas sin cuentas activas'), denominator: 'plataformas activas' },
  { key: 'safes_without_active_users', title: t('Safes sin usuarios activos'), denominator: 'Safes activos' },
];

const RUN_STATUS = { queued: 'En cola', running: 'En curso', completed: 'Completada', partial: 'Parcial', failed: 'Fallida' };

function InventoryEvidence({ evidence }: { evidence: PamCleanupInventoryEvidence }) {
  const latest = evidence.latest_attempt;
  const completed = evidence.last_completed_inventory;
  return <div className="pam-cleanup-ingestion">
    <small>{evidence.family === 'pam_inventory' ? t('Inventario PAM y relaciones') : t('Catálogo PSM · no actualiza relaciones de plataformas')}</small>
    {latest ? <small>Último intento · {latest.source_file}: {RUN_STATUS[latest.status]} · {latest.status === 'queued'
      ? <>encolado <DateTime value={latest.enqueued_at} /></>
      : latest.completed_at ? <>{t('finalización')} <DateTime value={latest.completed_at} /></> : <>inicio <DateTime value={latest.started_at} /></>}
      {latest.status === 'completed' && !latest.inventory_refreshed ? t(' · sin evidencia de actualización del inventario') : ''}
    </small> : <small>{t('Sin corrida pertinente registrada')}</small>}
    {completed?.completed_at
      ? <small>{t('Última ingesta completada:')} <DateTime value={completed.completed_at} /></small>
      : <small>{t('Frescura no disponible · sin ingesta completada acreditada')}</small>}
  </div>;
}

function ScopeLabel({ item }: { item: PamCleanupSignalItem }) {
  if (item.inventory_scope === null) return null;
  const scope = item.inventory_scope === 'internal'
    ? 'Interno'
    : item.inventory_scope === 'business' ? t('Negocio') : t('Pendiente de clasificación');
  const accountType = item.account_type_classification
    ? ` · tipo de cuenta: ${item.account_type_classification}`
    : '';
  const status = item.classification_status ? ` · estado: ${item.classification_status}` : '';
  return <small className="pam-cleanup-classification">Alcance: {scope}{accountType}{status}</small>;
}

function SignalItem({ item }: { item: PamCleanupSignalItem }) {
  return <tr>
    <td>
      <span className="pam-cleanup-identity">
        <strong>{item.display_name}</strong>
        <small>{item.source_id}</small>
        {item.is_factory && item.factory_label
          ? <span className="pam-cleanup-factory">{item.factory_label} · no se sugiere baja automática</span>
          : null}
        {item.member_count !== null ? <small>{formatNumber(item.member_count)} miembros activos</small> : null}
        {item.safe_count !== null ? <small>{formatNumber(item.safe_count)} Safes con acceso</small> : null}
        {item.peer_groups.length ? <span className="pam-cleanup-peers">Par/es: {item.peer_groups.map((peer) =>
          <small key={peer.object_id}>{peer.display_name} · {peer.source_id} · {formatNumber(peer.safe_count)} Safes con acceso</small>
        )}</span> : null}
        <ScopeLabel item={item} />
      </span>
    </td>
    <td>{item.reason}</td>
  </tr>;
}

function SignalPanel({ signal, title, denominator, search }: {
  signal: PamCleanupSignal;
  title: string;
  denominator: string;
  search: string;
}) {
  const captionId = useId();
  const query = search.trim().toLocaleLowerCase();
  const items = signal.items.filter((item) => !query || [item.display_name, item.source_id,
    ...item.peer_groups.flatMap((peer) => [peer.display_name, peer.source_id]),
  ].some((value) => value.toLocaleLowerCase().includes(query)));
  return <article className="pam-cleanup-signal">
    <header className="pam-cleanup-signal-heading">
      <div>
        <h4>{title}</h4>
        <small>{t('Cálculo:')} <DateTime value={signal.computed_at} /></small>
      </div>
      <strong>{formatNumber(signal.count)} <span>/ {formatNumber(signal.denominator)} {denominator}</span></strong>
    </header>
    <div className="pam-cleanup-evidence" aria-label={t('Evidencia de ingesta de la categoría')}>
      {signal.inventory_runs.map((evidence) => <InventoryEvidence key={evidence.family} evidence={evidence} />)}
      <small>{t('El historial de corridas no atribuye cada fila a una captura histórica. Recalcular no actualiza la ingesta.')}</small>
    </div>
    <p className="pam-cleanup-results" role="status">Mostrando {formatNumber(items.length)} de {formatNumber(signal.items.length)} objetos de esta categoría</p>
    {items.length ? <div className="compact-table-wrap" role="region" aria-labelledby={captionId} tabIndex={0}>
      <table className="compact-table pam-cleanup-table">
        <caption id={captionId} className="sr-only">{title}: detalle y motivo</caption>
        <thead><tr><th>{t('Objeto')}</th><th>{t('Motivo')}</th></tr></thead>
        <tbody>{items.map((item) => <SignalItem key={item.object_id} item={item} />)}</tbody>
      </table>
    </div> : <StateBlock variant="empty" title={signal.items.length ? 'Sin coincidencias para esta búsqueda' : signal.denominator === 0 ? t('Sin inventario activo en esta categoría') : t('Sin señales para esta categoría')} />}
  </article>;
}

export function PamCleanupSignalsView({
  data,
  loading,
  error,
}: {
  data: PamCleanupSignalsResponse | undefined;
  loading: boolean;
  error: string;
}) {
  const [selectedKey, setSelectedKey] = useState<SignalKey>('empty_groups');
  const [search, setSearch] = useState('');
  if (loading) return <StateBlock variant="loading" title={t('Calculando señales de limpieza PAM…')} />;
  if (error) return <StateBlock variant="error" title={t('No se pudieron cargar las señales de limpieza PAM')} hint={error} />;
  if (!data) return <StateBlock variant="empty" title={t('Todavía no hay señales de limpieza disponibles')} />;

  const allClear = SIGNALS.every(({ key }) => data[key].count === 0);
  const inventoryEmpty = SIGNALS.every(({ key }) => data[key].denominator === 0);
  const selected = SIGNALS.find(({ key }) => key === selectedKey)!;
  return <>
    {allClear ? <StateBlock variant="empty" title={inventoryEmpty ? t('Sin inventario activo disponible para calcular señales') : t('No se encontraron señales con los datos activos disponibles')} hint="Cero señales no demuestra ausencia de problemas." /> : null}
    <div className="pam-cleanup-content">
      <div className="pam-cleanup-summary" role="group" aria-label={t('Resumen de las seis categorías')}>
        {SIGNALS.map(({ key, title, denominator }) => <div className="pam-cleanup-summary-item" key={key}>
          <strong>{title}</strong>
          <span>{formatNumber(data[key].count)} / {formatNumber(data[key].denominator)} {denominator}</span>
        </div>)}
      </div>
      <div className="pam-cleanup-controls">
        <CompactSelect ariaLabel={t('Categoría de limpieza PAM')} value={selectedKey} options={SIGNALS.map(({ key, title }) => ({ value: key, label: title }))} onChange={(value) => setSelectedKey(value as SignalKey)} />
        <label className="search-box"><Search size={16} aria-hidden="true" /><input type="search" aria-label={t('Buscar objeto o par en la categoría')} placeholder={t('Nombre o identificador de objeto/par')} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <button type="button" className="button subtle" disabled={!search} onClick={() => setSearch('')}>{t('Limpiar búsqueda')}</button>
      </div>
      <SignalPanel signal={data[selectedKey]} title={selected.title} denominator={selected.denominator} search={search} />
    </div>
  </>;
}
