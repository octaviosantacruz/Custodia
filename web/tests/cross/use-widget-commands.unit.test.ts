import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

/* Bundle-size follow-up to UX-SEARCH-001 (see lib/command-center.ts): the
   PAM/Netskope widget catalogs are no longer imported eagerly by
   command-center.ts -- GlobalSearch fetches them with import() through the
   useWidgetCommands hook only while the Command-K dialog is open (or a
   caller preloads ahead of that). This hook lives in its own `.ts` module
   precisely so it's testable here: `node --test` can type-strip a `.ts` file
   but cannot parse the JSX in global-search.tsx, so the dialog's own
   rendering stays covered by the frontend/tests/e2e/auth.spec.ts
   UX-SEARCH-001 suite instead.

   Same `node --test` + jsdom + Testing Library setup FE-TEST-001 established
   for pam-refresh-contract.unit.test.ts, duplicated here rather than shared
   so neither file's already-verified setup is put at risk by a shared
   dependency. */
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
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { act, cleanup, renderHook, waitFor } = await import('@testing-library/react');
const { useWidgetCommands } = await import('../../src/cross/hooks/use-widget-commands.ts');

afterEach(() => {
  cleanup();
});

test('the widget list stays empty until the dialog is active, then loads both catalogs', async () => {
  const view = renderHook(
    ({ permissions, active }: { permissions: string[]; active: boolean }) => useWidgetCommands(permissions, active),
    { initialProps: { permissions: ['inventory:read', 'netskope:read'], active: false } },
  );

  // Inactive: no import() was ever requested, so there is nothing to show.
  assert.deepEqual(view.result.current.commands, []);
  assert.equal(view.result.current.status, 'idle');

  view.rerender({ permissions: ['inventory:read', 'netskope:read'], active: true });
  await waitFor(() => {
    assert.equal(view.result.current.status, 'ready');
  });
  assert.ok(view.result.current.commands.length > 20, 'both real widget catalogs should be present');
  assert.ok(view.result.current.commands.some((command) => command.platform === 'cyberark'));
  assert.ok(view.result.current.commands.some((command) => command.platform === 'netskope'));
  assert.ok(view.result.current.commands.every((command) => command.kind === 'widget'));
});

test('permissions gate the loaded widgets the same way the pure adapter does', async () => {
  const view = renderHook(
    ({ permissions }: { permissions: string[] }) => useWidgetCommands(permissions, true),
    { initialProps: { permissions: ['inventory:read'] } },
  );
  await waitFor(() => {
    assert.equal(view.result.current.status, 'ready');
  });
  assert.ok(view.result.current.commands.length > 0);
  assert.ok(view.result.current.commands.every((command) => command.platform === 'cyberark'), 'no Netskope widget without netskope:read');
});

test('closing (active=false) right after opening does not throw, and reactivating still resolves the cached catalogs', async () => {
  const view = renderHook(
    ({ active }: { active: boolean }) => useWidgetCommands(['inventory:read', 'netskope:read'], active),
    { initialProps: { active: false } },
  );

  // Toggle on then immediately off, before the import() promise has any
  // chance to resolve: the effect's own cleanup marks that attempt
  // "cancelled", so its eventual resolution must not update state.
  view.rerender({ active: true });
  view.rerender({ active: false });
  assert.deepEqual(view.result.current.commands, []);

  // Let the cancelled load settle in the background without anyone
  // listening: it must not throw or leave an unhandled rejection.
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(view.result.current.status, 'loading', 'a cancelled resolution must not flip status to ready while inactive');

  // Reactivating resolves from the same cached promise -- no second load.
  view.rerender({ active: true });
  await waitFor(() => {
    assert.equal(view.result.current.status, 'ready');
  });
  assert.ok(view.result.current.commands.length > 20);
});

test('ensureLoaded lets a caller preload before activating, without duplicating the load', async () => {
  const view = renderHook(() => useWidgetCommands(['inventory:read', 'netskope:read'], false));

  // A hover/focus preload calls this directly, ahead of the dialog opening;
  // it triggers a state update (status -> loading) outside of a rerender, so
  // it's wrapped in act() the same way a real event handler would be.
  let preload!: ReturnType<typeof view.result.current.ensureLoaded>;
  let again!: ReturnType<typeof view.result.current.ensureLoaded>;
  act(() => {
    preload = view.result.current.ensureLoaded();
    again = view.result.current.ensureLoaded();
  });
  assert.equal(preload, again, 'a second call while the first is in flight must reuse the same promise');
  await preload;
  assert.deepEqual(view.result.current.commands, [], 'still inactive: the loaded sources are not applied until active');
});
