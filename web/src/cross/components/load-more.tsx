import { formatNumber } from '../lib/format';
import './table-footer.css';

type LoadMoreProps = {
  loaded: number;
  total: number;
  pageSize: number;
  loading: boolean;
  onLoadMore: () => void;
};

/* Accumulating "load more" pagination: newly fetched rows are appended to
   what's already on screen, never replaced. Use this for read-only,
   sequentially-scanned inventories where an operator rarely needs to jump
   to a specific page by number and where keeping earlier rows visible
   while comparing/expanding several of them matters (technical catalogs,
   SIA/Identity synced read-only data, Safes/PAM roles with inline
   expand-to-compare rows). Pairs with useSimpleCatalogList for the five
   "simple catalog" workspaces.

   Use TablePagination instead for admin/reference tables where jumping to
   a known page number is a real, expected interaction: audit/activity
   logs, personnel administration, and any table where "page 3 of the
   report" is a meaningful request. See the doc comment on
   TablePagination for the other half of this rule. */
export function LoadMore({ loaded, total, pageSize, loading, onLoadMore }: LoadMoreProps) {
  if (total <= 0) return null;
  const remaining = Math.max(total - loaded, 0);
  const nextBatch = Math.min(pageSize, remaining);
  const hasMore = remaining > 0;

  const shown = Math.min(loaded, total);
  const percent = Math.min(100, Math.floor((shown / total) * 100));
  return <div className="load-more-footer table-footer" aria-live="polite">
    <div className="table-footer-info">
      <span className="table-footer-summary">Mostrando {formatNumber(shown)} de {formatNumber(total)}</span>
      <span className="table-footer-progress" aria-hidden="true"><span style={{ width: `${percent}%` }} /></span>
      <span className="table-footer-meta">{hasMore ? `Faltan ${formatNumber(remaining)}` : 'Todo cargado'}</span>
    </div>
    {hasMore && <button className="button subtle" type="button" title={`Agregar las próximas ${formatNumber(nextBatch)} filas sin perder las actuales`} disabled={loading} onClick={onLoadMore}>
      {loading ? 'Cargando…' : `Cargar ${formatNumber(nextBatch)} más`}
    </button>}
  </div>;
}
