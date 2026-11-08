import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import ts from 'typescript5';

// Node's native TS runner needs JSX compilation and Vite's CSS/env handling.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier) && context.parentURL?.includes('/src/')) {
      for (const suffix of ['.ts', '.tsx']) {
        const url = new URL(`${specifier}${suffix}`, context.parentURL);
        if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
    if (url.endsWith('.tsx')) return {
      format: 'module', shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
      }).outputText,
    };
    const result = nextLoad(url, context);
    if (url.endsWith('/src/cross/lib/api.ts')) {
      const source = typeof result.source === 'string' ? result.source : Buffer.from(result.source as ArrayBuffer).toString('utf8');
      return { ...result, source: source.replaceAll('import.meta.env.VITE_API_URL', "''") };
    }
    return result;
  },
});

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/chains/person' });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node, Event: dom.window.Event, MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
});
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { createElement } = await import('react');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { cleanup, configure, fireEvent, render, within, waitFor } = await import('@testing-library/react');
configure({ asyncUtilTimeout: 10_000 });
const { PersonChainsWorkspace } = await import('../../src/cross/components/person-chains-workspace.tsx');
const originalFetch = globalThis.fetch;
let client: InstanceType<typeof QueryClient>;
afterEach(() => { cleanup(); client?.clear(); globalThis.fetch = originalFetch; });

test('Identity and Netskope registrations remain visible while incomplete runs leave client coverage unconfirmed', async () => {
  const email = 'persona@example.test';
  const sources = {
    identity: { source_system: 'identity_administration', source_file: 'identity-administration-scim', freshness: 'incomplete' },
    netskope: { source_system: 'netskope', source_file: 'netskope-api', freshness: 'incomplete' },
  };
  const person = { email, name: 'Persona en dos fuentes', sources: ['identity', 'netskope'] };
  const summary = {
    ...person, tools: {
      identity: { status: 'matched', basis: 'email_exact', user: { object_id: 1, display_name: person.name, source_id: 'identity-1' }, role_count: 2 },
      netskope: { status: 'matched', basis: 'email_exact', user: { object_id: 2, display_name: person.name, source_id: 'netskope-1' }, device_count: 2 },
    },
  };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    const payload = path.endsWith('/search') ? { query: 'persona', people: [person] }
      : path.endsWith('/coverage/detail') ? {
        email, sources, status: 'unknown', explanation: 'Las fuentes todavía no completaron sus corridas.',
        identity_records: 1, netskope_users: 1, devices_recent: 2, devices_not_recent: 1,
        devices_ambiguous: 0, devices_total: 3, metric_code: 'CONN-001', metric_version: '1',
      } : summary;
    return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(createElement(QueryClientProvider, { client }, createElement(PersonChainsWorkspace, {
    authChecked: true, authenticated: true, permissions: ['identity:catalogs_read', 'netskope:read'],
    onUnauthorized: () => assert.fail('Unexpected 401'), onError: (message: string) => assert.fail(message), onNavigate: () => {},
  })));
  fireEvent.change(view.getByRole('searchbox'), { target: { value: 'persona' } });
  const option = await view.findByRole('option', { name: /Persona en dos fuentes/ });
  // Search results name platforms: Identity belongs to CyberArk, never a separate source.
  assert.deepEqual(within(option).getAllByText(/^(CyberArk|Netskope|Identity Administration)$/).map((chip) => chip.textContent), ['CyberArk', 'Netskope']);
  fireEvent.click(option);
  const hub = await view.findByLabelText('Persona Persona en dos fuentes');
  const nodes = within(hub).getByRole('group', { name: 'Herramientas de la persona' });
  // Netskope answers "has the client"; PAM is not readable, so CyberArk says so instead of "no".
  assert.ok(within(nodes).getByRole('button', { name: 'Netskope: Cliente activo · 2 equipos recientes' }));
  assert.ok(within(nodes).getByRole('img', { name: 'CyberArk: Sin permiso de lectura' }));
  assert.equal(within(hub).queryByRole('button', { name: /^CyberArk:/ }), null);
  assert.equal(view.queryByText('Identity Administration'), null);
  assert.equal(view.queryByText('PERSONA · DETALLE INDIVIDUAL'), null);
  const disclosure = within(hub).getByText('Evidencia del cliente Netskope').closest('details')!;
  assert.equal(disclosure.open, false);
  fireEvent.click(within(hub).getByText('Evidencia del cliente Netskope'));
  assert.equal(disclosure.open, true);
  const evidence = within(disclosure);
  await waitFor(() => assert.ok(evidence.getByText('Por verificar')));
  assert.ok(evidence.getByText('Vinculados por correo'));
  assert.ok(evidence.getByText(/Identity Administration con última corrida incompleta; Netskope con última corrida incompleta/));
  assert.ok(evidence.getByText(/Dispositivos recientes 2/));
  // Personas only shows evidence for the selected person.
  assert.equal(view.queryByRole('group', { name: 'Cobertura de la población' }), null);
});
