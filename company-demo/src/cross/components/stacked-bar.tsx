import { formatNumber } from '../lib/format';
import { segmentWidths, stackedSummary, type StackedSegment } from '../lib/stacked-bar';
import './stacked-bar.css';

type Props = {
  segments: StackedSegment[];
  total: number;
  /** Visible legend with counts; off for compact per-row bars. */
  legend?: boolean;
  ariaLabel: string;
};

/** One bar split into the parts of a whole. The bar is an image with a text
 *  summary, and the legend repeats each count, so color is never the only signal. */
export function StackedBar({ segments, total, legend = true, ariaLabel }: Props) {
  const widths = segmentWidths(segments, total);
  return <div className="stacked-bar">
    <div className="stacked-bar-track" role="img" aria-label={`${ariaLabel}. ${stackedSummary(segments, total, formatNumber)}`}>
      {segments.map((segment, index) => widths[index] > 0
        ? <span key={segment.key} className={`is-${segment.tone}`} style={{ width: `${widths[index]}%` }} title={`${segment.label}: ${formatNumber(segment.count)}`} />
        : null)}
    </div>
    {legend ? <ul className="stacked-bar-legend" aria-hidden="true">
      {segments.map((segment) => <li key={segment.key}><i className={`is-${segment.tone}`} />{segment.label} <strong>{formatNumber(segment.count)}</strong></li>)}
    </ul> : null}
  </div>;
}
