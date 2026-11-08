import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDialogFocusTrap } from '../hooks/use-dialog-focus-trap';
import { bucketLabel, formatNumber } from '../lib/format';
import type { AnalyticsBucket } from '../types/analytics';
import './pie-chart.css';
import { t } from '../i18n/index.ts';

const DEFAULT_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)', 'var(--chart-8)'];

function percentLabel(count: number, denominator: number): string {
  const percent = (count / denominator) * 100;
  return percent > 0 && percent < 1 ? '<1%' : `${Math.round(percent)}%`;
}

const LEGEND_LIMIT = 8;
/** Smallest sweep drawn, so a 1% category stays visible and hoverable. */
const MIN_SWEEP = 0.04;

type PieSlice = AnalyticsBucket & { color?: string };

export function PieChart({ buckets, size = 128, thickness = 22, onBucketSelect, hideLegend = false, population, centerLabel, legendLimit = LEGEND_LIMIT, title }: {
  buckets: PieSlice[];
  size?: number;
  thickness?: number;
  onBucketSelect?: (bucket: PieSlice) => void;
  hideLegend?: boolean;
  /** Opt-in denominator. Omitted preserves the historical rendering exactly. */
  population?: number | null;
  centerLabel?: string;
  /** Legend rows shown before a "Ver todas" button opens the full chart; Infinity shows all. */
  legendLimit?: number;
  title?: string;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ key: string; x: number; y: number } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const safeBuckets = Array.isArray(buckets) ? buckets.filter((bucket) => bucket.count > 0) : [];
  const visibleTotal = safeBuckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const populationOptIn = population !== undefined;
  const total = populationOptIn ? population : visibleTotal;
  const inconsistentPopulation = populationOptIn
    && typeof population === 'number'
    && Number.isFinite(population)
    && population < visibleTotal;

  if (!visibleTotal) {
    if (!populationOptIn) return <div className="pie-chart-empty"><p className="empty">{t('Sin datos')}</p></div>;
    return <div className="pie-chart-empty"><p className="empty">{population === 0 ? 'Sin población: porcentaje no calculable' : population === null ? t('Población no informada') : t('Sin datos')}</p></div>;
  }

  const center = size / 2;
  const outer = size / 2;
  const inner = outer - thickness;
  const chartDenominator = !inconsistentPopulation && typeof population === 'number' && population > 0 ? population : visibleTotal;
  const sliceDenominator = populationOptIn ? chartDenominator : visibleTotal;
  const colorOf = (bucket: PieSlice, index: number) => bucket.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length];
  const labelOf = (bucket: PieSlice) => bucket.label || bucketLabel(bucket.key);
  const shareOf = (bucket: PieSlice) => inconsistentPopulation ? '—' : populationOptIn
    ? typeof population === 'number' && population > 0 ? percentLabel(bucket.count, population) : '—'
    : percentLabel(bucket.count, visibleTotal);
  const point = (radius: number, turn: number) => {
    const angle = turn * 2 * Math.PI - Math.PI / 2;
    return `${(center + radius * Math.cos(angle)).toFixed(3)} ${(center + radius * Math.sin(angle)).toFixed(3)}`;
  };
  const arcPath = (from: number, to: number) => {
    if (to - from >= 0.9999) {
      return `M ${point(outer, 0)} A ${outer} ${outer} 0 1 1 ${point(outer, 0.5)} A ${outer} ${outer} 0 1 1 ${point(outer, 0)} Z M ${point(inner, 0)} A ${inner} ${inner} 0 1 0 ${point(inner, 0.5)} A ${inner} ${inner} 0 1 0 ${point(inner, 0)} Z`;
    }
    const large = to - from > 0.5 ? 1 : 0;
    return `M ${point(outer, from)} A ${outer} ${outer} 0 ${large} 1 ${point(outer, to)} L ${point(inner, to)} A ${inner} ${inner} 0 ${large} 0 ${point(inner, from)} Z`;
  };
  let cursor = 0;
  const arcs = safeBuckets.map((bucket, index) => {
    const fraction = bucket.count / sliceDenominator;
    const from = cursor;
    cursor += fraction;
    return { bucket, index, path: arcPath(from, Math.min(from + Math.max(fraction, MIN_SWEEP), 1)) };
  });
  const hidden = Math.max(0, safeBuckets.length - legendLimit);
  const legendBuckets = hidden ? safeBuckets.slice(0, legendLimit) : safeBuckets;
  const activeBucket = tooltip ? safeBuckets.find((bucket) => bucket.key === tooltip.key) : undefined;
  const moveTooltip = (key: string, event: React.MouseEvent<SVGPathElement>) => {
    const box = event.currentTarget.closest('.pie-chart')?.getBoundingClientRect();
    if (box) setTooltip({ key, x: event.clientX - box.left, y: event.clientY - box.top });
  };

  return <>
    {inconsistentPopulation ? <p className="notice warning" role="status">Población inconsistente: total {formatNumber(population)} menor que la suma visible {formatNumber(visibleTotal)}. Porcentajes no calculables.</p> : null}
    <div className="pie-chart">
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={t('Distribución')}>
      <circle cx={center} cy={center} r={outer - thickness / 2} fill="none" stroke="var(--border-soft)" strokeWidth={thickness} />
      {arcs.map(({ bucket, index, path }) => <path
        key={bucket.key}
        d={path}
        fillRule="evenodd"
        fill={colorOf(bucket, index)}
        className="pie-chart-slice"
        opacity={activeKey && activeKey !== bucket.key ? 0.45 : 1}
        onMouseEnter={() => setActiveKey(bucket.key)}
        onMouseMove={(event) => moveTooltip(bucket.key, event)}
        onMouseLeave={() => { setActiveKey(null); setTooltip(null); }}
      />)}
      <text x="50%" y="48%" textAnchor="middle" className="pie-chart-total">{inconsistentPopulation || populationOptIn && total === null ? '—' : formatNumber(total ?? 0)}</text>
      <text x="50%" y="64%" textAnchor="middle" className="pie-chart-total-label">{inconsistentPopulation ? 'población inconsistente' : populationOptIn ? centerLabel ?? t('población') : 'total'}</text>
    </svg>
    {activeBucket && tooltip ? <div className="pie-chart-tooltip" role="tooltip" style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}>
      <strong>{labelOf(activeBucket)}</strong> · {formatNumber(activeBucket.count)} · {shareOf(activeBucket)}
    </div> : null}
    {hideLegend ? null : <div className="pie-chart-legend-wrap">
    <ul className="pie-chart-legend">
      {legendBuckets.map((bucket) => <li key={bucket.key} className={`${expandedKey === bucket.key ? 'expanded' : ''}${activeKey === bucket.key ? ' active' : ''}`} onMouseEnter={() => setActiveKey(bucket.key)} onMouseLeave={() => setActiveKey(null)}>
        <span className="pie-chart-swatch" style={{ background: colorOf(bucket, safeBuckets.indexOf(bucket)) }} />
        <button
          type="button"
          className="pie-chart-legend-label"
          disabled={Boolean(onBucketSelect) && bucket.key === 'Otros' && !bucket.filter_value}
          title={onBucketSelect ? `Filtrar por ${labelOf(bucket)}` : labelOf(bucket)}
          aria-expanded={onBucketSelect ? undefined : expandedKey === bucket.key}
          onClick={() => onBucketSelect ? onBucketSelect(bucket) : setExpandedKey((current) => (current === bucket.key ? null : bucket.key))}
        >{labelOf(bucket)}</button>
        <strong>{formatNumber(bucket.count)}</strong>
        <span className="pie-chart-legend-pct">{shareOf(bucket)}</span>
      </li>)}
    </ul>
    {hidden ? <button type="button" className="pie-chart-more" onClick={() => setShowAll(true)}>Ver todas ({safeBuckets.length})</button> : null}
    </div>}
    </div>
    {showAll ? <PieChartDialog title={title} onClose={() => setShowAll(false)}>
      <PieChart buckets={buckets} size={220} thickness={36} population={population} centerLabel={centerLabel} onBucketSelect={onBucketSelect ? (bucket) => { setShowAll(false); onBucketSelect(bucket); } : undefined} legendLimit={Infinity} />
    </PieChartDialog> : null}
  </>;
}

function PieChartDialog({ title, onClose, children }: { title?: string; onClose: () => void; children: React.ReactNode }) {
  const dialogRef = useDialogFocusTrap<HTMLElement>({ onClose });
  return createPortal(
    <div className="catalog-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="catalog-modal pie-chart-dialog" role="dialog" aria-modal="true" aria-label={title ?? 'Distribución completa'} tabIndex={-1}>
        <div className="catalog-modal-header">
          <h2>{title ?? 'Distribución completa'}</h2>
          <button className="icon-button" type="button" aria-label={t('Cerrar')} title={t('Cerrar')} onClick={onClose}><X size={16} /></button>
        </div>
        {children}
      </section>
    </div>,
    document.body,
  );
}
