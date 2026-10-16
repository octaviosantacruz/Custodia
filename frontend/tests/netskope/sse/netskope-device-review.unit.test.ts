import assert from 'node:assert/strict';
import test from 'node:test';
import {
  reviewDiagnosisLabel,
} from '../../../src/netskope/sse/lib/netskope-device-review.ts';
import { EMPTY_NETSKOPE_DEVICE_QUERY, EMPTY_NETSKOPE_USERS_FILTERS, netskopeDevicesQuery, netskopeInventoryLocation, netskopeUsersQuery, isNetskopeDeviceQueryActive, isNetskopeUsersFiltersActive } from '../../../src/netskope/sse/lib/netskope-device-filters.ts';
import { netskopeFilterChips, netskopeFilterGroupCounts } from '../../../src/netskope/sse/lib/netskope-filter-chips.ts';

test('NSK-DEVREV-001 an undetermined device is shown as unclassified, never as a diagnosis', () => {
  assert.equal(reviewDiagnosisLabel('undetermined'), 'Sin clasificar');
  assert.equal(reviewDiagnosisLabel('historical_record'), 'Registro histórico sin evidencia');
});

test('NSK-DEVREV-001 the diagnosis filters travel in the request and in the deep link', () => {
  const query = netskopeDevicesQuery('', 0, undefined, 'gt_30d', '', '', '', '', 'all', '', { reviewDiagnosis: 'historical_record', reviewStatus: 'pending' });
  const params = new URLSearchParams(query);
  assert.equal(params.get('review_diagnosis'), 'historical_record');
  assert.equal(params.get('review_status'), 'pending');
  assert.equal(new URLSearchParams(netskopeDevicesQuery('', 0)).has('review_diagnosis'), false);
  const location = netskopeInventoryLocation('?review_diagnosis=undetermined&event_age=gt_30d', '/netskope/devices');
  assert.equal(location.query.reviewDiagnosis, 'undetermined');
  assert.equal(location.query.freshness, 'all');
  assert.equal(isNetskopeDeviceQueryActive({ ...EMPTY_NETSKOPE_DEVICE_QUERY, reviewStatus: 'resolved' }), true);
});

test('NSK-DEVREV-001 each diagnosis criterion is one removable chip and counts in its filter group', () => {
  const query = { ...EMPTY_NETSKOPE_DEVICE_QUERY, reviewDiagnosis: 'undetermined' as const, reviewStatus: 'investigating' as const, freshness: 'all' as const };
  const chips = netskopeFilterChips(query, { evidenceState: {}, change: {}, clientCompliance: {}, osCompliance: {} });
  assert.deepEqual(chips.map(({ id, label }) => ({ id, label })), [
    { id: 'review-diagnosis', label: 'Diagnóstico: Sin clasificar' },
    { id: 'review-status', label: 'Seguimiento: Investigando' },
  ]);
  assert.deepEqual(chips.map(({ clear }) => clear), [{ reviewDiagnosis: '' }, { reviewStatus: '' }]);
  assert.equal(netskopeFilterGroupCounts(query).diagnosis, 2);
});

test('NSK-DEVREV-002 suggestion and attention travel in the request, the deep link and the chips', () => {
  const params = new URLSearchParams(netskopeDevicesQuery('', 0, undefined, 'gt_30d', '', '', '', '', 'all', '', { reviewSuggestion: 'replaced', reviewAttention: 'open_incident' }));
  assert.equal(params.get('review_suggestion'), 'replaced');
  assert.equal(params.get('review_attention'), 'open_incident');
  const location = netskopeInventoryLocation('?review_suggestion=historical_record&review_attention=reported_again', '/netskope/devices');
  assert.equal(location.query.reviewSuggestion, 'historical_record');
  assert.equal(location.query.reviewAttention, 'reported_again');
  assert.equal(location.query.freshness, 'all');
  const query = { ...EMPTY_NETSKOPE_DEVICE_QUERY, ...{ reviewSuggestion: 'historical_record' as const, reviewAttention: 'expired_exception' as const }, freshness: 'all' as const };
  const chips = netskopeFilterChips(query, { evidenceState: {}, change: {}, clientCompliance: {}, osCompliance: {} });
  assert.deepEqual(chips.map(({ id, label }) => ({ id, label })), [
    { id: 'review-suggestion', label: 'Registro histórico (sin señal hace más de 180 días)' },
    { id: 'review-attention', label: 'Excepciones vencidas' },
  ]);
  assert.equal(netskopeFilterGroupCounts(query).diagnosis, 2);
  assert.equal(isNetskopeDeviceQueryActive({ ...EMPTY_NETSKOPE_DEVICE_QUERY, reviewAttention: 'open_incident' }), true);
  const manual = netskopeInventoryLocation('?review_suggestion=none', '/netskope/devices').query;
  assert.equal(manual.reviewSuggestion, 'none');
  assert.equal(manual.freshness, 'all');
  assert.equal(new URLSearchParams(netskopeDevicesQuery('', 0, undefined, '', '', '', '', '', 'all', '', manual)).get('review_suggestion'), 'none');
  assert.equal(netskopeFilterChips(manual, { evidenceState: {}, change: {}, clientCompliance: {}, osCompliance: {} })[0].label, 'Sin explicación con los datos de Netskope');
  assert.equal(isNetskopeDeviceQueryActive(manual), true);
});

test('NSK-USR-001 the users account status travels in the request, the drill and the active check', () => {
  const filters = { ...EMPTY_NETSKOPE_USERS_FILTERS, accountStatus: 'disabled' as const };
  assert.equal(new URLSearchParams(netskopeUsersQuery('', 0, filters)).get('account_status'), 'disabled');
  assert.equal(new URLSearchParams(netskopeUsersQuery('', 0)).has('account_status'), false);
  assert.equal(isNetskopeUsersFiltersActive(filters), true);
  assert.equal(isNetskopeUsersFiltersActive(EMPTY_NETSKOPE_USERS_FILTERS), false);
});
