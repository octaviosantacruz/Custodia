import { Fragment, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronRight, FileUp, Search } from 'lucide-react';
import { useConnectionInventory } from '../hooks/use-connection-inventory';
import { importConnectionInventory } from '../lib/connection-inventory-api';
import { parseConnectionInventoryCsv } from '../lib/connection-inventory-csv';
import { formatNumber } from '../lib/format';
import { IdentityChip, StatusBadge, TagChip } from './semantic';
import { StateBlock } from './state-block';
import { TablePagination } from './table-pagination';
import type { ConnectionCoverageFilter, ConnectionInventoryRow } from '../types/connection';
import { CompactSelect } from './compact-select';
import { useExecutiveAnalytics } from '../hooks/use-executive-analytics';

const PAGE_SIZE = 50;

function resultLabel(count: number): string {
  return `${formatNumber(count)} ${count === 1 ? 'conexión' : 'conexiones'}`;
}

function activateRow(event: KeyboardEvent<HTMLTableRowElement>, activate: () => void) {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); }
}

function booleanLabel(value: boolean | null): string {
  return value === true ? 'Sí' : value === false ? 'No' : 'Sin dato';
}

function booleanTone(value: boolean | null): 'success' | 'danger' | 'neutral' {
  return value === true ? 'success' : value === false ? 'danger' : 'neutral';
}

function serviceHint(port: number | null): string {
  const labels: Record<number, string> = {
    22: 'SSH · Linux posible', 3389: 'RDP · Windows posible', 5985: 'WinRM · Windows posible',
    5986: 'WinRM HTTPS · Windows posible', 1433: 'SQL Server', 1521: 'Oracle',
    3306: 'MySQL/MariaDB', 5432: 'PostgreSQL', 27017: 'MongoDB', 6379: 'Redis',
  };
  return port ? labels[port] || `Puerto ${port}` : 'Puerto sin dato';
}

function CoverageBadge({ row }: { row: ConnectionInventoryRow }) {
  if (row.safe_match_count && row.sia_match_count) return <StatusBadge tone="success">Cubierta en Safe + SIA</StatusBadge>;
  if (row.safe_match_count || row.sia_match_count) return <StatusBadge tone="warning">Cobertura parcial</StatusBadge>;
  return <StatusBadge tone="neutral">Sin coincidencia</StatusBadge>;
}

function SourceBadge({ value, label }: { value: boolean | null; label: string }) {
  return <StatusBadge tone={booleanTone(value)}>{label}: {booleanLabel(value)}</StatusBadge>;
}

type Props = {
  authChecked: boolean;
  authenticated: boolean;
  includeInternal: boolean;
  canManage: boolean;
  initialSearch?: string;
  initialEnvironment?: string;
  initialCoverage?: ConnectionCoverageFilter | '';
  onUnauthorized: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
};

export function ConnectionInventoryWorkspace({ authChecked, authenticated, includeInternal, canManage, initialSearch = '', initialEnvironment = '', initialCoverage = '', onUnauthorized, onError, onNotice }: Props) {
  const { search, setSearch, environment, setEnvironment, coverage, setCoverage, page, setPage, loading, rows, total, importInfo, loadError, reload } = useConnectionInventory({ authChecked, authenticated, includeInternal, initialSearch, initialEnvironment, initialCoverage, onUnauthorized, onError });
  const executive = useExecutiveAnalytics({ includeInternal, onUnauthorized });
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImporting(true); onError('');
    try {
      const parsed = parseConnectionInventoryCsv(await file.text());
      await importConnectionInventory({ file_name: file.name, rows: parsed });
      onNotice(`${formatNumber(parsed.length)} conexiones importadas.`);
      await reload();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No se pudo importar el CSV');
    } finally { setImporting(false); }
  };

  const toggleExpanded = (id: number) => setExpanded((current) => {
    const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });

  return <>
    <section className="database-toolbar">
      <div><h2>Activos y conexiones</h2><span className="database-caption">Conexiones migradas importadas; revisá dónde aparecen en Safes y políticas SIA.</span></div>
      <div className="database-toolbar-actions"><span className="database-toolbar-count">{resultLabel(total)}</span>{canManage && <><input ref={fileInput} type="file" accept=".csv,text/csv" onChange={(event) => void handleFile(event)} hidden /><button className="button subtle" type="button" disabled={importing} title="Reemplazar el inventario con un CSV exportado desde tu planilla" onClick={() => fileInput.current?.click()}><FileUp size={15} aria-hidden /> {importing ? 'Importando…' : 'Importar CSV'}</button></>}</div>
    </section>
    <section className="list-panel database-surface connection-inventory-panel">
      <div className="connection-inventory-help"><strong>¿Cómo leer la cobertura?</strong><span>La planilla aporta el contexto migrado. Safes y SIA son coincidencias exactas observadas en DS Hub. El servicio por puerto es una orientación y no confirma el sistema operativo.</span></div>
      <div className="search-row connection-inventory-filters"><label className="search-box"><Search size={16} aria-hidden /><input type="search" aria-label="Buscar conexiones por IP o instancia" placeholder="Buscar por IP, instancia o ambiente" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <CompactSelect ariaLabel="Filtrar por ambiente" value={environment} onChange={setEnvironment} options={[
          { value: '', label: `Todos los ambientes (${formatNumber(executive.data?.connection_coverage.totals.total || 0)})` },
          ...(executive.data?.connection_coverage.by_environment || []).map((item) => ({ value: item.environment, label: `${item.environment} (${formatNumber(item.total)})` })),
        ]} />
        <CompactSelect ariaLabel="Filtrar por cobertura" value={coverage} onChange={(value) => setCoverage(value as ConnectionCoverageFilter | '')} options={[
          { value: '', label: `Toda cobertura (${formatNumber(executive.data?.connection_coverage.totals.total || 0)})`, count: executive.data?.connection_coverage.totals.total || 0 },
          { value: 'both', label: `PAM + SIA (${formatNumber(executive.data?.connection_coverage.totals.both || 0)})`, count: executive.data?.connection_coverage.totals.both || 0 },
          { value: 'pam_only', label: `Solo PAM (${formatNumber(executive.data?.connection_coverage.totals.pam_only || 0)})`, count: executive.data?.connection_coverage.totals.pam_only || 0 },
          { value: 'sia_only', label: `Solo SIA (${formatNumber(executive.data?.connection_coverage.totals.sia_only || 0)})`, count: executive.data?.connection_coverage.totals.sia_only || 0 },
          { value: 'none', label: `Sin coincidencia (${formatNumber(executive.data?.connection_coverage.totals.none || 0)})`, count: executive.data?.connection_coverage.totals.none || 0 },
        ].filter((option) => option.value === '' || option.value === coverage || option.count > 0).map(({ value, label }) => ({ value, label }))} />
      </div>
      <div className="compact-table-wrap"><table className="compact-table connection-inventory-table"><thead><tr><th /><th>Instancia</th><th>IP · puerto</th><th>Cobertura observada</th><th>Safes</th><th>SIA</th><th>Servicio orientativo</th><th>ZSP</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={8}><StateBlock variant="loading" title="Cargando activos y conexiones…" /></td></tr>
          : loadError ? <tr><td colSpan={8}><StateBlock variant="error" title="No se pudieron cargar los activos y conexiones" hint={loadError} action={<button type="button" className="button subtle" onClick={() => void reload()}>Reintentar</button>} /></td></tr>
          : rows.length ? rows.map((row) => {
            const isExpanded = expanded.has(row.inventory_id);
            return <Fragment key={row.inventory_id}><tr className={isExpanded ? 'selected' : ''} onClick={() => toggleExpanded(row.inventory_id)} onKeyDown={(event) => activateRow(event, () => toggleExpanded(row.inventory_id))} tabIndex={0} aria-expanded={isExpanded} aria-label={`${row.instance_name}: ${isExpanded ? 'ocultar' : 'ver'} cobertura`} title={`${isExpanded ? 'Ocultar' : 'Ver'} cobertura de ${row.instance_name}`} style={{ cursor: 'pointer' }}><td>{isExpanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}</td><td><strong>{row.instance_name}</strong><span className="table-subvalue">{row.environment || 'Ambiente sin dato'}</span></td><td><strong className="mono">{row.private_ip}</strong><span className="table-subvalue">{row.port ? `:${row.port}` : 'Sin puerto'}</span></td><td><CoverageBadge row={row} /></td><td><span className="metric-num">{formatNumber(row.safe_match_count)}</span></td><td><span className="metric-num">{formatNumber(row.sia_match_count)}</span></td><td>{serviceHint(row.port)}</td><td><StatusBadge tone={booleanTone(row.zsp_implemented)}>{booleanLabel(row.zsp_implemented)}</StatusBadge></td></tr>
              {isExpanded && <tr className="connection-inventory-detail-row"><td /><td colSpan={7}><div className="connection-inventory-detail"><div><span className="pam-role-graph-label">Datos de la migración</span><div className="connection-inventory-badges"><SourceBadge value={row.ca_sia} label="CA SIA" /><SourceBadge value={row.ca_dba} label="CA DBA" /><SourceBadge value={row.zsp_implemented} label="ZSP" /><SourceBadge value={row.access_available} label="Tengo acceso" /></div>{row.description && <p className="muted">{row.description}</p>}</div><div><span className="pam-role-graph-label">Encontrado en Safes</span>{row.safe_matches.length ? <div className="connection-inventory-match-list">{row.safe_matches.slice(0, 8).map((match) => <div className="connection-inventory-match" key={`${match.safe_number}-${match.account_id}`}><IdentityChip kind="role" name={match.safe_name} subtitle={`${match.account_name} · ${match.platform_name || 'Plataforma sin dato'}`} /><TagChip label={`Safe ${match.safe_number}`} /></div>)}</div> : <span className="muted">No se encontró una cuenta activa con esa IP.</span>}</div><div><span className="pam-role-graph-label">Encontrado en SIA</span>{row.sia_matches.length ? <div className="pam-role-chip-list">{row.sia_matches.slice(0, 8).map((match) => <IdentityChip key={match.object_id} kind="system" name={match.display_name} subtitle={`Política SIA · ID ${match.source_id}`} />)}</div> : <span className="muted">No se encontró una política SIA con esa IP.</span>}</div><div className="connection-inventory-technical"><span className="pam-role-graph-label">Lectura técnica</span><span><strong>{serviceHint(row.port)}</strong> · derivado únicamente del puerto informado.</span></div></div></td></tr>}</Fragment>;
          }) : <tr><td colSpan={8}><StateBlock variant="empty" title={importInfo ? 'No hay coincidencias para esta búsqueda.' : 'Todavía no hay un inventario de conexiones cargado.'} hint={importInfo ? 'Probá con otra IP o nombre de instancia.' : 'Descargá tu planilla como CSV UTF-8 e importala para empezar.'} action={!importInfo && canManage ? <button type="button" className="button subtle" onClick={() => fileInput.current?.click()}>Importar el primer CSV</button> : undefined} /></td></tr>}
      </tbody></table></div>
      {importInfo && <p className="connection-inventory-source">Fuente: {importInfo.file_name} · {formatNumber(importInfo.row_count)} filas · importado {new Date(importInfo.imported_at).toLocaleString('es-AR')}</p>}
      <TablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={(nextPage) => { setPage(nextPage); setExpanded(new Set()); }} />
    </section>
  </>;
}
