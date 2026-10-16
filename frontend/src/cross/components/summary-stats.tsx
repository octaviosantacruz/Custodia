import type { ReactNode } from 'react';
import './summary-stats.css';

export type SummaryStat = { key: string; label: string; value: ReactNode; detail?: ReactNode; title?: string;
  /** When set, the stat becomes a toggle (e.g. a quick filter). */
  onSelect?: () => void; active?: boolean };

/** The few numbers that frame a table, above its toolbar. Detail lines stay
 *  short; longer definitions belong behind a HelpHint. */
export function SummaryStats({ stats, ariaLabel }: { stats: SummaryStat[]; ariaLabel: string }) {
  return <dl className="summary-stats" aria-label={ariaLabel}>
    {stats.map((stat) => <div key={stat.key} className={`summary-stat${stat.onSelect ? ' is-selectable' : ''}${stat.active ? ' is-active' : ''}`} title={stat.title} onClick={stat.onSelect}>
      <dt>{stat.onSelect ? <button type="button" aria-pressed={Boolean(stat.active)} onClick={(event) => { event.stopPropagation(); stat.onSelect?.(); }}>{stat.label}</button> : stat.label}</dt>
      <dd>{stat.value}{stat.detail ? <small>{stat.detail}</small> : null}</dd>
    </div>)}
  </dl>;
}
