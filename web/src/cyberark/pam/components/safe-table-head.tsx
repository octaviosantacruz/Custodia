import { StatusGlossary } from '../../../cross/components/status-glossary';
import { t } from '../../../cross/i18n/index.ts';

type SafeTableHeadProps = {
  allLoadedChecked: boolean;
  bulkApplying: boolean;
  hasSafes: boolean;
  onToggleCheckAllLoaded: () => void;
};

/* Column filters live in the toolbar above the table (SafeTableFilters); the
   header only labels columns so the same filter is never offered twice. */
export function SafeTableHead({ allLoadedChecked, bulkApplying, hasSafes, onToggleCheckAllLoaded }: SafeTableHeadProps) {
  return <>
    {/* table-layout: fixed reads widths from the first row, which here is the colspan group row; the colgroup carries them. */}
    <colgroup><col /><col /><col /><col /><col /><col /><col /><col /></colgroup>
    <thead>
    <tr className="safe-column-group-row">
      <th colSpan={3} scope="colgroup">{t('Datos de CyberArk')}</th>
      <th colSpan={5} scope="colgroup">{t('Clasificación operativa (local)')}</th>
    </tr>
    <tr className="safe-column-header-row">
      <th><span className="row-select-header"><input type="checkbox" aria-label={t('Seleccionar todas las Safes cargadas')} checked={allLoadedChecked} disabled={bulkApplying || !hasSafes} onChange={onToggleCheckAllLoaded} /> {t('Safe')}</span></th>
      <th>{t('Cuentas')}</th>
      <th>{t('Miembros')}</th>
      <th><span className="table-header-label">{t('Tipo de cuenta')}<StatusGlossary scope="account_type" compact /></span></th>
      <th><span className="table-header-label">{t('Unidad')}<StatusGlossary scope="business_unit" compact /></span></th>
      <th><span className="table-header-label">{t('Responsable')}<StatusGlossary scope="responsible" compact /></span></th>
      <th><span className="table-header-label">{t('Estado')}<StatusGlossary scope="status" compact /></span></th>
      <th><span className="table-header-label">{t('Acción siguiente')}<StatusGlossary scope="next_action" compact /></span></th>
    </tr>
  </thead>
  </>;
}
