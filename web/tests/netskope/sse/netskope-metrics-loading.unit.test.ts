import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier) && context.parentURL?.includes('/src/')) {
      for (const suffix of ['.ts', '/index.ts']) {
        const url = new URL(`${specifier}${suffix}`, context.parentURL);
        if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier);
  },
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url.endsWith('/src/cross/lib/api.ts')) {
      const text = typeof result.source === 'string'
        ? result.source
        : Buffer.from(result.source as ArrayBuffer).toString('utf8');
      return { ...result, source: text.replaceAll('import.meta.env.VITE_API_URL', "''") };
    }
    return result;
  },
});

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  Event: dom.window.Event,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
});
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { createElement } = await import('react');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { cleanup, renderHook, waitFor, act } = await import('@testing-library/react');
const { useNetskopeFilteredMetrics } = await import('../../../src/netskope/sse/hooks/use-netskope-filtered-metrics.ts');
const { useNetskopeDashboardPreferences } = await import('../../../src/netskope/sse/hooks/use-netskope-dashboard-preferences.ts');
import type { NetskopeWidgetInstance } from '../../../src/netskope/sse/types/netskope.ts';

const originalFetch = globalThis.fetch;
const clients: InstanceType<typeof QueryClient>[] = [];
const base = { users_total: 9, devices_total: 7, devices_stale_30d: 3, devices_with_observed_user: 5, last_observed_at: null };
const widget = (id: NetskopeWidgetInstance['id'], company?: string): NetskopeWidgetInstance => ({ id, size: 'sm', filters: company ? { company } : {} });

function board(widgets: NetskopeWidgetInstance[], enabled = true) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false, gcTime: Infinity } } });
  clients.push(client);
  const wrapper = ({ children }: { children: React.ReactNode }) => createElement(QueryClientProvider, { client }, children);
  return { client, ...renderHook(({ widgets, enabled }) => useNetskopeFilteredMetrics({ widgets, enabled, onUnauthorized: () => {} }), { wrapper, initialProps: { widgets, enabled } }) };
}

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  globalThis.fetch = originalFetch;
});

test('selection waits for preferences, deduplicates filters and keeps separators inside values', async () => {
  const requests: URL[] = [];
  globalThis.fetch = (async (input) => {
    requests.push(new URL(String(input), 'http://localhost'));
    return Response.json(base);
  }) as typeof fetch;
  const widgets = [widget('devices_total', 'A|B'), widget('devices_stale_30d', 'A|B'), widget('alerts_7d'), widget('alerts_by_severity')];
  const hook = board(widgets, false);
  await act(async () => {});
  assert.equal(requests.length, 0);
  hook.rerender({ widgets, enabled: true });
  await waitFor(() => assert.equal(hook.result.current.metricsFor({ company: 'A|B' })?.devices_total, 7));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].searchParams.get('company'), 'A|B');
  assert.deepEqual(requests[0].searchParams.getAll('widgets'), ['devices_stale_30d', 'devices_total']);
  assert.equal(hook.result.current.metricsFor(), null);
  hook.rerender({ widgets: [widget('alerts_by_severity')], enabled: true });
  await act(async () => {});
  assert.equal(requests.length, 1, 'AA alone needs no inventory SQL');
  hook.rerender({ widgets: [], enabled: true });
  await act(async () => {});
  assert.equal(requests.length, 1, 'an empty board needs no inventory SQL');
});

test('two active requests bound fan-out and removing filters cancels active and queued work', async () => {
  const requests: Array<{ url: URL; signal: AbortSignal; finish: () => void }> = [];
  globalThis.fetch = ((input, init) => new Promise((resolve, reject) => {
    const signal = init?.signal as AbortSignal;
    requests.push({ url: new URL(String(input), 'http://localhost'), signal, finish: () => resolve(Response.json(base)) });
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  })) as typeof fetch;
  const hook = board(['A', 'B', 'C', 'D'].map((company) => widget('devices_total', company)));
  await waitFor(() => assert.equal(requests.length, 2));
  hook.rerender({ widgets: [widget('devices_total', 'B'), widget('devices_total', 'D')], enabled: true });
  await waitFor(() => assert.equal(requests.length, 3));
  assert.equal(requests[0].signal.aborted, true);
  assert.deepEqual(requests.map((request) => request.url.searchParams.get('company')), ['A', 'B', 'D']);
  await act(async () => { requests[1].finish(); requests[2].finish(); });
  await waitFor(() => assert.equal(hook.result.current.loading, false));
  assert.equal(requests.length, 3, 'C never started after removal');
  hook.unmount();
});

test('cache isolates projections and explicit retry fetches only failed groups', async () => {
  const requests: URL[] = [];
  let fail = true;
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input), 'http://localhost');
    requests.push(url);
    if (url.searchParams.get('company') === 'B' && fail) return Response.json({ detail: 'Unavailable' }, { status: 503 });
    return Response.json({ ...base, ...(url.searchParams.getAll('widgets').includes('devices_by_os') ? { devices_by_os: [{ key: 'Windows', count: 7 }] } : {}) });
  }) as typeof fetch;
  const widgets = [widget('devices_total', 'A'), widget('devices_total', 'B')];
  const hook = board(widgets);
  await waitFor(() => assert.ok(hook.result.current.error));
  await waitFor(() => assert.equal(hook.result.current.metricsFor({ company: 'A' })?.devices_total, 7));
  assert.equal(requests.length, 2, 'no automatic retries');
  fail = false;
  await act(async () => { await hook.result.current.reload(); });
  await waitFor(() => assert.equal(hook.result.current.error, ''));
  assert.deepEqual(requests.map((url) => url.searchParams.get('company')), ['A', 'B', 'B']);
  hook.rerender({ widgets: [widget('devices_by_os', 'A')], enabled: true });
  await waitFor(() => assert.deepEqual(hook.result.current.metricsFor({ company: 'A' })?.devices_by_os, [{ key: 'Windows', count: 7 }]));
  assert.equal(requests.length, 4, 'a counter-only cache cannot supply a distribution');
  hook.rerender({ widgets, enabled: true });
  await waitFor(() => assert.equal(hook.result.current.metricsFor({ company: 'B' })?.devices_total, 7));
  assert.equal(requests.length, 4, 'fresh matching selections reuse their own cache');
});

test('cached preferences keep their selection available during a background refresh', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  const saved = { widgets: [widget('devices_total')], is_default: false };
  let requests = 0;
  let finish!: (response: Response) => void;
  globalThis.fetch = (() => {
    requests++;
    if (requests === 1) return Promise.resolve(Response.json(saved));
    return new Promise<Response>((resolve) => { finish = resolve; });
  }) as typeof fetch;
  const wrapper = ({ children }: { children: React.ReactNode }) => createElement(QueryClientProvider, { client }, children);
  const hook = renderHook(() => useNetskopeDashboardPreferences({
    authChecked: true, authenticated: true, onUnauthorized: () => {}, onError: () => {}, onNotice: () => {},
  }), { wrapper });
  await waitFor(() => assert.equal(hook.result.current.loading, false));
  await act(async () => { void client.invalidateQueries({ queryKey: ['netskope', 'dashboard-preferences'] }); });
  await waitFor(() => assert.equal(requests, 2));
  assert.equal(hook.result.current.loading, false, 'known preferences must not suspend the board during refresh');
  assert.deepEqual(hook.result.current.widgets.map((entry) => entry.id), ['devices_total']);
  await act(async () => { finish(Response.json(saved)); });
});
