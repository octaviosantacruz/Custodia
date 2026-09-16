import { Fragment, useEffect, useState, type KeyboardEvent } from 'react';
import { Check, History } from 'lucide-react';
import { listActivity, type ActivityEntry } from '../lib/activity-api';
import { formatDate, formatNumber, relativeTime } from '../lib/format';
import { StateBlock } from './state-block';
import { ActionTag, IdentityChip } from './semantic';
import { TablePagination } from './table-pagination';

const actionLabels: Record<string, string> = {
  create: 'Creó',
  update: 'Actualizó',
  role_change: 'Cambió rol',
  delete: 'Eliminó',
  export: 'Exportó',
  sync_start: 'Inició sync',
  sync_complete: 'Finalizó sync',
};

function actionLabel(action: string) { return actionLabels[action] || action; }
function entityLabel(entity: string) {
  return entity.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function isSystemActor(name: string) { return /sistema|system|automat|servicio/i.test(name); }
function syncResult(row: ActivityEntry) {
  if (row.entity_type !== 'ingestion_run' || !row.after_data) return <span className="result-tag"><Check size={14} aria-hidden />Registrado</span>;
  const data = row.after_data;
  const status = typeof data.status === 'string' ? data.status : '';
  if (status === 'running') return <span className="result-tag">En curso</span>;
  const objects = typeof data.received_objects === 'number' ? data.received_objects : 0;
  const relationships = typeof data.received_relationships === 'number' ? data.received_relationships : 0;
  const errors = typeof data.error_count === 'number' ? data.error_count : 0;
  return <span className="result-tag">{formatNumber(objects)} objetos · {formatNumber(relationships)} relaciones{errors > 0 ? ` · ${formatNumber(errors)} errores` : ''}</span>;
}
function activateRow(event: KeyboardEvent<HTMLTableRowElement>, activate: () => void) {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); }
}

export function ActivityView() {
  const [rows, setRows] = useState<ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const pageSize = 50;
  const hasFilters = Boolean(q || action || entityType);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    void listActivity({ page, pageSize, action, entityType, q })
      .then((result) => {
        if (!cancelled) { setRows(result.rows); setTotal(result.total); }
      }).catch((error) => {
        if (cancelled) return;
        setRows([]);
        setTotal(0);
        setLoadError(error instanceof Error ? error.message : 'No se pudo cargar la actividad');
      }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, action, entityType, q, reloadKey]);

  const colSpan = 5;

  return <section className="activity-panel">
    <div className="activity-toolbar">
      <label>Buscar<input type="search" aria-label="Buscar actividad por actor, Safe o entidad" value={q} onChange={(event) => { setQ(event.target.value); setPage(0); }} placeholder="Actor, Safe o entidad" /></label>
      <label>Acción<select aria-label="Filtrar actividad por acción" value={action} onChange={(event) => { setAction(event.target.value); setPage(0); }}><option value="">Todas</option><option value="create">Creación</option><option value="update">Actualización</option><option value="role_change">Cambio de rol</option><option value="delete">Eliminación</option><option value="export">Exportación</option><option value="sync_start">Inicio de sync</option><option value="sync_complete">Cierre de sync</option></select></label>
      <label>Objeto<select aria-label="Filtrar actividad por objeto" value={entityType} onChange={(event) => { setEntityType(event.target.value); setPage(0); }}><option value="">Todos</option><option value="user">Usuario</option><option value="safe_metadata">Safe</option><option value="safe_assignment">Asignación</option><option value="business_unit">Unidad</option><option value="responsible">Responsable</option><option value="safe_inventory">Inventario</option><option value="ingestion_run">Sync</option></select></label>
    </div>
    <div className="activity-meta"><span><History size={14} /> Registro de cambios administrativos</span><strong>{formatNumber(total)} eventos</strong></div>
    <div className="activity-table-wrap"><table className="activity-table"><thead><tr><th>Fecha</th><th>Actor</th><th>Acción</th><th>Objeto</th><th>Resultado</th></tr></thead><tbody>
      {loading
        ? <tr><td colSpan={colSpan}><StateBlock variant="loading" title="Cargando actividad…" /></td></tr>
        : loadError
          ? <tr><td colSpan={colSpan}><StateBlock variant="error" title="No se pudo cargar la actividad" hint={loadError} action={<button type="button" className="button subtle" onClick={() => setReloadKey((key) => key + 1)}>Reintentar</button>} /></td></tr>
          : rows.length
            ? rows.map((row) => <Fragment key={row.audit_id}>
                <tr className={expanded === row.audit_id ? 'expanded' : ''} tabIndex={0} aria-expanded={expanded === row.audit_id} aria-label={`${entityLabel(row.entity_type)}: ${expanded === row.audit_id ? 'ocultar' : 'ver'} detalle`} onClick={() => setExpanded((current) => current === row.audit_id ? null : row.audit_id)} onKeyDown={(event) => activateRow(event, () => setExpanded((current) => current === row.audit_id ? null : row.audit_id))}>
                  <td><span className="cell-stack"><span className="cell-lead">{relativeTime(row.created_at)}</span><time className="cell-sub" dateTime={row.created_at} title={formatDate(row.created_at)}>{formatDate(row.created_at)}</time></span></td>
                  <td><IdentityChip name={row.actor_name} kind={isSystemActor(row.actor_name) ? 'system' : 'user'} subtitle={row.actor_id} /></td>
                  <td><ActionTag action={row.action} label={actionLabel(row.action)} /></td>
                  <td><span className="cell-stack"><span className="cell-lead">{entityLabel(row.entity_type)}</span><span className="cell-sub">{row.entity_name || row.entity_id}</span></span></td>
                  <td>{syncResult(row)}</td>
                </tr>
                {expanded === row.audit_id && <tr className="activity-detail-row"><td className="activity-detail" colSpan={colSpan}><div><strong>Antes</strong><code>{row.before_data ? JSON.stringify(row.before_data, null, 2) : 'Sin valor anterior'}</code></div><div><strong>Después</strong><code>{row.after_data ? JSON.stringify(row.after_data, null, 2) : 'Sin valor posterior'}</code></div></td></tr>}
              </Fragment>)
            : <tr><td colSpan={colSpan}><StateBlock variant={hasFilters ? 'no-results' : 'empty'} title={hasFilters ? 'Sin actividad para estos filtros' : 'Sin actividad registrada'} hint={hasFilters ? 'Ajustá la búsqueda, la acción o el objeto.' : undefined} action={hasFilters ? <button type="button" className="button subtle" onClick={() => { setQ(''); setAction(''); setEntityType(''); setPage(0); }}>Limpiar filtros</button> : undefined} /></td></tr>}
    </tbody></table></div>
    <TablePagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
  </section>;
}
