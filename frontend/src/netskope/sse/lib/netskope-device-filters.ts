import type { NetskopeDeviceFilters, NetskopeDeviceQuery, NetskopeUsersFilters } from '../types/netskope';

export const NETSKOPE_PAGE_SIZE = 50;

export const EMPTY_NETSKOPE_DEVICE_FILTERS: NetskopeDeviceFilters = { os: '', client_version: '', classification_status: '', user_status: '', company: '', last_seen_event: '', device_make: '', device_model: '', hostname: '', username: '', observed_user_status: '', observed_user: '', onprem_status: '', client_config: '' };

export const EMPTY_NETSKOPE_USERS_FILTERS: NetskopeUsersFilters = { deviceCount: '', recentDeviceAge: '', activityDays: 0, accountStatus: '' };

export const EMPTY_NETSKOPE_DEVICE_QUERY: NetskopeDeviceQuery = { eventAge: '', freshness: 'recent', change: '', clientCompliance: '', osCompliance: '', duplicate: '', coverageRisk: '', filters: EMPTY_NETSKOPE_DEVICE_FILTERS };

export function isNetskopeDeviceQueryActive(query: NetskopeDeviceQuery): boolean {
  return Boolean(query.eventAge || query.freshness === 'all' || query.change || query.clientCompliance || query.osCompliance || query.duplicate || query.coverageRisk || query.evidenceState || query.reviewDiagnosis || query.reviewStatus || query.reviewAttention || query.reviewSuggestion || query.observedUserId || query.deviceObjectId || Object.values(query.filters).some(Boolean));
}

export function isNetskopeUsersFiltersActive(filters: NetskopeUsersFilters): boolean {
  return Boolean(filters.deviceCount || filters.recentDeviceAge || filters.activityDays || filters.accountStatus);
}

/* Only narrowing parameters with a value are sent, so an unfiltered request
   keeps the original devices contract. The heartbeat filter no longer exists
   (NSK-HB-001); an old `?heartbeat=` in a bookmark is simply ignored. */
export function netskopeDevicesQuery(search: string, page: number, filters: NetskopeDeviceFilters = EMPTY_NETSKOPE_DEVICE_FILTERS, eventAge = '', change = '', clientCompliance = '', osCompliance = '', duplicate = '', freshness: 'recent' | 'all' = 'recent', coverageRisk = '', evidence: Pick<NetskopeDeviceQuery, 'evidenceState' | 'observedUserId' | 'deviceObjectId' | 'reviewDiagnosis' | 'reviewStatus' | 'reviewAttention' | 'reviewSuggestion'> = {}): string {
  const params = new URLSearchParams({ limit: String(NETSKOPE_PAGE_SIZE), offset: String(page * NETSKOPE_PAGE_SIZE), q: search });
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  if (eventAge) params.set('event_age', eventAge);
  if (change) params.set('change', change);
  if (clientCompliance) params.set('client_compliance', clientCompliance);
  if (osCompliance) params.set('os_compliance', osCompliance);
  if (duplicate) params.set('duplicate', duplicate);
  if (coverageRisk) params.set('coverage_risk', coverageRisk);
  if (freshness === 'all') params.set('freshness', freshness);
  if (evidence.evidenceState) params.set('evidence_state', evidence.evidenceState);
  if (evidence.reviewDiagnosis) params.set('review_diagnosis', evidence.reviewDiagnosis);
  if (evidence.reviewStatus) params.set('review_status', evidence.reviewStatus);
  if (evidence.reviewAttention) params.set('review_attention', evidence.reviewAttention);
  if (evidence.reviewSuggestion) params.set('review_suggestion', evidence.reviewSuggestion);
  if (evidence.observedUserId) params.set('observed_user_id', String(evidence.observedUserId));
  if (evidence.deviceObjectId) params.set('device_object_id', String(evidence.deviceObjectId));
  return params.toString();
}

/** Exact filters for the single inventory, including old chain bookmarks. */
export function netskopeInventoryLocation(search: string, pathname: string) {
  const params = new URLSearchParams(search);
  const positiveId = (value: string | null) => value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
  const query: NetskopeDeviceQuery = {
    ...EMPTY_NETSKOPE_DEVICE_QUERY,
    filters: Object.fromEntries(Object.keys(EMPTY_NETSKOPE_DEVICE_FILTERS).map((key) => [key, params.get(key) ?? ''])) as NetskopeDeviceFilters,
    eventAge: (params.get('event_age') ?? '') as NetskopeDeviceQuery['eventAge'],
    freshness: params.get('freshness') === 'all' ? 'all' : 'recent',
    change: (params.get('change') ?? '') as NetskopeDeviceQuery['change'],
    clientCompliance: (params.get('client_compliance') ?? '') as NetskopeDeviceQuery['clientCompliance'],
    osCompliance: (params.get('os_compliance') ?? '') as NetskopeDeviceQuery['osCompliance'],
    duplicate: (params.get('duplicate') ?? '') as NetskopeDeviceQuery['duplicate'],
    coverageRisk: (params.get('coverage_risk') ?? '') as NetskopeDeviceQuery['coverageRisk'],
    evidenceState: (params.get('evidence_state') ?? '') as NetskopeDeviceQuery['evidenceState'],
    reviewDiagnosis: (params.get('review_diagnosis') ?? '') as NetskopeDeviceQuery['reviewDiagnosis'],
    reviewStatus: (params.get('review_status') ?? '') as NetskopeDeviceQuery['reviewStatus'],
    reviewAttention: (params.get('review_attention') ?? '') as NetskopeDeviceQuery['reviewAttention'],
    reviewSuggestion: (params.get('review_suggestion') ?? '') as NetskopeDeviceQuery['reviewSuggestion'],
    observedUserId: positiveId(params.get('observed_user_id')),
    deviceObjectId: positiveId(params.get('device_object_id')),
  };
  if (pathname === '/netskope/chains') {
    const steps = (params.get('trail') ?? '').split('>').filter(Boolean);
    const device = [...steps].reverse().find((step) => /^netskope_device:[1-9]\d*$/.test(step));
    if (device) query.deviceObjectId = positiveId(device.split(':')[1]);
    else if (params.get('type') === 'netskope_device') query.deviceObjectId = positiveId(params.get('id'));
    else if (params.get('type') === 'netskope_user') query.observedUserId = positiveId(params.get('id'));
    query.freshness = 'all';
  }
  if (query.filters.observed_user || query.observedUserId || query.deviceObjectId || query.evidenceState || query.reviewDiagnosis || query.reviewStatus || query.reviewAttention || query.reviewSuggestion) query.freshness = 'all';
  return { search: params.get('q') ?? '', query };
}

/* NSK-XMET-001: the users list narrows only by the aggregate criteria a
   cross-metric drill can carry; no attribute filters exist there. */
export function netskopeUsersQuery(search: string, page: number, filters: NetskopeUsersFilters = EMPTY_NETSKOPE_USERS_FILTERS): string {
  const params = new URLSearchParams({ limit: String(NETSKOPE_PAGE_SIZE), offset: String(page * NETSKOPE_PAGE_SIZE), q: search });
  if (filters.deviceCount) params.set('device_count', filters.deviceCount);
  if (filters.recentDeviceAge) params.set('recent_device_age', filters.recentDeviceAge);
  if (filters.activityDays) params.set('activity_days', String(filters.activityDays));
  if (filters.accountStatus) params.set('account_status', filters.accountStatus);
  return params.toString();
}

/** The inventory URL that opens exactly this device query (no paging or search). */
export function netskopeInventoryPath(query: NetskopeDeviceQuery): string {
  const params = new URLSearchParams(netskopeDevicesQuery('', 0, query.filters, query.eventAge, query.change, query.clientCompliance, query.osCompliance, query.duplicate, query.freshness, query.coverageRisk, query));
  for (const key of ['limit', 'offset', 'q']) params.delete(key);
  return `/netskope/inventory?${params}`;
}
