import type { ReactNode } from 'react';
import './metric-reading.css';
import { t } from '../i18n/index.ts';

// Presentation only: each domain supplies its existing metric contract.
// `expanded` renders formula/source/limits inline (used inside a "?" popover,
// where a second "Explicar" disclosure would only add a click).
export function MetricReading({ title, code, meaning, population, capture, formula, source, limits, unknowns, expanded = false }: {
  expanded?: boolean; title: string; code?: string; meaning: string; population: string; capture: ReactNode;
  formula: string; source: string; limits: string; unknowns: string;
}) {
  const details = <dl>
    <div><dt>{t('Fórmula')}</dt><dd>{formula}</dd></div>
    <div><dt>{t('Fuente')}</dt><dd>{source}</dd></div>
    <div><dt>{t('Qué no permite concluir')}</dt><dd>{limits}</dd></div>
  </dl>;
  return <div className="metric-reading">
    {code ? <span className="metric-reading-code">{code}</span> : null}
    <dl className="metric-reading-summary">
      <div><dt>{t('Qué mide')}</dt><dd>{meaning}</dd></div>
      <div><dt>{t('Población')}</dt><dd>{population}</dd></div>
      <div><dt>{t('Período / captura')}</dt><dd>{capture}</dd></div>
    </dl>
    <p className="metric-reading-unknowns">{unknowns}</p>
    {expanded
      ? <div className="metric-reading-details">{details}</div>
      : <details className="metric-reading-details">
        <summary role="button" aria-label={`Explicar ${title}`}>{t('Explicar')}</summary>
        {details}
      </details>}
  </div>;
}
