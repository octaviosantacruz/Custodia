import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatNumber } from '../lib/format';
import './table-footer.css';
import './table-pagination.css';
import { t } from '../i18n/index.ts';

type TablePaginationProps = { page: number; pageSize: number; total: number; onPageChange: (page: number) => void };

/* Classic page-jump pagination: each page replaces the currently visible
   rows and an operator can type a page number to jump straight to it.
   Use this for admin/reference tables where "page 3 of the report" is a
   real interaction an operator does (audit/activity logs, personnel
   administration, PAM/Identity user-and-role directories, posture
   findings triage) -- these are typically worked through methodically or
   referenced by page, not scanned top-to-bottom in one sitting.

   Use LoadMore instead for read-only, sequentially-scanned inventories
   where jumping to a specific page number is rarely useful and where an
   operator benefits from keeping earlier rows on screen while comparing
   or expanding several of them (technical catalogs, SIA/Identity synced
   read-only data). See the doc comment on LoadMore for the other half of
   this rule. */
export function TablePagination({ page, pageSize, total, onPageChange }: TablePaginationProps) {
  const [pageDraft, setPageDraft] = useState(String(page + 1));
  const pageCount = total ? Math.ceil(total / pageSize) : 0;
  const first = total ? page * pageSize + 1 : 0;
  const last = total ? Math.min((page + 1) * pageSize, total) : 0;
  useEffect(() => setPageDraft(String(page + 1)), [page]);
  const goToPage = () => {
    const requested = Number(pageDraft);
    if (!Number.isFinite(requested) || pageCount === 0) return;
    onPageChange(Math.min(Math.max(Math.trunc(requested) - 1, 0), pageCount - 1));
  };
  return <div className="pagination table-footer"><div className="table-footer-info"><span className="table-footer-summary">{t('Mostrando {first}-{last} de {total}', { first, last, total: formatNumber(total) })}</span>{pageCount > 0 ? <span className="table-footer-meta">Página {formatNumber(page + 1)} de {formatNumber(pageCount)}</span> : null}</div><div className="pagination-controls"><form className="pagination-jump" onSubmit={(event) => { event.preventDefault(); goToPage(); }}><label>{t('Ir a página')}<input aria-label={t('Número de página')} inputMode="numeric" value={pageDraft} onChange={(event) => setPageDraft(event.target.value)} /></label><span aria-hidden="true">de {formatNumber(pageCount)}</span><button className="button subtle" type="submit" disabled={!pageCount}>{t('Ir')}</button></form><div className="pagination-buttons"><button className="icon-button" type="button" title={t('Página anterior')} aria-label={t('Página anterior')} disabled={page === 0} onClick={() => onPageChange(page - 1)}><ChevronLeft size={16} /></button><button className="icon-button" type="button" title={t('Página siguiente')} aria-label={t('Página siguiente')} disabled={(page + 1) * pageSize >= total} onClick={() => onPageChange(page + 1)}><ChevronRight size={16} /></button></div></div></div>;
}
