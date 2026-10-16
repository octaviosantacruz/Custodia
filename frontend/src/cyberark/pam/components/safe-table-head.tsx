import { StatusGlossary } from '../../../cross/components/status-glossary';

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
      <th colSpan={3} scope="colgroup">Datos de CyberArk</th>
      <th colSpan={5} scope="colgroup">Clasificación operativa (local)</th>
    </tr>
    <tr className="safe-column-header-row">
      <th><span className="row-select-header"><input type="checkbox" aria-label="Seleccionar todas las Safes cargadas" checked={allLoadedChecked} disabled={bulkApplying || !hasSafes} onChange={onToggleCheckAllLoaded} /> Safe</span></th>
      <th>Cuentas</th>
      <th>Miembros</th>
      <th><span className="table-header-label">Tipo de cuenta<StatusGlossary scope="account_type" compact /></span></th>
      <th><span className="table-header-label">Unidad<StatusGlossary scope="business_unit" compact /></span></th>
      <th><span className="table-header-label">Responsable<StatusGlossary scope="responsible" compact /></span></th>
      <th><span className="table-header-label">Estado<StatusGlossary scope="status" compact /></span></th>
      <th><span className="table-header-label">Acción siguiente<StatusGlossary scope="next_action" compact /></span></th>
    </tr>
  </thead>
  </>;
}
