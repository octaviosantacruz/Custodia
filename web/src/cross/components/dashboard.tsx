import type { ReactNode } from 'react';
import { formatNumber, bucketLabel } from '../lib/format';
import type { AnalyticsBucket } from '../types/analytics';
import './dashboard.css';

export function BarList({ buckets, emptyHint = t('Sin datos disponibles para este corte.'), onBucketSelect }: {
  buckets: AnalyticsBucket[];
  emptyHint?: string;
  onBucketSelect?: (bucket: AnalyticsBucket) => void;
}) {
  const safeBuckets = Array.isArray(buckets) ? buckets : [];
  const max = Math.max(...safeBuckets.map((bucket) => bucket.count), 1);
  return <div className="bar-list">{safeBuckets.length ? safeBuckets.map((bucket) => {
    const content = <><div className="bar-label"><span>{bucket.label || bucketLabel(bucket.key)}</span><strong>{formatNumber(bucket.count)}</strong></div><div className="bar-track" aria-hidden="true"><span style={{ width: ((bucket.count / max) * 100) + '%' }} /></div></>;
    if (!onBucketSelect) return <div className="bar-row" key={bucket.key}>{content}</div>;
    const canSelect = bucket.key !== 'Otros' || Boolean(bucket.filter_value);
    return <button className="bar-row interactive" key={bucket.key} type="button" disabled={!canSelect} onClick={() => onBucketSelect(bucket)} title={canSelect ? t('Filtrar por {key}', { key: bucket.label || bucketLabel(bucket.key) }) : t('Esta categoría agrupa varios valores')}>{content}</button>;
  }) : <p className="empty chart-empty-hint">{emptyHint}</p>}</div>;
}

export function Metric({ label, value, detail, tone = '', valueSuffix = '' }: {
  label: string;
  value: number;
  detail: string;
  tone?: string;
  valueSuffix?: string;
}) {
  return <div className={`metric ${tone}`.trim()}><span className="metric-label">{label}</span><strong>{formatNumber(value)}{valueSuffix}</strong><small>{detail}</small></div>;
}

export function Field({ label, children, full = false }: {
  label: string;
  children: ReactNode;
  full?: boolean;
}) {
  return <div className={`field ${full ? 'full' : ''}`}><label>{label}</label>{children}</div>;
}

import { t } from '../i18n/index.ts';