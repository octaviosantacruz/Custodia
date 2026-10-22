import { useState } from 'react';
import { X } from 'lucide-react';
import type { NetskopeDeviceFacets, NetskopeDeviceFilterKey, NetskopeDeviceQuery } from '../types/netskope';
import { formatNumber } from '../../../cross/lib/format';
import { NETSKOPE_CHANGE_LABELS, NETSKOPE_CLIENT_COMPLIANCE_LABELS, NETSKOPE_EVENT_AGE_OPTIONS, NETSKOPE_OS_COMPLIANCE_LABELS, netskopeFilterChips, netskopeFilterGroupCounts } from '../lib/netskope-filter-chips';
import { fleetGroupKeyLabel } from '../lib/netskope-fleet-groups';
import { CompactSelect } from '../../../cross/components/compact-select';

const DEVICE_FILTERS: Array<{ key: NetskopeDeviceFilterKey; allLabel: string; ariaLabel: string }> = [
  { key: 'user_status', allLabel: 'Todos los estados de usuario', ariaLabel: 'Filtrar por estado de usuario' },
  { key: 'company', allLabel: 'Todas las empresas', ariaLabel: 'Filtrar por empresa' },
  { key: 'classification_status', allLabel: 'Todas las clasificaciones', ariaLabel: 'Filtrar por clasificación' },
  { key: 'os', allLabel: 'Todos los SO', ariaLabel: 'Filtrar por sistema operativo' },
  { key: 'client_version', allLabel: 'Todas las versiones', ariaLabel: 'Filtrar por versión de cliente' },
  { key: 'onprem_status', allLabel: 'Dónde trabaja: todos', ariaLabel: 'Filtrar por dónde trabaja' },
  { key: 'uci_rating', allLabel: 'Cualquier confianza (UCI)', ariaLabel: 'Filtrar por índice de confianza (UCI)' },
  { key: 'last_seen_event', allLabel: 'Cualquier último evento', ariaLabel: 'Filtrar por último evento del cliente' },
];

type Props = {
  query: NetskopeDeviceQuery;
  facets: NetskopeDeviceFacets | null;
  filtered: boolean;
  onQueryChange: (patch: Partial<Omit<NetskopeDeviceQuery, 'filters'>>) => void;
  onDeviceFilterChange: (key: NetskopeDeviceFilterKey, value: string) => void;
  onClearFilters: () => void;
  evidenceLabels: Record<string, string>;
};

function deviceFilterOptions(key: NetskopeDeviceFilterKey, allLabel: string, facets: NetskopeDeviceFacets | null, selected: string) {
  const buckets = facets?.[key] || [];
  const shown = (value: string) => key === 'uci_rating' ? fleetGroupKeyLabel('uci_rating', value) : key === 'onprem_status' ? fleetGroupKeyLabel('onprem_status', value) : value;
  const options = [{ value: '', label: allLabel }, ...buckets.map((bucket) => ({ value: bucket.key, label: `${shown(bucket.key)} · ${formatNumber(bucket.count)}` }))];
  if (selected && !buckets.some((bucket) => bucket.key === selected)) options.push({ value: selected, label: shown(selected) });
  return options;
}

export function NetskopeDeviceFilters({ query, facets, filtered, onQueryChange, onDeviceFilterChange, onClearFilters, evidenceLabels }: Props) {
  const groups = netskopeFilterGroupCounts(query);
  const chips = netskopeFilterChips(query, { evidenceState: evidenceLabels, change: NETSKOPE_CHANGE_LABELS, clientCompliance: NETSKOPE_CLIENT_COMPLIANCE_LABELS, osCompliance: NETSKOPE_OS_COMPLIANCE_LABELS });
  const [identityOpen, setIdentityOpen] = useState(() => groups.identity > 0);
  const [placeOpen, setPlaceOpen] = useState(() => groups.place > 0);
  const [activityOpen, setActivityOpen] = useState(() => groups.activity > 0);

  const removeChip = (chip: (typeof chips)[number]) => {
    if ('filter' in chip.clear) onDeviceFilterChange(chip.clear.filter, '');
    else onQueryChange(chip.clear);
  };

  return <div className="netskope-filter-row netskope-device-filter-row" role="group" aria-label="Filtros de dispositivos">
    <div className="netskope-filter-groups">
      <details className="netskope-filter-group" open={identityOpen} onToggle={(event) => setIdentityOpen(event.currentTarget.open)}>
        <summary><span>Identidad y equipo</span><span className="netskope-filter-group-count">({groups.identity})</span></summary>
        <div className="netskope-filter-group-controls">
          {(['user_status', 'company', 'classification_status', 'os', 'client_version'] as const).map((key) => {
            const filter = DEVICE_FILTERS.find((item) => item.key === key)!;
            return <CompactSelect key={key} className="netskope-attribute-filter" ariaLabel={filter.ariaLabel} value={query.filters[key]} onChange={(next) => onDeviceFilterChange(key, next)} options={deviceFilterOptions(key, filter.allLabel, facets, query.filters[key])} />;
          })}
        </div>
      </details>
      <details className="netskope-filter-group" open={placeOpen} onToggle={(event) => setPlaceOpen(event.currentTarget.open)}>
        <summary><span>Ubicación y confianza</span><span className="netskope-filter-group-count">({groups.place})</span></summary>
        <div className="netskope-filter-group-controls">
          {(['onprem_status', 'uci_rating'] as const).map((key) => {
            const filter = DEVICE_FILTERS.find((item) => item.key === key)!;
            return <CompactSelect key={key} className="netskope-attribute-filter" ariaLabel={filter.ariaLabel} value={query.filters[key]} onChange={(next) => onDeviceFilterChange(key, next)} options={deviceFilterOptions(key, filter.allLabel, facets, query.filters[key])} />;
          })}
        </div>
      </details>
      <details className="netskope-filter-group" open={activityOpen} onToggle={(event) => setActivityOpen(event.currentTarget.open)}>
        <summary><span>Actividad observada</span><span className="netskope-filter-group-count">({groups.activity})</span></summary>
        <div className="netskope-filter-group-controls">
          <CompactSelect className="netskope-attribute-filter" ariaLabel="Filtrar por antigüedad del último evento" value={query.eventAge} onChange={(next) => onQueryChange({ eventAge: next as NetskopeDeviceQuery['eventAge'] })} options={NETSKOPE_EVENT_AGE_OPTIONS} />
          <CompactSelect className="netskope-attribute-filter" ariaLabel="Filtrar por último evento del cliente" value={query.filters.last_seen_event} onChange={(next) => onDeviceFilterChange('last_seen_event', next)} options={deviceFilterOptions('last_seen_event', 'Cualquier último evento', facets, query.filters.last_seen_event)} />
        </div>
      </details>
    </div>
    {filtered ? <div className="netskope-filter-active">
      <span className="netskope-filter-count">Filtros activos ({chips.length})</span>
      {chips.map((chip) => <span key={chip.id} className="netskope-filter-chip">{chip.label}<button type="button" aria-label={`Quitar filtro ${chip.label}`} onClick={() => removeChip(chip)}><X size={12} aria-hidden="true" /></button></span>)}
      {filtered ? <button type="button" className="button subtle netskope-clear-filters" onClick={onClearFilters}><X size={13} aria-hidden="true" /> Limpiar todos</button> : null}
    </div> : null}
  </div>;
}
