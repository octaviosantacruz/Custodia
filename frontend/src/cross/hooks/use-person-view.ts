import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../lib/api';
import { fetchPersonSearch, fetchPersonSummary, type PersonSummaryResponse } from '../lib/chains-api';
import { CHAIN_SEARCH_MIN_LENGTH } from '../lib/chains-api';
import { useDebouncedValue } from './use-debounced-value';

type UsePersonViewOptions = {
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  initialQuery?: string;
};

export function usePersonView({
  authChecked,
  authenticated,
  onUnauthorized,
  onError,
  initialQuery = '',
}: UsePersonViewOptions) {
  const [query, setQuery] = useState(initialQuery);
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const debouncedQuery = useDebouncedValue(query, 250);
  const trimmed = debouncedQuery.trim();
  const searchEnabled = authChecked && authenticated && trimmed.length >= CHAIN_SEARCH_MIN_LENGTH;

  const handleError = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      onUnauthorized();
      return 'Sesión vencida. Volvé a iniciar sesión.';
    }
    const message = error instanceof Error ? error.message : 'No se pudo completar la solicitud';
    onError(message);
    return message;
  }, [onError, onUnauthorized]);

  const searchQuery = useQuery({
    queryKey: ['pam', 'person-search', trimmed],
    enabled: searchEnabled,
    queryFn: ({ signal }) => fetchPersonSearch(trimmed, signal),
  });
  const [searchErrorMessage, setSearchErrorMessage] = useState<string | null>(null);
  useEffect(() => {
    setSearchErrorMessage(searchQuery.error ? handleError(searchQuery.error) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleError is the caller's inline function; this must run only when the query error changes
  }, [searchQuery.error]);

  const summaryQuery = useQuery({
    queryKey: ['pam', 'person-summary', selectedEmail],
    enabled: Boolean(selectedEmail),
    queryFn: ({ signal }) => fetchPersonSummary(selectedEmail!, signal),
  });
  const [summaryErrorMessage, setSummaryErrorMessage] = useState<string | null>(null);
  useEffect(() => {
    setSummaryErrorMessage(summaryQuery.error ? handleError(summaryQuery.error) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleError is the caller's inline function; this must run only when the query error changes
  }, [summaryQuery.error]);

  const selectPerson = useCallback(async (email: string) => {
    setSelectedEmail(email);
  }, []);

  const clear = useCallback(() => {
    setSelectedEmail(null);
  }, []);

  const summary: PersonSummaryResponse | null = selectedEmail ? (summaryQuery.data ?? null) : null;

  return {
    query,
    setQuery,
    searchLoading: searchEnabled && (searchQuery.isLoading || searchQuery.isFetching),
    searchError: searchErrorMessage,
    people: searchEnabled ? (searchQuery.data?.people ?? []) : [],
    selectPerson,
    clear,
    summary,
    summaryLoading: Boolean(selectedEmail) && (summaryQuery.isLoading || summaryQuery.isFetching),
    summaryError: selectedEmail ? summaryErrorMessage : null,
  };
}
