import { useState } from 'react';
import { bucketLabel, formatNumber } from '../lib/format';
import type { AnalyticsBucket } from '../types/safe';

const DEFAULT_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];

type PieSlice = AnalyticsBucket & { color?: string };

export function PieChart({ buckets, size = 128, thickness = 22, onBucketSelect }: {
  buckets: PieSlice[];
  size?: number;
  thickness?: number;
  onBucketSelect?: (bucket: PieSlice) => void;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const safeBuckets = Array.isArray(buckets) ? buckets.filter((bucket) => bucket.count > 0) : [];
  const total = safeBuckets.reduce((sum, bucket) => sum + bucket.count, 0);

  if (!total) return <div className="pie-chart-empty"><p className="empty">Sin datos</p></div>;

  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return <div className="pie-chart">
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Distribución">
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border-soft)" strokeWidth={thickness} />
        {safeBuckets.map((bucket, index) => {
          const fraction = bucket.count / total;
          const dash = fraction * circumference;
          const circle = <circle
            key={bucket.key}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={bucket.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length]}
            strokeWidth={thickness}
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeDashoffset={-offset}
          />;
          offset += dash;
          return circle;
        })}
      </g>
      <text x="50%" y="48%" textAnchor="middle" className="pie-chart-total">{formatNumber(total)}</text>
      <text x="50%" y="64%" textAnchor="middle" className="pie-chart-total-label">total</text>
    </svg>
    <ul className="pie-chart-legend">
      {safeBuckets.map((bucket, index) => <li key={bucket.key} className={expandedKey === bucket.key ? 'expanded' : ''}>
        <span className="pie-chart-swatch" style={{ background: bucket.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length] }} />
        <button
          type="button"
          className="pie-chart-legend-label"
          disabled={Boolean(onBucketSelect) && bucket.key === 'Otros' && !bucket.filter_value}
          title={onBucketSelect ? `Filtrar por ${bucket.label || bucketLabel(bucket.key)}` : bucket.label || bucketLabel(bucket.key)}
          aria-expanded={onBucketSelect ? undefined : expandedKey === bucket.key}
          onClick={() => onBucketSelect ? onBucketSelect(bucket) : setExpandedKey((current) => (current === bucket.key ? null : bucket.key))}
        >{bucket.label || bucketLabel(bucket.key)}</button>
        <strong>{formatNumber(bucket.count)}</strong>
        <span className="pie-chart-legend-pct">{Math.round((bucket.count / total) * 100)}%</span>
      </li>)}
    </ul>
  </div>;
}
