import type { ReactNode } from 'react';
import './bar-cell.css';

type Props = {
  /** Already formatted value shown above the bar. */
  label: ReactNode;
  /** 0..1 share of the reference maximum (see barShare). */
  share: number;
  muted?: boolean;
};

/** A table cell value with a thin relative bar. The bar is decorative: the
 *  number is the content, so nothing depends on seeing the bar. */
export function BarCell({ label, share, muted = false }: Props) {
  const width = Math.round(Math.min(Math.max(share, 0), 1) * 100);
  return <span className={`bar-cell${muted ? ' is-muted' : ''}`}>
    <span className="bar-cell-value">{label}</span>
    <span className="bar-cell-track" aria-hidden="true"><span style={{ width: `${width}%` }} /></span>
  </span>;
}
