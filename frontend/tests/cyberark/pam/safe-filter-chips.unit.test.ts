import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSafeFilterChips, clearSafeFilter, type SafeFilterChipValues } from '../../../src/cyberark/pam/lib/safe-filter-chips.ts';

const emptyFilters: SafeFilterChipValues = {
  includeAccounts: false,
  workflowFilter: '',
  classificationFilter: '',
  accountTypeFilter: '',
  inventoryScopeFilter: '',
  qualityFilter: '',
  scopeHintFilter: '',
  healthFilter: '',
  nextActionFilter: '',
  businessUnitFilter: '',
  responsibleFilter: '',
};

test('active Safe filters become chips with legible values, including unclassified account type', () => {
  const values: SafeFilterChipValues = {
    ...emptyFilters,
    workflowFilter: 'in_progress',
    classificationFilter: 'assigned',
    accountTypeFilter: '__empty__',
    inventoryScopeFilter: 'internal',
    qualityFilter: 'duplicate',
    scopeHintFilter: 'possible_internal_accounts_safe',
    healthFilter: 'no_accounts',
    businessUnitFilter: '3',
    responsibleFilter: '4',
    nextActionFilter: '__empty__',
    includeAccounts: true,
  };
  const labels = {
    businessUnitFilter: new Map([['3', 'FIN - Finanzas']]),
    responsibleFilter: new Map([['4', 'Ada Admin']]),
  };

  assert.deepEqual(buildSafeFilterChips(values, labels).map(({ key, label, value, displayValue }) => ({ key, label, value, displayValue })), [
    { key: 'workflowFilter', label: 'Estado', value: 'in_progress', displayValue: 'En curso' },
    { key: 'businessUnitFilter', label: 'Unidad', value: '3', displayValue: 'FIN - Finanzas' },
    { key: 'responsibleFilter', label: 'Responsable', value: '4', displayValue: 'Ada Admin' },
    { key: 'classificationFilter', label: 'Clasificación', value: 'assigned', displayValue: 'Asignada' },
    { key: 'accountTypeFilter', label: 'Tipo de cuenta', value: '__empty__', displayValue: 'Sin clasificar' },
    { key: 'inventoryScopeFilter', label: 'Alcance', value: 'internal', displayValue: 'Interno CyberArk' },
    { key: 'qualityFilter', label: 'Calidad', value: 'duplicate', displayValue: 'Duplicado' },
    { key: 'scopeHintFilter', label: 'Revisión', value: 'possible_internal_accounts_safe', displayValue: 'Candidatos internos' },
    { key: 'healthFilter', label: 'Safe Health', value: 'no_accounts', displayValue: 'Sin cuentas' },
    { key: 'nextActionFilter', label: 'Acción siguiente', value: '__empty__', displayValue: 'Sin definir' },
    { key: 'includeAccounts', label: 'Incluir cuentas', value: true, displayValue: 'Sí' },
  ]);
});

test('clearing one Safe filter preserves every other value and leaves the input unchanged', () => {
  const values = { ...emptyFilters, workflowFilter: 'pending' as const, qualityFilter: 'clean' as const, nextActionFilter: '__empty__' };

  assert.deepEqual(clearSafeFilter(values, 'workflowFilter'), { ...values, workflowFilter: '' });
  assert.deepEqual(clearSafeFilter(values, 'nextActionFilter'), { ...values, nextActionFilter: '' });
  assert.deepEqual(clearSafeFilter({ ...values, includeAccounts: true }, 'includeAccounts'), { ...values, includeAccounts: false });
  assert.deepEqual(values, { ...emptyFilters, workflowFilter: 'pending', qualityFilter: 'clean', nextActionFilter: '__empty__' });
});

test('no active Safe filters produce no chips', () => {
  assert.deepEqual(buildSafeFilterChips(emptyFilters), []);
});
