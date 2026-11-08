import type { SafeFilterValues } from './safe-filters';
import { t } from '../../../cross/i18n/index.ts';

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
  workflowFilter: t('Estado'),
  classificationFilter: t('Clasificación'),
  accountTypeFilter: t('Tipo de cuenta'),
  inventoryScopeFilter: t('Alcance'),
  qualityFilter: t('Calidad'),
  scopeHintFilter: t('Revisión'),
  healthFilter: t('Safe Health'),
  businessUnitFilter: t('Unidad'),
  responsibleFilter: t('Responsable'),
  nextActionFilter: t('Acción siguiente'),
  includeAccounts: t('Incluir cuentas'),
};

const KNOWN_VALUES: Partial<Record<SafeFilterChipKey, Record<string, string>>> = {
  workflowFilter: { pending: t('Pendiente'), in_progress: t('En curso'), blocked: t('Bloqueada'), resolved: t('Resuelto'), retired: t('Retirada'), retention_hold: t('Baja retenida') },
  classificationFilter: { pending: t('Pendiente'), assigned: t('Asignada'), review: t('Revisión') },
  accountTypeFilter: { __empty__: t('Sin clasificar') },
  nextActionFilter: { __empty__: t('Sin definir') },
  inventoryScopeFilter: { pending: t('Pendiente'), business: t('Negocio'), internal: t('Interno CyberArk') },
  qualityFilter: { pending: t('Pendiente'), clean: t('Depurado'), obsolete: t('Obsoleto'), duplicate: t('Duplicado') },
  scopeHintFilter: { possible_internal_accounts_safe: t('Candidatos internos') },
  healthFilter: {
    missing_cpm: t('Sin CPM'),
    no_accounts: t('Sin cuentas'),
    retention_unconfigured: t('Sin retención/purga'),
    manage_safe_concentration: t('2+ Manage Safe'),
  },
  businessUnitFilter: { unassigned: t('Sin unidad') },
  responsibleFilter: { unassigned: t('Sin responsable') },
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
