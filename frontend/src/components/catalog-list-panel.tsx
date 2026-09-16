import type { ReactNode } from 'react';
import { Search, type LucideIcon } from 'lucide-react';
import { LoadMore } from './load-more';
import { StateBlock } from './state-block';
import { formatNumber } from '../lib/format';

type CatalogListPanelProps<T> = {
  ariaLabel: string;
  icon: LucideIcon;
  title: string;
  description: string;
  countLabel: (total: number) => string;
  searchLabel: string;
  searchPlaceholder: string;
  search: string;
  onSearchChange: (value: string) => void;
  columns: string[];
  loading: boolean;
  error: string;
  loadingTitle: string;
  errorTitle: string;
  emptyTitle: string;
  noResultsTitle: string;
  rows: T[];
  renderRow: (row: T) => ReactNode;
  footerNote: ReactNode;
  total: number;
  pageSize: number;
  onLoadMore: () => void;
  onRetry?: () => void;
};

/* Shared shell for the "simple catalog" workspaces (Access assets, SIA
   resources/database accounts, Identity federations, AIM applications):
   heading + count + search box + table scaffold (loading/error/empty/
   no-results via StateBlock) + real "load more" pagination. Column
   headers and row rendering stay per-workspace (render prop) since the
   actual data shape is genuinely different per catalog -- only the
   surrounding chrome was ever duplicated. */
export function CatalogListPanel<T>({
  ariaLabel, icon: Icon, title, description, countLabel, searchLabel, searchPlaceholder,
  search, onSearchChange, columns, loading, error, loadingTitle, errorTitle, emptyTitle, noResultsTitle,
  rows, renderRow, footerNote, total, pageSize, onLoadMore, onRetry,
}: CatalogListPanelProps<T>) {
  const colSpan = columns.length;
  return <section className="list-panel database-surface pam-platforms-panel catalog-list-panel" aria-label={ariaLabel}>
    <div className="pam-platforms-heading">
      <div><h3>{title}</h3><p>{description}</p></div>
      <span className="database-toolbar-count" aria-live="polite">{countLabel(total)}</span>
    </div>
    <div className="search-row"><label className="search-box"><Search size={16} /><input type="search" aria-label={searchLabel} placeholder={searchPlaceholder} value={search} onChange={(event) => onSearchChange(event.target.value)} /></label></div>
    <div className="compact-table-wrap"><table className="compact-table pam-platforms-table"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>
      {loading && rows.length === 0 ? <tr><td colSpan={colSpan}><StateBlock variant="loading" title={loadingTitle} /></td></tr>
        : error ? <tr><td colSpan={colSpan}><StateBlock variant="error" title={errorTitle} hint={error} action={onRetry ? <button type="button" className="button subtle" onClick={onRetry}>Reintentar</button> : undefined} /></td></tr>
          : rows.length ? rows.map((row) => renderRow(row))
            : <tr><td colSpan={colSpan}><StateBlock
                variant={search ? 'no-results' : 'empty'}
                title={search ? noResultsTitle : emptyTitle}
                action={search ? <button type="button" className="button subtle" onClick={() => onSearchChange('')}>Limpiar búsqueda</button> : undefined}
              /></td></tr>}
    </tbody></table></div>
    {!error && <LoadMore loaded={rows.length} total={total} pageSize={pageSize} loading={loading} onLoadMore={onLoadMore} />}
    <p className="pam-platforms-note"><Icon size={13} aria-hidden /> {footerNote}</p>
  </section>;
}

export function catalogCount(total: number, noun: string, pluralNoun: string = `${noun}s`): string {
  return `${formatNumber(total)} ${total === 1 ? noun : pluralNoun}`;
}
