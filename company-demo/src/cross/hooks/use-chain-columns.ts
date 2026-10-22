import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import {
  CHAIN_PAGE_SIZE,
  expandChainNode,
  fetchChainNode,
  type ChainDirection,
  type ChainHop,
  type ChainNode,
  type ChainNodeType,
  type ChainSearchItem,
  type ChainSource,
} from '../lib/chains-api';
import {
  PAM_CHAIN_COLUMNS,
  buildPathQuery,
  clearColumn,
  columnSource,
  createPath,
  parsePathQuery,
  pathRange,
  selectInColumn,
  type ChainColumnSource,
  type ChainColumnSpec,
  type ChainPath,
} from '../lib/chain-columns';
import { useChainSearch } from './use-chain-search';

type UseChainColumnsOptions = {
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  includeInternal: boolean;
  initialQuery?: string;
  initialStandardSeat?: '' | 'reconciled' | 'unreconciled';
  columns?: ChainColumnSpec[];
  source?: ChainSource;
};

export type ChainColumnResult = {
  loading: boolean;
  error: string | null;
  rows: ChainHop[];
  total: number;
};

export type ChainColumnState = {
  source: ChainColumnSource | null;
  page: number;
  result: ChainColumnResult | null;
};

const LOADING: ChainColumnResult = { loading: true, error: null, rows: [], total: 0 };

function sameNode(a: ChainNode, b: { type: ChainNodeType; id: number }) {
  return a.type === b.type && a.id === b.id;
}

export function useChainColumns({
  authChecked,
  authenticated,
  onUnauthorized,
  onError,
  includeInternal,
  initialQuery = '',
  initialStandardSeat = '',
  columns = PAM_CHAIN_COLUMNS,
  source = 'pam',
}: UseChainColumnsOptions) {
  const [path, setPath] = useState<ChainPath | null>(null);
  const [pages, setPages] = useState<Record<number, number>>({});
  // CHAIN-011: per-column narrowing of a wide neighbor list (e.g. a role that
  // reaches 414 Safes). Ephemeral by design: it is not part of the deep link.
  const [filters, setFilters] = useState<Record<number, string>>({});
  const [results, setResults] = useState<Record<string, ChainColumnResult>>({});
  const [restoring, setRestoring] = useState(false);
  const restoredRef = useRef(false);
  const inFlight = useRef(new Set<string>());
  const ready = authChecked && authenticated;

  const handleError = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      onUnauthorized();
      return 'Sesión vencida. Volvé a iniciar sesión.';
    }
    const message = error instanceof Error ? error.message : 'No se pudo completar la solicitud';
    onError(message);
    return message;
  }, [onError, onUnauthorized]);

  const search = useChainSearch({ ready, includeInternal, initialQuery, initialStandardSeat, source, handleError });
  const { setSearchQuery } = search;

  const requestKey = useCallback((node: ChainNode, direction: ChainDirection, page: number, filter = '') => (
    `${node.type}:${node.id}|${direction}|${page}|${includeInternal ? 'all' : 'business'}|${filter}`
  ), [includeInternal]);

  // Restore a shared link once: each node is placed by its type, and a link
  // is only kept when the neighbour list confirms the relation.
  useEffect(() => {
    if (restoredRef.current || !ready) return;
    restoredRef.current = true;
    const parsed = parsePathQuery(columns, window.location.search);
    if (!parsed) return;
    setRestoring(true);
    void (async () => {
      try {
        const rootResponse = await fetchChainNode(parsed.root.type, parsed.root.id, includeInternal, source);
        let restored = createPath(columns, rootResponse.node);
        if (!restored) return;
        for (const step of [1, -1]) {
          for (let index = restored.rootIndex + step; parsed.targets[index]; index += step) {
            const target = parsed.targets[index];
            const inner = restored.cells[index - step].node;
            const direction: ChainDirection = step > 0 ? 'forward' : 'back';
            const listed = await expandChainNode(inner.type, inner.id, direction, 0, includeInternal, source);
            let hop = listed.rows.find((row) => sameNode(row, target));
            if (!hop) {
              // The target may sit beyond the first page of a wide node;
              // confirm the same edge from the target's side instead.
              const reverse = await expandChainNode(target.type, target.id, step > 0 ? 'back' : 'forward', 0, includeInternal, source);
              const edge = reverse.rows.find((row) => sameNode(row, inner));
              if (edge) {
                const targetNode = await fetchChainNode(target.type, target.id, includeInternal, source);
                // A directly fetched node is never the restricted placeholder
                // the backend returns for a bridge hop the actor cannot read.
                hop = { ...targetNode.node, relation: edge.relation, restricted: false };
              }
            }
            if (!hop) break;
            restored = selectInColumn(restored, index, hop);
          }
        }
        setPath(restored);
      } catch (error) {
        handleError(error);
      } finally {
        setRestoring(false);
      }
    })();
  }, [columns, handleError, includeInternal, ready, source]);

  // Keep the map shareable without touching the workspace route.
  useEffect(() => {
    if (!path) return;
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}?${buildPathQuery(path)}${window.location.hash}`,
    );
  }, [path]);

  const columnStates: ChainColumnState[] = useMemo(() => columns.map((_, index) => {
    const columnFeed = path ? columnSource(path, index) : null;
    const page = pages[index] ?? 0;
    const filter = filters[index] ?? '';
    const result = columnFeed ? results[requestKey(columnFeed.node, columnFeed.direction, page, filter)] ?? LOADING : null;
    return { source: columnFeed, page, result };
  }), [columns, filters, pages, path, requestKey, results]);

  // Load every reachable column (both frontiers and the alternatives of each
  // selected cell). Results are cached by node/direction/page/scope.
  useEffect(() => {
    if (!ready) return;
    columnStates.forEach(({ source: columnFeed, page }, index) => {
      if (!columnFeed) return;
      const filter = filters[index] ?? '';
      const key = requestKey(columnFeed.node, columnFeed.direction, page, filter);
      if (results[key] || inFlight.current.has(key)) return;
      inFlight.current.add(key);
      expandChainNode(columnFeed.node.type, columnFeed.node.id, columnFeed.direction, page, includeInternal, source, filter)
        .then((response) => {
          setResults((current) => ({ ...current, [key]: { loading: false, error: null, rows: response.rows, total: response.total } }));
        })
        .catch((error) => {
          setResults((current) => ({ ...current, [key]: { loading: false, error: handleError(error), rows: [], total: 0 } }));
        })
        .finally(() => { inFlight.current.delete(key); });
    });
  }, [columnStates, filters, handleError, includeInternal, ready, requestKey, results, source]);

  const resetPagesBeyond = useCallback((rootIndex: number, columnIndex: number) => {
    setPages((current) => Object.fromEntries(Object.entries(current).filter(([key]) => {
      const index = Number(key);
      return columnIndex > rootIndex ? index <= columnIndex : index >= columnIndex;
    })));
  }, []);

  // A column's filter is only valid for the node feeding it. When a selection
  // changes the downstream sources, their filters are dropped exactly like
  // their pages; the selected column keeps its own narrowing.
  const resetFiltersBeyond = useCallback((rootIndex: number, columnIndex: number) => {
    setFilters((current) => Object.fromEntries(Object.entries(current).filter(([key]) => {
      const index = Number(key);
      return columnIndex > rootIndex ? index <= columnIndex : index >= columnIndex;
    })));
  }, []);

  const selectRoot = useCallback(async (type: ChainNodeType, id: number) => {
    try {
      const response = await fetchChainNode(type, id, includeInternal, source);
      const next = createPath(columns, response.node);
      if (!next) return;
      setPath(next);
      setPages({});
      setFilters({});
      setSearchQuery('');
    } catch (error) {
      handleError(error);
    }
  }, [columns, handleError, includeInternal, setSearchQuery, source]);

  const selectSearchItem = useCallback((item: ChainSearchItem) => {
    void selectRoot(item.type, item.id);
  }, [selectRoot]);

  const select = useCallback((columnIndex: number, hop: ChainHop) => {
    if (!path) return;
    resetPagesBeyond(path.rootIndex, columnIndex);
    resetFiltersBeyond(path.rootIndex, columnIndex);
    setPath(selectInColumn(path, columnIndex, hop));
  }, [path, resetFiltersBeyond, resetPagesBeyond]);

  const clear = useCallback((columnIndex: number) => {
    if (path) resetFiltersBeyond(path.rootIndex, columnIndex);
    setPath((current) => (current ? clearColumn(current, columnIndex) : current));
  }, [path, resetFiltersBeyond]);

  const setPage = useCallback((columnIndex: number, page: number) => {
    setPages((current) => ({ ...current, [columnIndex]: Math.max(0, page) }));
  }, []);

  const setColumnFilter = useCallback((columnIndex: number, value: string) => {
    setFilters((current) => (current[columnIndex] === value ? current : { ...current, [columnIndex]: value }));
    setPages((current) => ((current[columnIndex] ?? 0) === 0 ? current : { ...current, [columnIndex]: 0 }));
  }, []);

  const retry = useCallback((columnIndex: number) => {
    const state = columnStates[columnIndex];
    if (!state?.source) return;
    const key = requestKey(state.source.node, state.source.direction, state.page, filters[columnIndex] ?? '');
    setResults((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, [columnStates, filters, requestKey]);

  const reset = useCallback(() => {
    setPath(null);
    setPages({});
    setFilters({});
    setSearchQuery('');
    window.history.replaceState(window.history.state, '', window.location.pathname);
  }, [setSearchQuery]);

  return {
    columns,
    path,
    range: path ? pathRange(path) : null,
    columnStates,
    pageSize: CHAIN_PAGE_SIZE,
    restoring,
    columnFilters: filters,
    setColumnFilter,
    selectRoot,
    selectSearchItem,
    select,
    clear,
    setPage,
    retry,
    reset,
    ...search,
  };
}
