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
    return nextResolve(specifier, context);
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
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { createElement } = await import('react');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { cleanup, renderHook, waitFor } = await import('@testing-library/react');
const { useCyberarkRisk } = await import('../../../src/cyberark/risk_management/hooks/use-cyberark-risk.ts');
const { cyberarkSeverityCountsLabel } = await import('../../../src/cyberark/risk_management/lib/cyberark-risk-presentation.ts');

const originalFetch = globalThis.fetch;
const clients: InstanceType<typeof QueryClient>[] = [];

function client() {
  const value = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(value);
  return value;
}

afterEach(() => {
  cleanup();
  for (const value of clients.splice(0)) value.clear();
  globalThis.fetch = originalFetch;
});

test('severity summary distinguishes an absent aggregate from a reported zero', () => {
  assert.equal(cyberarkSeverityCountsLabel(undefined), 'Sin datos');
  assert.equal(cyberarkSeverityCountsLabel(null), 'Sin datos');
  assert.equal(cyberarkSeverityCountsLabel({}), 'Sin datos');
  assert.equal(cyberarkSeverityCountsLabel({ high: 0 }), '0');
  assert.equal(cyberarkSeverityCountsLabel({ high: 2, low: 3 }), '5');
});

test('the narrow permission gate prevents every CyberArk risk request', async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const queryClient = client();
  const wrapper = ({ children }: { children: unknown }) => createElement(QueryClientProvider, { client: queryClient }, children);
  renderHook(() => useCyberarkRisk({ enabled: false, onUnauthorized: () => {} }), { wrapper });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(calls, []);
});

test('overview and findings start independently and findings keep the confirmed pagination contract', async () => {
  const calls: string[] = [];
  const pending: Array<{ path: string; resolve: (response: Response) => void }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = String(input);
    calls.push(path);
    return new Promise<Response>((resolve) => pending.push({ path, resolve }));
  }) as typeof fetch;
  const queryClient = client();
  const wrapper = ({ children }: { children: unknown }) => createElement(QueryClientProvider, { client: queryClient }, children);
  const result = renderHook(() => useCyberarkRisk({ enabled: true, onUnauthorized: () => {} }), { wrapper });

  await waitFor(() => assert.equal(calls.length, 2));
  const paths = calls.map((call) => new URL(call, 'http://localhost/'));
  assert.ok(paths.some((url) => url.pathname === '/api/cyberark-risk/overview'));
  const findings = paths.find((url) => url.pathname === '/api/cyberark-risk/findings');
  assert.equal(findings?.searchParams.get('limit'), '50');
  assert.equal(findings?.searchParams.get('offset'), '0');

  for (const request of pending.splice(0)) request.resolve(new Response(JSON.stringify(
    request.path.includes('/findings')
      ? { rows: [{ finding_id: 'legacy-finding', risk_type_id: 'risk-1', entity_id: 'opaque-entity-1', entity_type: 'identity', severity: 'high', status: 'open', first_detected_at: null, last_detected_at: null }], limit: 50, offset: 0, is_last_page: true, source: 'cyberark_risk_management', fetched_at: '2026-10-01T00:00:00Z' }
      : { source: 'cyberark_risk_management', fetched_at: '2026-10-01T00:00:00Z', summary: { total_findings_by_severity: {}, entity_types: [] }, risk_types: [], remediations: [], progress: { points: [] }, recommendations_status: 'catalog_options_only' },
  ), { status: 200, headers: { 'content-type': 'application/json' } }));
  await waitFor(() => assert.equal(result.result.current.findings.isFetching, false));
  assert.equal(result.result.current.findings.data?.entity_names_visible, false);
  assert.equal(result.result.current.findings.data?.rows[0]?.entity_name, null);
});
