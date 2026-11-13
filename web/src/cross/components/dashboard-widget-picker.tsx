import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight, Plus, Search, Sparkles, Wand2, X } from 'lucide-react';
import { useDialogFocusTrap } from '../hooks/use-dialog-focus-trap';
import { usePresence } from '../hooks/use-presence';
import { overlayExitMs } from '../lib/motion';
import { BarList } from './dashboard';
import { HelpHint } from './help-hint';
import { PieChart } from './pie-chart';
import type { AnalyticsBucket } from '../types/analytics';
import type { DashboardWidget } from '../types/dashboard-widgets';
import './dashboard-widget.css';
import { t } from '../i18n/index.ts';

type DashboardChartData = NonNullable<DashboardWidget['chart_data']>;

export type DashboardPickerOption = {
  id: string;
  title: string;
  description: string;
  sourceLabel: string;
  previewIcon: ReactNode;
  previewLabel?: string;
  previewKind?: 'number' | 'pie' | 'donut' | 'bars' | 'line' | 'heatmap' | 'scatter' | 'combo';
  /** Real top categories for this option's current data, when already loaded
   * on the page (no extra request). Drives both the small in-card preview
   * and the larger hover/focus flyout, so the operator sees actual shapes
   * and category names instead of a generic placeholder before adding it. */
  previewBuckets?: NonNullable<DashboardWidget['buckets']>;
  /** Current data for the advanced chart styles, whose shape is not a
   * bucket list (line, heatmap, scatter and combo). */
  previewChartData?: DashboardChartData;
  /** Friendly name of the visualization, shown as the card eyebrow. */
  visualization?: string;
  /** Already in the board: the card explains it instead of offering Agregar. */
  added?: boolean;
  /** Highlighted as a useful first choice. */
  recommended?: boolean;
  /** Chart option that needs a source the product does not have yet: shown
   * disabled with the reason as tooltip instead of hiding it, so the operator
   * still learns why the block is not available. */
  unavailable?: boolean;
};

export type DashboardPickerGroup = {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
  options: DashboardPickerOption[];
};

/** Real proportional mini bars from the option's own top categories -- the
 * shape reflects the actual current distribution, not a placeholder. */
function MiniRealBars({ buckets }: { buckets: AnalyticsBucket[] }) {
  const top = buckets.filter((bucket) => bucket.count > 0).slice(0, 5);
  const max = Math.max(...top.map((bucket) => bucket.count), 1);
  const barWidth = 9, gap = 3, baseX = 6, chartHeight = 29, baseY = 36;
  return <svg className="dashboard-widget-picker-mini-chart" viewBox="0 0 64 42" aria-hidden="true">
    <path className="mini-chart-axis" d="M5 36H60" />
    {top.map((bucket, index) => {
      const height = Math.max((bucket.count / max) * chartHeight, 3);
      return <rect key={bucket.key} className="mini-chart-bar" x={baseX + index * (barWidth + gap)} y={baseY - height} width={barWidth} height={height} />;
    })}
  </svg>;
}

function hasChartData(data?: DashboardChartData): boolean {
  return Boolean(data?.series?.some((series) => series.values.length) || data?.points?.length || data?.cells?.length);
}

function MiniChartData({ kind, data }: { kind: NonNullable<DashboardPickerOption['previewKind']>; data: DashboardChartData }) {
  if (kind === 'line' || kind === 'combo') {
    const primary = data.series?.[0]?.values ?? [];
    const secondary = kind === 'combo' ? data.series?.[1]?.values ?? [] : [];
    const max = Math.max(...primary, ...secondary, 1);
    const count = Math.max(primary.length, secondary.length, 1);
    const x = (index: number) => 7 + (index * 50) / Math.max(count - 1, 1);
    const y = (value: number) => 35 - (value / max) * 26;
    const line = (values: number[]) => values.map((value, index) => `${index ? 'L' : 'M'}${x(index)} ${y(value)}`).join('');
    return <svg className="dashboard-widget-picker-mini-chart" viewBox="0 0 64 42" aria-hidden="true">
      <path className="mini-chart-axis" d="M5 36H60" />
      {kind === 'combo' ? primary.map((value, index) => { const width = 38 / Math.max(primary.length, 1); return <rect key={index} className="mini-chart-bar" x={9 + index * width} y={y(value)} width={Math.max(width - 3, 3)} height={36 - y(value)} />; }) : null}
      <path className="mini-chart-line" d={line(kind === 'combo' ? secondary : primary)} />
    </svg>;
  }
  if (kind === 'heatmap') {
    const cells = data.cells ?? [];
    const max = Math.max(...cells.map((cell) => cell.value), 1);
    const width = 48 / Math.max(data.x_labels?.length ?? 1, 1);
    const height = 26 / Math.max(data.y_labels?.length ?? 1, 1);
    return <svg className="dashboard-widget-picker-mini-chart" viewBox="0 0 64 42" aria-hidden="true"><path className="mini-chart-axis" d="M5 36H60M6 36V5" />
      {cells.map((cell, index) => <rect key={index} className="mini-chart-heatmap" x={8 + cell.x * width} y={7 + cell.y * height} width={Math.max(width - 2, 2)} height={Math.max(height - 2, 2)} style={{ opacity: 0.2 + 0.8 * (cell.value / max) }} />)}
    </svg>;
  }
  if (kind === 'scatter') {
    const points = data.points ?? [];
    const maxX = Math.max(...points.map((point) => point.x), 1);
    const maxY = Math.max(...points.map((point) => point.y), 1);
    return <svg className="dashboard-widget-picker-mini-chart" viewBox="0 0 64 42" aria-hidden="true"><path className="mini-chart-axis" d="M6 36H60M7 36V5" />
      {points.map((point) => <circle key={point.key} className="mini-chart-dot" cx={8 + (point.x / maxX) * 49} cy={35 - (point.y / maxY) * 27} r="3" />)}
    </svg>;
  }
  return null;
}

function MiniChartPreview({ kind, buckets, chartData }: { kind: NonNullable<DashboardPickerOption['previewKind']>; buckets?: AnalyticsBucket[]; chartData?: DashboardChartData }) {
  if (hasChartData(chartData)) return <MiniChartData kind={kind} data={chartData!} />;
  if (buckets?.length && (kind === 'donut' || kind === 'pie')) return <PieChart buckets={buckets.slice(0, 5)} size={56} thickness={11} hideLegend />;
  if (buckets?.length) return <MiniRealBars buckets={buckets} />;
  if (kind === 'donut' || kind === 'pie') return <svg className="dashboard-widget-picker-mini-chart" viewBox="0 0 64 42" aria-hidden="true"><circle className="mini-chart-track" cx="32" cy="21" r="14" /><circle className="mini-chart-donut" cx="32" cy="21" r="14" /></svg>;
  if (kind === 'line') return <svg className="dashboard-widget-picker-mini-chart" viewBox="0 0 64 42" aria-hidden="true"><path className="mini-chart-axis" d="M5 36H60" /><path className="mini-chart-line" d="M6 31L18 25L29 29L42 13L58 18" /></svg>;
  if (kind === 'heatmap') return <svg className="dashboard-widget-picker-mini-chart" viewBox="0 0 64 42" aria-hidden="true"><path className="mini-chart-heatmap" d="M8 7H20V17H8zM24 7H36V17H24zM40 7H52V17H40zM8 21H20V31H8zM24 21H36V31H24zM40 21H52V31H40z" /></svg>;
  if (kind === 'scatter') return <svg className="dashboard-widget-picker-mini-chart" viewBox="0 0 64 42" aria-hidden="true"><path className="mini-chart-axis" d="M6 36H60M7 36V5" /><circle className="mini-chart-dot" cx="17" cy="29" r="3" /><circle className="mini-chart-dot" cx="28" cy="23" r="3" /><circle className="mini-chart-dot" cx="38" cy="27" r="3" /><circle className="mini-chart-dot" cx="50" cy="12" r="3" /></svg>;
  if (kind === 'combo') return <svg className="dashboard-widget-picker-mini-chart" viewBox="0 0 64 42" aria-hidden="true"><path className="mini-chart-axis" d="M5 36H60" /><path className="mini-chart-bar" d="M10 36V23H18V36zM24 36V14H32V36zM38 36V20H46V36zM52 36V8H60V36z" /><path className="mini-chart-line" d="M8 27L20 19L30 23L44 11L58 15" /></svg>;
  return <svg className="dashboard-widget-picker-mini-chart" viewBox="0 0 64 42" aria-hidden="true"><path className="mini-chart-axis" d="M5 36H60" /><path className="mini-chart-bar" d="M10 36V23H18V36zM24 36V14H32V36zM38 36V20H46V36zM52 36V8H60V36z" /></svg>;
}

/** Larger real chart shown on hover/focus so the operator can see actual
 * category names and proportions before adding the widget. */
function ExpandedRealPreview({ kind, buckets, chartData }: { kind: NonNullable<DashboardPickerOption['previewKind']>; buckets?: AnalyticsBucket[]; chartData?: DashboardChartData }) {
  if (hasChartData(chartData)) return <div className="dashboard-widget-picker-current-chart"><MiniChartPreview kind={kind} chartData={chartData} /></div>;
  if (!buckets?.length) return null;
  if (kind === 'donut' || kind === 'pie') return <PieChart buckets={buckets} size={92} thickness={14} legendLimit={4} />;
  return <BarList buckets={buckets} />;
}

/** Keeps the hover affordance available when the preview request cannot
 * supply a bucket list (advanced charts, empty inventories, or a failed
 * preview batch). The sample deliberately has no labels or values: it
 * explains the chart form without being mistaken for current inventory. */
function ExpandedExamplePreview({ kind }: { kind: NonNullable<DashboardPickerOption['previewKind']> }) {
  return <div className="dashboard-widget-picker-example-expanded">
    <span>{t('Vista de ejemplo')}</span>
    <MiniChartPreview kind={kind} />
    <small>La forma se conserva al agregarlo; los datos se calculan sobre el inventario actual.</small>
  </div>;
}

type Props = {
  kind: 'data' | 'chart';
  eyebrow: string;
  heading: string;
  helper: string;
  groups: DashboardPickerGroup[];
  disabled: boolean;
  /** Section already holds its six blocks: adds stay disabled and explained. */
  limitReached?: boolean;
  onAdd: (id: string) => void;
  /** Optional "from scratch" entry so the picker is the single add path. */
  onCreateCustom?: () => void;
  /** Bump to open the picker programmatically (e.g. from the empty state). */
  openRequest?: number;
  /** Request previews only for option cards currently visible in the dialog. */
  onVisibleOptionsChange?: (ids: string[]) => void;
};

/** Shared category picker for adding dashboard widgets from the board.
 * One grid of preview tiles -> Agregar, narrowed by search and category chips, with an
 * optional "crear desde cero" entry, so both dashboards offer the same add
 * flow. Previews are deliberately marked "Ejemplo": they show the shape of
 * the block, never real values. */
export function DashboardWidgetPicker({ kind, eyebrow, heading, helper, groups, disabled, limitReached = false, onAdd, onCreateCustom, openRequest, onVisibleOptionsChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  /* FE-MOTION-001: the dialog keeps rendering through its exit so the CSS
     presence animation can finish; the focus trap stays keyed to `open`, and
     its cleanup returns focus to the trigger once `open` flips -- without
     waiting for the exit window. Zero duration under reduced motion unmounts
     with no perceptible wait. */
  const presence = usePresence(open ? true : null, overlayExitMs());
  const shown = presence.current === true;
  const leaving = presence.leaving;
  const dialogRef = useDialogFocusTrap<HTMLElement>({ active: open, onClose: () => setOpen(false) });
  /* Reset the browsing state only once the dialog is really gone, so the
     exiting panel keeps its content instead of flashing an empty grid. */
  useEffect(() => {
    if (shown) return;
    setQuery('');
    setCategory(null);
  }, [shown]);
  useEffect(() => {
    if (openRequest === undefined) return;
    setQuery('');
    setCategory(null);
    setOpen(true);
  }, [openRequest]);
  const label = kind === 'data' ? 'dato' : t('gráfico');
  const availableGroups = groups.filter((group) => group.options.length);
  const allOptions = availableGroups.flatMap((group) => group.options);
  const normalizedQuery = query.trim().toLocaleLowerCase('es');
  /* Every option is a tile on one grid; the category chips and the search
     only narrow it, so nothing hides behind a drill-down. */
  const matches = availableGroups
    .filter((group) => !category || group.id === category)
    .flatMap((group) => group.options)
    .filter((option) => `${option.title} ${option.description}`.toLocaleLowerCase('es').includes(normalizedQuery));
  const visibleIds = JSON.stringify(open ? matches.map((option) => option.id) : []);
  useEffect(() => {
    onVisibleOptionsChange?.(JSON.parse(visibleIds) as string[]);
  }, [visibleIds, onVisibleOptionsChange]);
  const closePicker = () => setOpen(false);
  if (!availableGroups.length && !onCreateCustom) return null;

  const renderCard = (option: DashboardPickerOption) => {
    const hasRealPreview = kind === 'chart' ? Boolean(option.previewBuckets?.length || hasChartData(option.previewChartData)) : Boolean(option.previewLabel);
    return <div key={option.id} className={`dashboard-widget-picker-card${option.added ? ' is-added' : ''}${option.unavailable ? ' is-unavailable' : ''}`} role="listitem" aria-disabled={option.unavailable ? 'true' : undefined} title={option.unavailable ? option.description : undefined}>
    <div className="dashboard-widget-picker-body">
    <div className={`dashboard-widget-picker-preview ${kind}`} aria-hidden="true">
      {kind === 'chart'
        ? <MiniChartPreview kind={option.previewKind ?? 'bars'} buckets={option.previewBuckets} chartData={option.previewChartData} />
        : <><span className="dashboard-widget-picker-icon">{option.previewIcon}</span><strong className="dashboard-widget-picker-value">{option.previewLabel ?? '—'}</strong></>}
      <span className="dashboard-widget-picker-example">{hasRealPreview ? t('Datos actuales') : t('Ejemplo')}</span>
    </div>
    {/* On hover the larger preview takes the place of the card's own text, so it never covers a neighbour. */}
    {kind === 'chart' ? <span className="dashboard-widget-picker-expanded" aria-hidden="true">
      {option.previewBuckets?.length || hasChartData(option.previewChartData)
        ? <ExpandedRealPreview kind={option.previewKind ?? 'bars'} buckets={option.previewBuckets} chartData={option.previewChartData} />
        : <ExpandedExamplePreview kind={option.previewKind ?? 'bars'} />}
      {option.unavailable ? null : <small className="dashboard-widget-picker-expanded-source">{option.sourceLabel}</small>}
    </span> : null}
    <div className="dashboard-widget-picker-copy">
      <span className="dashboard-widget-picker-type">{option.visualization ?? (kind === 'data' ? t('Indicador') : t('Comparación'))}{option.recommended ? <em className="dashboard-widget-picker-recommended"><Sparkles size={10} aria-hidden="true" /> {t('Recomendado')}</em> : null}</span>
      <h3>{option.title}</h3><p>{option.description}</p>
      {/* Chart tiles show source and period in their hover preview; data tiles keep them one click away behind a "?".
          An unavailable option keeps them inline, because they are the reason it cannot be added. */}
      {option.unavailable
        ? <small>{option.sourceLabel}</small>
        : kind === 'data' ? <small className="dashboard-widget-picker-source">{t('Fuente y período')}<HelpHint label={t('Fuente y período de {title}', { title: option.title })}><p>{option.sourceLabel}</p></HelpHint></small> : null}
    </div>
    </div>
    {option.unavailable
      ? <span className="dashboard-widget-picker-unavailable">{t('Requiere más datos')}</span>
      : option.added
        ? <span className="dashboard-widget-picker-added"><Check size={13} aria-hidden="true" /> {t('Ya está en la vista')}</span>
        : <button type="button" className="button subtle dashboard-widget-picker-add" aria-label={t('Agregar {title}', { title: option.title })} disabled={disabled || limitReached} onClick={() => { onAdd(option.id); closePicker(); }}><Plus size={13} /> {t('Agregar')}</button>}
  </div>;
  };

  return <div className="dashboard-add-widget">
    <button type="button" className="button subtle dashboard-add-toggle" aria-expanded={open} aria-haspopup="dialog" title={limitReached ? t('Máximo 6 por sección') : undefined} onClick={() => { setQuery(''); setCategory(null); setOpen(true); }} disabled={disabled || limitReached}><Plus size={14} /> {t('Agregar {value}', { value: label })}</button>
    {limitReached ? <small className="dashboard-add-limit" role="status">{t('Máximo 6 por sección')}</small> : null}
    {shown ? createPortal(<div
      className={'dashboard-widget-picker-backdrop' + (leaving ? ' is-leaving' : '')}
      role="presentation"
      aria-hidden={leaving || undefined}
      inert={leaving || undefined}
      onClick={(event) => { if (event.target === event.currentTarget) closePicker(); }}
    >
      <section ref={dialogRef} className="dashboard-widget-picker" role="dialog" aria-modal="true" aria-labelledby={`dashboard-picker-title-${kind}`} tabIndex={-1}>
        <header className="dashboard-widget-picker-header">
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h2 id={`dashboard-picker-title-${kind}`}>{heading}</h2>
            <p>{helper}</p>
          </div>
          <button type="button" className="icon-button" aria-label={t('Cerrar selector')} onClick={closePicker}><X size={17} /></button>
        </header>
        <div className="dashboard-widget-picker-meta"><span>{matches.length === allOptions.length ? `${allOptions.length} ${label}s` : t('{matches} de {allOptions} {value}s', { matches: matches.length, allOptions: allOptions.length, value: label })}</span><small>{t('Se agrega al final de esta sección')}</small></div>
        <label className="dashboard-widget-picker-search-wrap"><Search size={15} aria-hidden="true" /><input type="search" className="dashboard-widget-picker-search" aria-label={t('Buscar {value}', { value: label })} placeholder={t('Buscar {value} por nombre o descripción', { value: label })} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        {availableGroups.length > 1 ? <div className="dashboard-widget-picker-chips" role="group" aria-label={t('Filtrar {value}s por categoría', { value: label })}>
          <button type="button" className={`dashboard-widget-picker-chip${category === null ? ' selected' : ''}`} aria-pressed={category === null} onClick={() => setCategory(null)}>{t('Todos')}</button>
          {availableGroups.map((group) => <button key={group.id} type="button" className={`dashboard-widget-picker-chip${category === group.id ? ' selected' : ''}`} aria-pressed={category === group.id} title={group.description} onClick={() => setCategory((current) => current === group.id ? null : group.id)}>{group.title}</button>)}
        </div> : null}
        {onCreateCustom ? <button type="button" className="dashboard-widget-picker-create" onClick={() => { closePicker(); onCreateCustom(); }}>
          <span className="dashboard-widget-picker-group-icon"><Wand2 size={20} aria-hidden="true" /></span>
          <span><strong>{t('Crear desde cero')}</strong><small>{t('Definí nombre, medida, filtros y objetivo.')}</small></span>
          <ChevronRight size={17} aria-hidden="true" />
        </button> : null}
        {matches.length
          ? <div className="dashboard-widget-picker-grid" role="list" aria-label={kind === 'data' ? t('Datos disponibles') : t('Gráficos disponibles')}>{matches.map(renderCard)}</div>
          : <p className="dashboard-widget-picker-empty">{t('Sin coincidencias para “{trim}”.', { trim: query.trim() })}</p>}
      </section>
    </div>, document.body) : null}
  </div>;
}
