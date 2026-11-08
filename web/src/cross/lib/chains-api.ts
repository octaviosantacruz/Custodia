import { api } from './api';
import type { components, paths } from './chains-api.generated';
import { withPerson, type PersonFields } from './chain-person';

/* FE-API-001 pilot: the Cadenas response and parameter shapes come from the
   generated OpenAPI types (chains-api.generated.ts). Only the two UI-level
   source unions and the `type` narrowing below stay hand-written: the backend
   publishes `type` as a plain string and the closed set lives in the two
   node routes' query enums, which the UI needs for its per-type maps. */

export type ChainSource = 'pam' | 'netskope';
export type PersonSource = 'pam' | 'identity' | 'sia' | 'netskope';

type Schemas = components['schemas'];
/** Query enum of one node route; the union across sources is the closed set.
 * The conditional keeps the lookup lazy so it resolves per concrete path. */
type NodeTypeParam<P extends keyof paths> =
  paths[P]['get'] extends { parameters: { query: { type: infer T } } } ? T : never;
export type ChainNodeType =
  | NodeTypeParam<'/api/chains/pam/node'>
  | NodeTypeParam<'/api/chains/netskope/node'>;

/** Narrows a response `type` field to the closed union above. */
type WithChainNodeType<T extends { type: string }> = Omit<T, 'type'> & { type: ChainNodeType };

export type ChainDirection = Schemas['ChainExpandResponse']['direction'];
export type ChainRelationKind = Schemas['ChainRelation']['kind'];

export type ChainCounts = Schemas['ChainCounts'];
export type ChainIdentity = Schemas['ChainIdentity'];


export type ChainRelation = Schemas['ChainRelation'];
export type ChainNode = WithChainNodeType<Schemas['ChainNodeInfo']> & PersonFields;
export type ChainHop = WithChainNodeType<Schemas['ChainHop']> & PersonFields;
export type ChainNodeResponse = Omit<Schemas['ChainNodeResponse'], 'node'> & { node: ChainNode };
export type ChainExpandResponse = Omit<Schemas['ChainExpandResponse'], 'type' | 'rows'> & { type: ChainNodeType; rows: ChainHop[] };
export type ChainSearchItem = WithChainNodeType<Schemas['ChainSearchItem']> & PersonFields;
export type ChainSearchResponse = Omit<Schemas['ChainSearchResponse'], 'groups'> & { groups: Record<string, ChainSearchItem[]> };

/* Person search reports the tool sources as plain strings; the UI renders
   them with the fixed four-tool labels, so it asserts the same closed set. */
export type PersonSearchItem = Omit<Schemas['PersonSearchResult'], 'sources'> & { sources: PersonSource[] };
export type PersonSearchResponse = Omit<Schemas['PersonSearchResponse'], 'people'> & { people: PersonSearchItem[] };

export type PersonToolStatus = Schemas['PersonToolSummary']['status'];
export type PersonToolUser = Schemas['PersonToolUser'];
export type PersonToolSummary = Schemas['PersonToolSummary'];
export type PersonSummaryResponse = Schemas['PersonSummaryResponse'];

/* OpenAPI generation for the CONN-001 response models is intentionally
   pending; use its generated schemas rather than maintaining local copies. */
export type PersonCoverageStatus = Schemas['PersonClientCoverageDetail']['status'];
export type PersonCoverageSourceRun = Schemas['PersonClientCoverageSummary']['sources'][string];
export type PersonClientCoverageSummary = Schemas['PersonClientCoverageSummary'];
export type PersonClientCoverageDetail = Schemas['PersonClientCoverageDetail'];

export const CHAIN_PAGE_SIZE = 50;
export const CHAIN_SEARCH_MIN_LENGTH = 2;

function encode(value: string): string {
  return encodeURIComponent(value);
}

export function fetchChainNode(type: ChainNodeType, id: number, includeInternal: boolean, source: ChainSource = 'pam', signal?: AbortSignal): Promise<ChainNodeResponse> {
  return api<ChainNodeResponse>(`/chains/${source}/node?type=${type}&id=${id}&include_internal=${includeInternal}`, { signal })
    .then((response) => ({ ...response, node: withPerson(response.node) }));
}

export function expandChainNode(
  type: ChainNodeType,
  id: number,
  direction: ChainDirection,
  page: number,
  includeInternal: boolean,
  source: ChainSource = 'pam',
  query = '',
  signal?: AbortSignal,
): Promise<ChainExpandResponse> {
  const offset = page * CHAIN_PAGE_SIZE;
  const filter = query.trim() ? `&q=${encodeURIComponent(query.trim())}` : '';
  return api<ChainExpandResponse>(
    `/chains/${source}/expand?type=${type}&id=${id}&direction=${direction}`
    + `&limit=${CHAIN_PAGE_SIZE}&offset=${offset}&include_internal=${includeInternal}${filter}`,
    { signal },
  ).then((response) => ({ ...response, rows: response.rows.map(withPerson) }));
}

export function searchChainNodes(
  query: string,
  includeInternal: boolean,
  types: ChainNodeType[] = [],
  standardSeat: '' | 'reconciled' | 'unreconciled' = '',
  status: '' | 'suspended' = '',
  source: ChainSource = 'pam',
  signal?: AbortSignal,
): Promise<ChainSearchResponse> {
  const typeFilter = types.length ? `&types=${types.join(',')}` : '';
  const seatFilter = standardSeat ? `&standard_seat=${standardSeat}` : '';
  const statusFilter = status ? `&status=${status}` : '';
  return api<ChainSearchResponse>(
    `/chains/${source}/search?q=${encode(query)}&include_internal=${includeInternal}${typeFilter}${seatFilter}${statusFilter}`,
    { signal },
  ).then((response) => ({
    ...response,
    groups: Object.fromEntries(Object.entries(response.groups).map(([type, items]) => [type, items.map(withPerson)])),
  }));
}

export function fetchPersonSearch(query: string, signal?: AbortSignal): Promise<PersonSearchResponse> {
  return api<PersonSearchResponse>(`/chains/person/search?q=${encode(query)}`, { signal });
}

export function fetchPersonSummary(email: string, signal?: AbortSignal): Promise<PersonSummaryResponse> {
  return api<PersonSummaryResponse>(`/chains/person?email=${encode(email)}`, { signal });
}

export function fetchPersonClientCoverageDetail(email: string, signal?: AbortSignal): Promise<PersonClientCoverageDetail> {
  return api<PersonClientCoverageDetail>(`/chains/person/coverage/detail?email=${encode(email)}`, { signal });
}
