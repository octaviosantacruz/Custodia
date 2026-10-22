import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CHAIN_SEARCH_MIN_LENGTH,
  searchChainNodes,
  type ChainNodeType,
  type ChainSearchResponse,
  type ChainSource,
} from '../lib/chains-api';
import type { ChainPreset } from '../lib/chain-preset-types';
import { useDebouncedValue } from './use-debounced-value';

// Stable fallback so `searchResults` is not recomputed on every render while there is no data.
const NO_GROUPS: ChainSearchResponse['groups'] = {};

type UseChainSearchOptions = {
  ready: boolean;
  includeInternal: boolean;
  initialQuery?: string;
  /** Seat filter requested by the navigation that opened the explorer. */
  initialStandardSeat?: '' | 'reconciled' | 'unreconciled';
  source?: ChainSource;
  /** Maps an error to the message shown in the results (and reports it). */
  handleError: (error: unknown) => string;
};

/** Debounced pivot search shared by the Cadenas explorers. */
export function useChainSearch({ ready, includeInternal, initialQuery = '', initialStandardSeat = '', source = 'pam', handleError }: UseChainSearchOptions) {
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [standardSeat, setStandardSeat] = useState<'' | 'reconciled' | 'unreconciled'>(initialStandardSeat);
  const [searchTypes, setSearchTypes] = useState<ChainNodeType[]>([]);
  const [searchStatus, setSearchStatus] = useState<'' | 'suspended'>('');
  const debouncedSearch = useDebouncedValue(searchQuery, 250);
  const trimmedSearch = debouncedSearch.trim();
  const enabled = ready && (trimmedSearch.length >= CHAIN_SEARCH_MIN_LENGTH || Boolean(searchStatus) || Boolean(standardSeat));

  const query = useQuery({
    queryKey: ['pam', 'chain-search', source, trimmedSearch, includeInternal, searchTypes, standardSeat, searchStatus],
    enabled,
    queryFn: ({ signal }) => searchChainNodes(trimmedSearch, includeInternal, searchTypes, standardSeat, searchStatus, source, signal),
  });

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  useEffect(() => {
    setErrorMessage(query.error ? handleError(query.error) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleError is the caller's inline function; this must run only when the query error changes
  }, [query.error]);

  useEffect(() => {
    if (initialQuery && initialQuery !== searchQuery) setSearchQuery(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialQuery is synced only when it changes; `searchQuery` is omitted so typing is never overwritten
  }, [initialQuery]);

  // A later navigation into the explorer can ask for the seat filter again.
  useEffect(() => {
    if (initialStandardSeat) setStandardSeat(initialStandardSeat);
  }, [initialStandardSeat]);

  /** Applies a preset's server-side search; returns false when it has none. */
  const applySearchPreset = useCallback((preset: ChainPreset) => {
    if (!preset.search) return false;
    setSearchQuery(preset.search.query);
    setSearchTypes(preset.search.types);
    setStandardSeat(preset.search.standardSeat ?? '');
    setSearchStatus(preset.search.status ?? '');
    return true;
  }, []);

  const groups = enabled ? (query.data?.groups ?? NO_GROUPS) : NO_GROUPS;
  const searchResults = useMemo(
    () => Object.entries(groups).flatMap(([type, items]) => items.map((item) => ({ ...item, type: item.type || (type as ChainNodeType) }))),
    [groups],
  );

  return {
    searchQuery,
    setSearchQuery,
    standardSeat,
    setStandardSeat,
    searchTypes,
    searchStatus,
    applySearchPreset,
    searchResults,
    searchGroups: groups,
    searchLoading: enabled && (query.isLoading || query.isFetching),
    searchError: errorMessage,
  };
}
