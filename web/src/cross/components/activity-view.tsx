import { Fragment, useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Download, History, Search } from 'lucide-react';
import { ApiError } from '../lib/api';
import { exportActivity, listActivity, type ActivityEntry } from '../lib/activity-api';
import { dateTimeHint, formatDate, formatNumber } from '../lib/format';
import { StateBlock } from './state-block';
import { ActionTag, IdentityChip } from './semantic';
import { TablePagination } from './table-pagination';
import { CompactSelect } from './compact-select';
import { syncSourceLabel } from '../lib/sync-source';
import { PageVolumeHistogram } from './page-volume-histogram';
import { HelpHint } from './help-hint';
import './activity-table.css';
import { t } from '../i18n/index.ts';

const ACTION_FILTER_OPTIONS = [
  { value: '', label: t('Todas') },
  { value: 'create', label: t('Creación') },
  { value: 'update', label: t('Actualización') },
  { value: 'role_change', label: t('Cambio de rol') },
  { value: 'delete', label: t('Eliminación') },
  { value: 'export', label: t('Exportación') },
  { value: 'sync_queued', label: t('Sync en cola') },
  { value: 'sync_start', label: t('Inicio de sync') },
  { value: 'sync_complete', label: t('Cierre de sync') },
  { value: 'sync_requeued', label: t('Sync reencolado') },
];

const ENTITY_FILTER_OPTIONS = [
  { value: '', label: t('Todos') },
  { value: 'user', label: t('Usuario') },
  { value: 'safe_metadata', label: t('Safe') },
  { value: 'safe_assignment', label: t('Asignación') },
  { value: 'business_unit', label: t('Unidad') },
  { value: 'responsible', label: t('Responsable') },
  { value: 'safe_inventory', label: t('Inventario') },
  { value: 'ingestion_run', label: t('Sync') },
];

const actionLabels: Record<string, string> = {
  create: t('Creó'),
  update: t('Actualizó'),
  role_change: t('Cambió rol'),
  delete: t('Eliminó'),
  export: t('Exportó'),
  sync_queued: t('Encoló sync'),
  sync_start: t('Inició sync'),
  sync_complete: t('Finalizó sync'),
  oidc_groups_observed: t('Actualizó grupos de Okta'),
  sync_requeued: t('Reencoló sync'),
};

function actionLabel(action: string) { return actionLabels[action] || action; }
function entityLabel(entity: string) {
  if (entity === 'workspace_preferences') return t('Preferencias de workspace');
  if (entity === 'ingestion_run') return t('Sincronización');
  return entity.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function isSystemActor(name: string) { return /sistema|system|automat|servicio/i.test(name); }
function entitySubtitle(row: ActivityEntry): string {
  if (row.entity_type === 'ingestion_run') return syncSourceLabel(row.entity_name);
  return row.entity_name || row.entity_id;
}
function syncResult(row: ActivityEntry) {
  if (row.entity_type === 'workspace_preferences') return <span className="result-tag"><Check size={14} aria-hidden />{t('Preferencias guardadas')}</span>;
  if (row.entity_type !== 'ingestion_run' || !row.after_data) return <span className="result-tag"><Check size={14} aria-hidden />{t('Registrado')}</span>;
  const data = row.after_data;
  const status = typeof data.status === 'string' ? data.status : '';
  const source = typeof data.source_system === 'string' ? syncSourceLabel(data.source_system) : 'Fuente desconocida';
  const sourcePrefix = <><strong>{source}</strong> · </>;
  if (status === 'queued') return <span className="result-tag">{sourcePrefix}En espera</span>;
  if (status === 'running') return <span className="result-tag">{sourcePrefix}En curso</span>;
  if (status === 'failed') return <span className="result-tag">{sourcePrefix}Fallida</span>;
  const objects = typeof data.received_objects === 'number' ? data.received_objects : 0;
  const relationships = typeof data.received_relationships === 'number' ? data.received_relationships : 0;
  const errors = typeof data.error_count === 'number' ? data.error_count : 0;
  return <span className="result-tag">{sourcePrefix}{formatNumber(objects)} objetos · {formatNumber(relationships)} relaciones{errors > 0 ? ` · ${formatNumber(errors)} errores` : ''}</span>;
}
function ActivityDetail({ row }: { row: ActivityEntry }) {
  const data = row.after_data || {};
  if (row.entity_type === 'ingestion_run') {
    const source = typeof data.source_system === 'string' ? syncSourceLabel(data.source_system) : 'Fuente desconocida';
    const status = typeof data.status === 'string' ? data.status : 'registrada';
    const objects = typeof data.received_objects === 'number' ? formatNumber(data.received_objects) : '—';
    const relationships = typeof data.received_relationships === 'number' ? formatNumber(data.received_relationships) : '—';
    const errors = typeof data.error_count === 'number' ? formatNumber(data.error_count) : '—';
    return <div className="activity-detail">
      <div className="activity-detail-summary">
        <div><small>{t('Fuente')}</small><strong>{source}</strong></div>
        <div><small>{t('Estado')}</small><strong>{status === 'completed' ? 'Completada' : status === 'failed' ? 'Fallida' : status === 'running' ? t('En curso') : t('En espera')}</strong></div>
        <div><small>{t('Objetos')}</small><strong>{objects}</strong></div>
        <div><small>{t('Relaciones')}</small><strong>{relationships}</strong></div>
        <div><small>{t('Errores')}</small><strong>{errors}</strong></div>
      </div>
      <details className="activity-technical-details"><summary>{t('Ver datos técnicos')}</summary><code>{JSON.stringify(data, null, 2)}</code></details>
    </div>;
  }
  return <div className="activity-detail activity-detail-json">
    <div><strong>{t('Antes')}</strong><code>{row.before_data ? JSON.stringify(row.before_data, null, 2) : t('Sin valor anterior')}</code></div>
    <div><strong>{t('Después')}</strong><code>{row.after_data ? JSON.stringify(row.after_data, null, 2) : t('Sin valor posterior')}</code></div>
  </div>;
}

export function ActivityView({ canExport = false, onUnauthorized }: { canExport?: boolean; onUnauthorized?: () => void }) {
  const [rows, setRows] = useState<ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [requestReady, setRequestReady] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const pageSize = 50;
  const hasFilters = Boolean(q || action || entityType);
  const startQuery = (update: () => void) => {
    setRows([]); setTotal(0); setLoading(true); setLoadError(''); setRequestReady(false); setExpanded(null);
    update();
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setRequestReady(false);
    void listActivity({ page, pageSize, action, entityType, q })
      .then((result) => {
        if (!cancelled) { setRows(result.rows); setTotal(result.total); setRequestReady(true); }
      }).catch((error) => {
        if (cancelled) return;
        // FE-AUD-005: an expired session goes to the shared sign-in flow; retry is for recoverable errors.
        if (error instanceof ApiError && error.status === 401) { onUnauthorized?.(); return; }
        setRows([]);
        setTotal(0);
        setLoadError(error instanceof Error ? error.message : t('No se pudo cargar la actividad'));
      }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onUnauthorized is only called on a 401; its identity must not refetch the page
  }, [page, action, entityType, q, reloadKey]);

  const exportCsv = async () => {
    setExporting(true);
    setExportMessage(null);
    try {
      await exportActivity({ action, entityType, q });
      setExportMessage({ tone: 'ok', text: hasFilters ? t('CSV descargado con los filtros activos') : t('CSV descargado') });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) { onUnauthorized?.(); return; }
      setExportMessage({ tone: 'error', text: error instanceof Error ? error.message : t('No se pudo exportar la actividad') });
    } finally { setExporting(false); }
  };

  const colSpan = 5;
  const activityTimes = rows.map((row) => row.created_at);

  return <section className="activity-panel">
     <div className="activity-toolbar">
       <label className="search-box"><Search size={16} aria-hidden="true" /><input type="search" aria-label={t('Buscar actividad por actor, Safe o entidad')} value={q} onChange={(event) => startQuery(() => { setQ(event.target.value); setPage(0); })} placeholder={t('Actor, Safe o entidad')} /></label>
       <label>{t('Acción')}<CompactSelect ariaLabel={t('Filtrar actividad por acción')} value={action} onChange={(value) => startQuery(() => { setAction(value); setPage(0); })} options={ACTION_FILTER_OPTIONS} /></label>
       <label>{t('Objeto')}<CompactSelect ariaLabel={t('Filtrar actividad por objeto')} value={entityType} onChange={(value) => startQuery(() => { setEntityType(value); setPage(0); })} options={ENTITY_FILTER_OPTIONS} /></label>
       {canExport && <button type="button" className="button subtle" disabled={exporting || loading || total === 0} onClick={() => void exportCsv()}><Download size={15} aria-hidden="true" />{exporting ? t('Exportando…') : t('Exportar CSV')}</button>}
    </div>
     {exportMessage && <p className="muted" role={exportMessage.tone === 'error' ? 'alert' : 'status'}>{exportMessage.text}</p>}
     <div className="activity-meta"><span><History size={14} /> {t('Registro de cambios administrativos')}</span><strong>{formatNumber(total)} eventos</strong><HelpHint label={t('Acerca del registro')}><p>{t('La tabla muestra la bitácora administrativa recibida, con búsqueda, filtros y paginación. El histograma cuenta sólo las filas de la página actual (UTC), no el total histórico por día.')}</p></HelpHint></div>
     <PageVolumeHistogram timestamps={activityTimes} state={loadError ? 'error' : loading || !requestReady ? 'loading' : 'ready'} title={t('Volumen de esta página')} help="Agrupa por día UTC las filas de la página actualmente cargada. Los filtros y la paginación aplican; no representa el total diario del historial." />
    <div className="activity-table-wrap"><table className="activity-table"><thead><tr><th>{t('Fecha')}</th><th>{t('Actor')}</th><th>{t('Acción')}</th><th>{t('Objeto')}</th><th>{t('Resultado')}</th></tr></thead><tbody>
      {loading
        ? <tr><td colSpan={colSpan}><StateBlock variant="loading" title={t('Cargando actividad…')} /></td></tr>
        : loadError
          ? <tr><td colSpan={colSpan}><StateBlock variant="error" title={t('No se pudo cargar la actividad')} hint={loadError} action={<button type="button" className="button subtle" onClick={() => setReloadKey((key) => key + 1)}>{t('Reintentar')}</button>} /></td></tr>
          : rows.length
            ? rows.map((row) => <Fragment key={row.audit_id}>
                <tr className={expanded === row.audit_id ? 'expanded' : ''} onClick={() => setExpanded((current) => current === row.audit_id ? null : row.audit_id)}>
                  <td><span className="row-expand-cell"><button type="button" className="row-expand-button" aria-expanded={expanded === row.audit_id} aria-controls={`activity-detail-${row.audit_id}`} aria-label={t('{Ver} detalle de {entity_type}', { Ver: expanded === row.audit_id ? t('Ocultar') : t('Ver'), entity_type: entityLabel(row.entity_type) })} title={`${expanded === row.audit_id ? t('Ocultar') : t('Ver')} detalle`} onClick={(event) => { event.stopPropagation(); setExpanded((current) => current === row.audit_id ? null : row.audit_id); }}>{expanded === row.audit_id ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}</button><span className="cell-stack"><time className="cell-lead" dateTime={row.created_at} title={dateTimeHint(row.created_at)}>{formatDate(row.created_at)}</time></span></span></td>
                  <td><IdentityChip name={row.actor_name} kind={isSystemActor(row.actor_name) ? 'system' : 'user'} subtitle={row.actor_id === row.actor_name ? undefined : row.actor_id} /></td>
                  <td><ActionTag action={row.action} label={actionLabel(row.action)} /></td>
                  <td><span className="cell-stack"><span className="cell-lead">{entityLabel(row.entity_type)}</span><span className="cell-sub">{entitySubtitle(row)}</span></span></td>
                  <td>{syncResult(row)}</td>
                </tr>
                {expanded === row.audit_id && <tr className="activity-detail-row" id={`activity-detail-${row.audit_id}`}><td colSpan={colSpan}><ActivityDetail row={row} /></td></tr>}
              </Fragment>)
            : <tr><td colSpan={colSpan}><StateBlock variant={hasFilters ? 'no-results' : 'empty'} title={hasFilters ? t('Sin actividad para estos filtros') : t('Sin actividad registrada')} hint={hasFilters ? t('Ajustá la búsqueda, la acción o el objeto.') : undefined} action={hasFilters ? <button type="button" className="button subtle" onClick={() => { setQ(''); setAction(''); setEntityType(''); setPage(0); }}>{t('Limpiar filtros')}</button> : undefined} /></td></tr>}
    </tbody></table></div>
    <TablePagination page={page} pageSize={pageSize} total={total} onPageChange={(nextPage) => {
      if (nextPage === page) return;
      startQuery(() => setPage(nextPage));
    }} />
  </section>;
}
