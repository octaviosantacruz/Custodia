import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import './sortable-header.css';

export type SortDirection = 'asc' | 'desc';

/** Column header that sorts server-side. Exposes aria-sort and a real button so keyboard users can reorder. */
export function SortableHeader<K extends string>({ label, sortKey, activeKey, direction, onSort, className }: {
  label: string;
  sortKey: K;
  activeKey: K;
  direction: SortDirection;
  onSort: (key: K) => void;
  className?: string;
}) {
  const active = sortKey === activeKey;
  const Icon = !active ? ChevronsUpDown : direction === 'asc' ? ArrowUp : ArrowDown;
  return <th className={className} aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
    <button type="button" className={'sortable-header' + (active ? ' active' : '')} onClick={() => onSort(sortKey)} title={t('Ordenar por {value}', { value: label.toLowerCase() })}>
      <span>{label}</span><Icon size={12} aria-hidden />
    </button>
  </th>;
}

import { t } from '../i18n/index.ts';