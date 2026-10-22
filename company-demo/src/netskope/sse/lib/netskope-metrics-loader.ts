import { fetchNetskopeMetrics } from './netskope-api';
import type { NetskopeSelectedMetrics, NetskopeWidgetFilters } from '../types/netskope';

/** One mounted board reserves at most two HTTP requests, leaving room for
 * inventory and sync in the backend's eight-connection pool. Queued requests
 * consume the query signal too, so removed widgets never start stale work. */
export function createNetskopeMetricsLoader() {
  let active = 0;
  const waiting: Array<() => void> = [];
  return (filters: NetskopeWidgetFilters, widgets: readonly string[], signal: AbortSignal): Promise<NetskopeSelectedMetrics> => new Promise((resolve, reject) => {
    const cancel = () => {
      const index = waiting.indexOf(start);
      if (index >= 0) waiting.splice(index, 1);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const start = () => {
      signal.removeEventListener('abort', cancel);
      if (signal.aborted) { cancel(); return; }
      active++;
      fetchNetskopeMetrics(filters, signal, widgets).then(resolve, reject).finally(() => {
        active--;
        waiting.shift()?.();
      });
    };
    if (signal.aborted) { cancel(); return; }
    if (active < 2) start();
    else {
      waiting.push(start);
      signal.addEventListener('abort', cancel, { once: true });
    }
  });
}
