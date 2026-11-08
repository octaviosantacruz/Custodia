import type { SafeFilterValues } from './safe-filters';

export type SafeFilterChipKey =
  | 'workflowFilter'
  | 'classificationFilter'
  | 'accountTypeFilter'
  | 'inventoryScopeFilter'
  | 'qualityFilter'
  | 'scopeHintFilter'
  | 'healthFilter'
  | 'businessUnitFilter'
  | 'responsibleFilter'
  | 'nextActionFilter';

export type SafeFilterChipKeyWithAccountSearch = SafeFilterChipKey | 'includeAccounts';
export type SafeFilterChipValues = Pick<SafeFilterValues, SafeFilterChipKeyWithAccountSearch>;
export type SafeFilterChipLabels = Partial<Record<SafeFilterChipKey, ReadonlyMap<string, string>>>;
export type SafeFilterChip = { key: SafeFilterChipKeyWithAccountSearch; label: string; value: string | true; displayValue: string };

const FILTER_LABELS: Record<SafeFilterChipKeyWithAccountSearch, string> = {
  workflowFilter: 'Estado',
  classificationFilter: 'Clasificación',
  accountTypeFilter: 'Tipo de cuenta',
  inventoryScopeFilter: 'Alcance',
  qualityFilter: 'Calidad',
  scopeHintFilter: 'Revisión',
  healthFilter: 'Safe Health',
  businessUnitFilter: 'Unidad',
  responsibleFilter: 'Responsable',
  nextActionFilter: 'Acción siguiente',
  includeAccounts: 'Incluir cuentas',
};

const KNOWN_VALUES: Partial<Record<SafeFilterChipKey, Record<string, string>>> = {
  workflowFilter: { pending: 'Pendiente', in_progress: 'En curso', blocked: 'Bloqueada', resolved: 'Resuelto', retired: 'Retirada', retention_hold: 'Baja retenida' },
  classificationFilter: { pending: 'Pendiente', assigned: 'Asignada', review: 'Revisión' },
  accountTypeFilter: { __empty__: 'Sin clasificar' },
  nextActionFilter: { __empty__: 'Sin definir' },
  inventoryScopeFilter: { pending: 'Pendiente', business: 'Negocio', internal: 'Interno CyberArk' },
  qualityFilter: { pending: 'Pendiente', clean: 'Depurado', obsolete: 'Obsoleto', duplicate: 'Duplicado' },
  scopeHintFilter: { possible_internal_accounts_safe: 'Candidatos internos' },
  healthFilter: {
    missing_cpm: 'Sin CPM',
    no_accounts: 'Sin cuentas',
    retention_unconfigured: 'Sin retención/purga',
    manage_safe_concentration: '2+ Manage Safe',
  },
  businessUnitFilter: { unassigned: 'Sin unidad' },
  responsibleFilter: { unassigned: 'Sin responsable' },
};

const FILTER_ORDER: SafeFilterChipKeyWithAccountSearch[] = [
  'workflowFilter', 'businessUnitFilter', 'responsibleFilter', 'classificationFilter',
  'accountTypeFilter', 'inventoryScopeFilter', 'qualityFilter', 'scopeHintFilter', 'healthFilter', 'nextActionFilter', 'includeAccounts',
];

export function buildSafeFilterChips(values: SafeFilterChipValues, labels: SafeFilterChipLabels = {}): SafeFilterChip[] {
  return FILTER_ORDER.flatMap<SafeFilterChip>((key): SafeFilterChip[] => {
    const value = values[key];
    if (key === 'includeAccounts') return value ? [{ key, label: FILTER_LABELS[key], value: true, displayValue: 'Sí' }] : [];
    if (typeof value !== 'string' || !value) return [];
    const displayValue = key === 'accountTypeFilter' && value === '__empty__'
      ? 'Sin clasificar'
      : labels[key]?.get(value) || KNOWN_VALUES[key]?.[value] || value.replaceAll('_', ' ');
    return [{ key, label: FILTER_LABELS[key], value, displayValue }];
  });
}

export function clearSafeFilter(values: SafeFilterChipValues, key: SafeFilterChipKeyWithAccountSearch): SafeFilterChipValues {
  return { ...values, [key]: key === 'includeAccounts' ? false : '' } as SafeFilterChipValues;
}
