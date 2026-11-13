import { HelpHint } from '../../../cross/components/help-hint';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight, Database, FileText, HardDrive, Info, KeyRound, Monitor, Network, Package, Search, Server, UserRound, X } from 'lucide-react';
import { ChainGraph, type ChainGraphNode } from '../../../cross/components/chain-graph';
import { StateBlock } from '../../../cross/components/state-block';
import { formatNumber } from '../../../cross/lib/format';
import { CHAIN_NODE_LABELS, chainInventoryView, diffChainHops } from '../../../cross/lib/chain-trail';
import { CHAIN_PRESETS, type ChainPreset } from '../lib/chain-presets';
import { linkRelation, orderedPath, splitColumnHops, unreachableHint, PAM_CHAIN_COLUMNS, PAM_IDENTITY_CHAIN_COLUMNS, type ChainColumnSpec, type ChainPath, type ChainPathCell } from '../../../cross/lib/chain-columns';
import { expandChainNode, type ChainHop, type ChainNode, type ChainNodeType, type ChainRelation } from '../../../cross/lib/chains-api';
import { useChainColumns, type ChainColumnState } from '../../../cross/hooks/use-chain-columns';
import { useDebouncedValue } from '../../../cross/hooks/use-debounced-value';
import { useDialogFocusTrap } from '../../../cross/hooks/use-dialog-focus-trap';
import type { WorkspaceView } from '../../../cross/lib/workspaces';
import '../../../cross/components/chain-workspace.css';
import { t } from '../../../cross/i18n/index.ts';

type PamChainWorkspaceProps = {
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  onNavigate: (view: WorkspaceView, query?: string) => void;
  includeInternal: boolean;
  initialQuery?: string;
  /** Seat filter from the navigation (`standard-seat:reconciled`). */
  initialStandardSeat?: '' | 'reconciled' | 'unreconciled';
  /** Identity read permission: the first column becomes the person (Identidad) and search also matches their name and email. */
  canReadIdentity?: boolean;
};

const NODE_ICONS: Record<ChainNodeType, typeof KeyRound> = {
  user: KeyRound,
  role: KeyRound,
  safe: Database,
  platform: Server,
  psm: Monitor,
  access_asset: Network,
  access_policy: FileText,
  netskope_user: UserRound,
  netskope_device: Monitor,
  netskope_client_version: Package,
  netskope_os: HardDrive,
};

const RELATION_LABELS: Record<string, string> = {
  persisted: 'Verificada',
  derived: 'Derivada',
  reference: 'Referencia',
};

const RELATION_BASIS: Record<string, string> = {
  user_has_role: t('Membresía usuario → rol verificada en CyberArk.'),
  role_grants_access: t('Concesión rol → Safe verificada en CyberArk.'),
  safe_uses_platform: t('Uso Safe → plataforma verificado en CyberArk.'),
  platform_uses_psm: t('Asignación plataforma → PSM verificada en CyberArk.'),
  platform_id: t('Mismo platformId exacto entre Access y PAM.'),
  ip_literal: t('La política SIA apunta a la misma IP literal que una cuenta del Safe.'),
  display_name_reference_only: t('La política SIA nombra a este usuario o rol; es una referencia por nombre, no una relación confirmada.'),
  // Sanctioned Identity -> PAM link: worded for people, never as an identifier.
  uuid_exact: t('Misma persona en Identity y PAM: la cuenta coincide exactamente, no por nombre.'),
  email_exact: t('Misma persona en Identity y PAM: el correo coincide exactamente 1 a 1, nunca por nombre ni similitud.'),
};

function relationText(relation: ChainRelation): string {
  const basis = RELATION_BASIS[relation.basis] ?? relation.basis;
  return `${RELATION_LABELS[relation.kind] ?? relation.kind}: ${basis}`;
}

function NodeIcon({ type, size = 15 }: { type: ChainNodeType; size?: number }) {
  const Icon = NODE_ICONS[type];
  return <Icon size={size} aria-hidden />;
}

/** Connector drawn in the gap to the left of a column: the chain itself. */
function ChainLink({ relation }: { relation: ChainRelation }) {
  const text = relationText(relation);
  return <span className={`chain-link is-${relation.kind}`}>
    <span className="chain-link-line" aria-hidden />
    <button type="button" className="chain-relation-help chain-link-help" aria-label={t('Por qué se conecta: {text}', { text: text })}>
      <span className={`chain-link-dot is-${relation.kind}`} aria-hidden />
      <span className="chain-relation-popover" aria-hidden>{text}</span>
    </button>
  </span>;
}

type DetailTarget = { node: ChainNode; relation: ChainRelation | null };

function ChainNodeDrawer({ target, path, compareA, onCompare, onClose, onNavigate }: {
  target: DetailTarget;
  path: ChainPath | null;
  compareA: ChainNode | null;
  onCompare: (node: ChainNode | null) => void;
  onClose: () => void;
  onNavigate: (view: WorkspaceView, query?: string) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogFocusTrap<HTMLDivElement>({ onClose, initialFocusRef: closeRef });
  const { node, relation } = target;
  const view = chainInventoryView(node.type);
  const graphNodes: ChainGraphNode[] = (path ? orderedPath(path) : []).map((cell) => ({
    id: `${cell.node.type}-${cell.node.id}`,
    label: `${CHAIN_NODE_LABELS[cell.node.type]}: ${cell.node.label}`,
    count: null,
    description: cell.relation ? (RELATION_BASIS[cell.relation.basis] ?? cell.relation.basis) : t('Nodo de inicio'),
  }));
  const comparable = node.type !== 'access_policy';
  const isCompareA = compareA?.type === node.type && compareA.id === node.id;

  return <div ref={dialogRef} className="drawer-layer" role="dialog" aria-modal="true" aria-labelledby="chain-node-title" tabIndex={-1}>
    <button className="drawer-backdrop" type="button" aria-label={t('Cerrar detalle de la cadena')} onClick={onClose} />
    <aside className="detail-drawer chain-node-drawer">
      <div className="detail-title">
        <div className="detail-icon"><NodeIcon type={node.type} size={18} /></div>
        <div className="detail-heading">
          <p className="eyebrow">{CHAIN_NODE_LABELS[node.type].toUpperCase()}</p>
          <h2 id="chain-node-title">{node.label}</h2>
          <p>{relation ? relationText(relation) : t('Inicio del recorrido')}</p>
        </div>
        <button ref={closeRef} className="icon-button drawer-close" type="button" title={t('Cerrar el detalle')} aria-label={t('Cerrar el detalle')} onClick={onClose}><X size={16} aria-hidden /></button>
      </div>
      <section className="detail-section chain-node-summary">
        <dl className="chain-node-facts">
          {node.account ? <>
            <div><dt>Persona (Identity)</dt><dd>{node.label} · {node.sublabel}</dd></div>
            <div><dt>{t('Cuenta PAM')}</dt><dd>{node.account.label}</dd></div>
            <div><dt>{t('Id de la cuenta PAM')}</dt><dd className="mono">{node.account.sublabel}</dd></div>
            {node.identity ? <div><dt>{t('Vínculo')}</dt><dd>{RELATION_BASIS[node.identity.basis]}</dd></div> : null}
          </> : <div><dt>{t('Identificador')}</dt><dd className="mono">{node.sublabel}</dd></div>}
          <div><dt>{t('Relaciones')}</dt><dd>{t('{back} hacia atrás · {forward} hacia adelante', { back: formatNumber(node.counts.back), forward: formatNumber(node.counts.forward) })}</dd></div>
          {node.catalog_missing ? <div><dt>{t('Catálogo')}</dt><dd>{t('Referenciado por una plataforma, no presente en el catálogo PSM.')}</dd></div> : null}
        </dl>
        {graphNodes.length > 1 ? <ChainGraph title={t('Recorrido actual')} description={t('Camino elegido en el mapa, de izquierda a derecha.')} nodes={graphNodes} compact /> : null}
        <div className="chain-node-actions">
          {view ? <button type="button" className="button secondary" title={t('Abrir el inventario de {node}', { node: node.account?.label ?? node.label })} onClick={() => onNavigate(view, node.account?.label ?? node.label)}><ArrowUpRight size={14} aria-hidden /> {t('Abrir inventario')}</button> : null}
          {comparable ? <button type="button" className="button subtle" onClick={() => onCompare(isCompareA ? null : node)}>{isCompareA ? t('Dejar de comparar') : t('Comparar con otro del mismo tipo')}</button> : null}
        </div>
      </section>
    </aside>
  </div>;
}

function ColumnPager({ state, pageSize, label, onPage }: { state: ChainColumnState; pageSize: number; label: string; onPage: (page: number) => void }) {
  const total = state.result?.total ?? 0;
  if (total <= pageSize) return null;
  const from = state.page * pageSize + 1;
  const to = Math.min(total, (state.page + 1) * pageSize);
  return <div className="chain-column-pager">
    <button type="button" className="icon-button" aria-label={t('Página anterior de {value}', { value: label })} disabled={state.page === 0} onClick={() => onPage(state.page - 1)}><ChevronLeft size={14} aria-hidden /></button>
    <span>{t('{from}–{to} de {total}', { from: formatNumber(from), to: formatNumber(to), total: formatNumber(total) })}</span>
    <button type="button" className="icon-button" aria-label={t('Página siguiente de {value}', { value: label })} disabled={to >= total} onClick={() => onPage(state.page + 1)}><ChevronRight size={14} aria-hidden /></button>
  </div>;
}

function OptionButton({ hop, selected, onClick }: { hop: ChainHop; selected: boolean; onClick: () => void }) {
  return <button
    type="button"
    className={`chain-option is-${hop.relation.kind}${selected ? ' is-selected' : ''}`}
    aria-pressed={selected}
    title={relationText(hop.relation)}
    onClick={onClick}
  >
    <span className="chain-option-main">
      <strong>{hop.label}</strong>
      <em>{hop.sublabel}{hop.catalog_missing ? t(' · fuera del catálogo') : ''}</em>
    </span>
    {hop.relation.kind !== 'persisted' ? <span className={`chain-relation-badge is-${hop.relation.kind}`}>{RELATION_LABELS[hop.relation.kind]}</span> : null}
    <span className="chain-option-counts" aria-hidden title={t('Quién llega ← · → a qué llega')}>{formatNumber(hop.counts.back)} ← · → {formatNumber(hop.counts.forward)}</span>
    <span className="sr-only">{t('{back} hacia atrás, {forward} hacia adelante', { back: hop.counts.back, forward: hop.counts.forward })}</span>
  </button>;
}

type ChainColumnProps = {
  spec: ChainColumnSpec;
  index: number;
  columns: ChainColumnSpec[];
  path: ChainPath | null;
  cell: ChainPathCell | undefined;
  state: ChainColumnState;
  pageSize: number;
  filter: string;
  focusRef: (element: HTMLElement | null) => void;
  onSelect: (hop: ChainHop) => void;
  onClear: () => void;
  onDetail: (target: DetailTarget) => void;
  onPage: (page: number) => void;
  onRetry: () => void;
  onFilter: (value: string) => void;
};

function ChainColumn({ spec, index, columns, path, cell, state, pageSize, filter, focusRef, onSelect, onClear, onDetail, onPage, onRetry, onFilter }: ChainColumnProps) {
  const isRoot = Boolean(path && index === path.rootIndex);
  // CHAIN-011: narrowing a wide column (a role can reach 414 Safes) without
  // touching the shared path/deep link. Debounced so typing does not fire one
  // request per keystroke; the node change remounts the column, resetting it.
  const [filterInput, setFilterInput] = useState('');
  const debouncedFilter = useDebouncedValue(filterInput, 300);
  const onFilterRef = useRef(onFilter);
  useEffect(() => { onFilterRef.current = onFilter; }, [onFilter]);
  useEffect(() => { onFilterRef.current(debouncedFilter.trim()); }, [debouncedFilter]);
  const link = path && index > 0 ? linkRelation(path, index - 1) : null;
  const result = state.result;
  const split = result ? splitColumnHops(columns, index, result.rows) : { inColumn: [], lateral: [] };
  const heading = state.source ? (state.source.direction === 'back' ? t('Quién llega') : t('A qué llega')) : '';
  // SIA references share the expansion but are not counted in the column.
  const columnTotal = result ? Math.max(0, result.total - split.lateral.length) : 0;

  return <section
    ref={focusRef}
    tabIndex={-1}
    className={`chain-column${cell ? ' is-selected' : ''}${isRoot ? ' is-root' : ''}${state.source ? ' is-reachable' : ''}`}
    aria-label={`Columna ${spec.label}`}
  >
    <header className="chain-column-header">
      <span className="chain-column-icon"><NodeIcon type={spec.types[0]} /></span>
      <h3>{spec.label}</h3>
      {result && !result.loading && !result.error ? <span className="chain-column-total">{heading} · {formatNumber(columnTotal)}</span> : null}
    </header>

    <div className="chain-rail-slot">
      {link ? <ChainLink relation={link} /> : null}
      {cell ? <article className="chain-card" aria-label={t('Elegido en {spec}: {node}', { spec: spec.label, node: cell.node.label })}>
        <span className="chain-card-icon"><NodeIcon type={cell.node.type} size={17} /></span>
        <span className="chain-card-main">
          <small>{isRoot ? 'Inicio' : CHAIN_NODE_LABELS[cell.node.type]}</small>
          <strong>{cell.node.label}</strong>
          <em>{cell.node.sublabel}</em>
          {cell.node.catalog_missing ? <span className="chain-catalog-missing">{t('Referenciado, no presente en el catálogo PSM.')}</span> : null}
        </span>
        <span className="chain-card-actions">
          <button type="button" className="icon-button" aria-label={t('Ver detalle de {node}', { node: cell.node.label })} title={t('Ver detalle')} onClick={() => onDetail({ node: cell.node, relation: cell.relation })}><Info size={14} aria-hidden /></button>
          {!isRoot ? <button type="button" className="icon-button" aria-label={t('Quitar {node} del recorrido', { node: cell.node.label })} title={t('Quitar del recorrido')} onClick={onClear}><X size={14} aria-hidden /></button> : null}
        </span>
      </article> : path ? <div className={`chain-card-placeholder${state.source ? ' is-frontier' : ''}`}>
        {state.source ? t('Elegí uno de la lista para seguir.') : unreachableHint(columns, path, index)}
      </div> : null}
    </div>

    {state.source ? <div className="chain-column-options">
      <label className="chain-column-filter"><Search size={14} aria-hidden="true" /><input
        type="search"
        value={filterInput}
        onChange={(event) => setFilterInput(event.target.value)}
        placeholder={t('Filtrar en {spec}', { spec: spec.label })}
        aria-label={t('Filtrar en {spec}', { spec: spec.label })}
      /></label>
      {result?.loading ? <StateBlock variant="loading" title={t('Cargando…')} /> : null}
      {result?.error ? <StateBlock variant="error" title={t('No se pudo cargar')} hint={result.error} action={<button type="button" className="button subtle" onClick={onRetry}>{t('Reintentar')}</button>} /> : null}
      {result && !result.loading && !result.error && !split.inColumn.length ? <p className="chain-column-empty">{filter ? t('Sin coincidencias con el filtro.') : t('Sin relaciones en esta dirección.')}</p> : null}
      {split.inColumn.length ? <div className="chain-option-list" role="group" aria-label={t('{heading} en {spec}', { heading: heading, spec: spec.label })}>
        {split.inColumn.map((hop) => <OptionButton
          key={`${hop.type}-${hop.id}`}
          hop={hop}
          selected={Boolean(cell && cell.node.type === hop.type && cell.node.id === hop.id)}
          onClick={() => onSelect(hop)}
        />)}
      </div> : null}
      <ColumnPager state={state} pageSize={pageSize} label={spec.label} onPage={onPage} />
    </div> : null}

    {split.lateral.length ? <div className="chain-lateral" role="group" aria-label={t('Referencias SIA en {spec}', { spec: spec.label })}>
      <p>{t('Referencias SIA')}</p>
      {split.lateral.map((hop) => <button
        key={`${hop.type}-${hop.id}`}
        type="button"
        className={`chain-option is-${hop.relation.kind}`}
        title={relationText(hop.relation)}
        onClick={() => onDetail({ node: hop, relation: hop.relation })}
      ><span className="chain-option-main"><strong>{hop.label}</strong><em>{CHAIN_NODE_LABELS[hop.type]}</em></span><span className={`chain-relation-badge is-${hop.relation.kind}`}>{RELATION_LABELS[hop.relation.kind]}</span></button>)}
    </div> : null}
  </section>;
}

export function PamChainWorkspace({ authChecked, authenticated, onUnauthorized, onError, onNavigate, includeInternal, initialQuery = '', initialStandardSeat = '', canReadIdentity = false }: PamChainWorkspaceProps) {
  const chainColumns = canReadIdentity ? PAM_IDENTITY_CHAIN_COLUMNS : PAM_CHAIN_COLUMNS;
  const controller = useChainColumns({ authChecked, authenticated, onUnauthorized, onError, includeInternal, initialQuery, initialStandardSeat, columns: chainColumns });
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  // Opening with a seat filter shows its results right away.
  const [showSuggestions, setShowSuggestions] = useState(Boolean(initialStandardSeat));
  const [compareA, setCompareA] = useState<ChainNode | null>(null);
  const [compareRows, setCompareRows] = useState<{ a: ChainHop[]; b: ChainHop[] } | null>(null);
  const columnRefs = useRef<(HTMLElement | null)[]>([]);
  const mapRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [focusColumn, setFocusColumn] = useState<number | null>(null);
  const { columns, path, columnStates } = controller;

  // Keep the column that just changed in view when the map scrolls sideways
  // (narrow screens, or a walk that starts at a PSM on the far right).
  useEffect(() => {
    const target = focusColumn ?? path?.rootIndex;
    const map = mapRef.current;
    const column = target === undefined ? null : columnRefs.current[target];
    if (!map || !column || map.scrollWidth <= map.clientWidth) return;
    const left = column.offsetLeft - (map.clientWidth - column.clientWidth) / 2;
    if (typeof map.scrollTo === 'function') map.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [focusColumn, path]);

  // Compare the marked node with the node of the same type chosen in the map.
  const compareB = useMemo(() => {
    if (!compareA || !path) return null;
    const match = Object.values(path.cells).find((cell) => cell.node.type === compareA.type);
    return match && match.node.id !== compareA.id ? match.node : null;
  }, [compareA, path]);

  useEffect(() => {
    if (!compareA || !compareB) {
      setCompareRows(null);
      return undefined;
    }
    let cancelled = false;
    Promise.all([
      expandChainNode(compareA.type, compareA.id, 'forward', 0, includeInternal),
      expandChainNode(compareB.type, compareB.id, 'forward', 0, includeInternal),
    ]).then(([first, second]) => {
      if (!cancelled) setCompareRows({ a: first.rows, b: second.rows });
    }).catch(() => {
      if (!cancelled) setCompareRows(null);
    });
    return () => { cancelled = true; };
  }, [compareA, compareB, includeInternal]);

  const compareDiff = compareRows ? diffChainHops(compareRows.a, compareRows.b) : null;
  const searchVisible = showSuggestions && (controller.searchQuery.trim().length >= 2 || controller.searchStatus !== '' || controller.standardSeat !== '');
  const grouped = useMemo(() => Object.entries(controller.searchGroups).filter(([, items]) => items.length), [controller.searchGroups]);
  const pathLength = path ? orderedPath(path).length : 0;

  // Direction presets point at the frontier column next to a node of their type.
  const presetColumn = (preset: ChainPreset): number | null => {
    if (!path || !preset.requiresType || !preset.direction) return null;
    const entry = Object.entries(path.cells).find(([, cell]) => cell.node.type === preset.requiresType);
    if (!entry) return null;
    const target = Number(entry[0]) + (preset.direction === 'back' ? -1 : 1);
    return columnStates[target]?.source ? target : null;
  };

  const runPreset = (preset: ChainPreset) => {
    if (controller.applySearchPreset(preset)) {
      setShowSuggestions(true);
      searchRef.current?.focus();
      return;
    }
    const target = presetColumn(preset);
    if (target === null) return;
    const element = columnRefs.current[target];
    element?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    element?.focus({ preventScroll: true });
  };

  return <>
    <div className="pam-chain-explorer-intro">
      <div><p className="eyebrow">{t('CADENAS PAM')}</p><div className="section-title"><h2>{t('Buscá cualquier nodo y seguí el recorrido')}</h2><HelpHint label={t('Cómo leer el recorrido')}><p>Cada tipo tiene su columna. A la izquierda del camino ves quién llega y a la derecha a qué llega; elegí un nodo para seguir.</p></HelpHint></div><div className="chain-relation-legend" aria-label={t('Leyenda de relaciones')}><span className="is-persisted">{t('Verificada')}</span><span className="is-derived">{t('Derivada')}</span><span className="is-reference">{t('Referencia')}</span></div></div>
      <span className="database-toolbar-count">{pathLength ? t('{pathLength} {nodos} en el recorrido', { pathLength: formatNumber(pathLength), nodos: pathLength === 1 ? t('nodo') : t('nodos') }) : t('Sin recorrido')}</span>
    </div>

    <section className="chain-explorer" aria-label={t('Explorador de cadenas PAM')}>
      <div className="chain-toolbar">
        <div className="chain-search">
          <label className="search-box"><Search size={16} /><input
            ref={searchRef}
            type="search"
            aria-label={t('Buscar nodos de la cadena PAM')}
            placeholder={canReadIdentity ? t('Persona, rol, Safe, plataforma o PSM') : t('Usuario, rol, Safe, plataforma o PSM')}
            value={controller.searchQuery}
            onChange={(event) => { controller.setSearchQuery(event.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
          /></label>
          <label className="chain-search-seat" title={t('Evidencia PAM de usuario EPVUser y rol Privilege Cloud. No confirma facturación.')}>
            <input
              type="checkbox"
              checked={controller.standardSeat === 'reconciled'}
              onChange={(event) => controller.setStandardSeat(event.target.checked ? 'reconciled' : '')}
            />
            {t('Sólo usuarios con evidencia Standard')}
          </label>
          {searchVisible ? <div className="chain-search-results" role="listbox" aria-label={t('Resultados de la búsqueda')}>
            {controller.searchLoading ? <StateBlock variant="loading" title={t('Buscando nodos…')} /> : null}
            {controller.searchError ? <StateBlock variant="error" title={t('No se pudo buscar')} hint={controller.searchError} /> : null}
            {!controller.searchLoading && !controller.searchError && !grouped.length ? <p className="chain-search-empty">{t('Sin coincidencias.')}</p> : null}
            {grouped.map(([type, items]) => <div className="chain-search-group" key={type}>
              <p>{CHAIN_NODE_LABELS[type as ChainNodeType]}</p>
              {items.map((item) => <button
                key={`${item.type}-${item.id}`}
                type="button"
                role="option"
                aria-selected="false"
                className="chain-search-item"
                onClick={() => { controller.selectSearchItem(item); setShowSuggestions(false); setDetail(null); setFocusColumn(null); }}
              ><strong>{item.label}</strong><small>{item.sublabel}</small>{item.standard_seat_reconciled ? <span className="chain-seat-badge" title={t('Licencia Standard: evidencia PAM, no es facturación')}>{t('Licencia Standard')}</span> : null}</button>)}
            </div>)}
          </div> : null}
        </div>
        <div className="chain-presets" role="group" aria-label={t('Preguntas guardadas')}>
          {CHAIN_PRESETS.map((preset) => <button
            key={preset.id}
            type="button"
            className="button subtle chain-preset"
            title={preset.hint}
            disabled={!preset.search && presetColumn(preset) === null}
            onClick={() => runPreset(preset)}
          >{preset.label}</button>)}
          {path ? <button type="button" className="button subtle chain-reset" onClick={() => { controller.reset(); setDetail(null); }}>{t('Limpiar recorrido')}</button> : null}
        </div>
      </div>

      <section ref={mapRef} className="chain-map" aria-label={t('Mapa de la cadena PAM')} aria-busy={controller.restoring}>
        <div className="chain-map-grid" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(220px, 1fr))` }}>
          {columns.map((spec, index) => <ChainColumn
            key={`${spec.key}:${columnStates[index]?.source?.node.id ?? 'none'}`}
            spec={spec}
            index={index}
            columns={columns}
            path={path}
            cell={path?.cells[index]}
            state={columnStates[index]}
            pageSize={controller.pageSize}
            filter={controller.columnFilters[index] ?? ''}
            focusRef={(element) => { columnRefs.current[index] = element; }}
            onSelect={(hop) => { controller.select(index, hop); setFocusColumn(index); }}
            onClear={() => { controller.clear(index); setFocusColumn(null); }}
            onDetail={setDetail}
            onPage={(page) => controller.setPage(index, page)}
            onRetry={() => controller.retry(index)}
            onFilter={(value) => controller.setColumnFilter(index, value)}
          />)}
        </div>
      </section>

      {compareA ? <section className="chain-compare" aria-label={t('Comparación de nodos')}>
        <header><h3>Comparar {compareA.label}{compareB ? t(' con {compareB}', { compareB: compareB.label }) : ''}</h3><button type="button" className="button subtle" onClick={() => setCompareA(null)}>{t('Cerrar comparación')}</button></header>
        {!compareDiff || !compareB ? <p className="chain-compare-hint">{t('Elegí en el mapa otro nodo de tipo {type} para ver a qué llega uno y no el otro.', { type: CHAIN_NODE_LABELS[compareA.type] })}</p> : <div className="chain-compare-columns">
          <div><p>Solo {compareA.label}</p>{compareDiff.onlyA.length ? compareDiff.onlyA.map((hop) => <span key={`a-${hop.type}-${hop.id}`}>{hop.label}</span>) : <em>{t('Nada')}</em>}</div>
          <div><p>Solo {compareB.label}</p>{compareDiff.onlyB.length ? compareDiff.onlyB.map((hop) => <span key={`b-${hop.type}-${hop.id}`}>{hop.label}</span>) : <em>{t('Nada')}</em>}</div>
          <div><p>{t('En ambos')}</p>{compareDiff.both.length ? compareDiff.both.map((hop) => <span key={`both-${hop.type}-${hop.id}`}>{hop.label}</span>) : <em>{t('Nada')}</em>}</div>
        </div>}
      </section> : null}
    </section>

    {detail ? <ChainNodeDrawer
      target={detail}
      path={path}
      compareA={compareA}
      onCompare={(node) => { setCompareA(node); setDetail(null); }}
      onClose={() => setDetail(null)}
      onNavigate={onNavigate}
    /> : null}
  </>;
}
