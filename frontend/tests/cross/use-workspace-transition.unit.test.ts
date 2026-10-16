import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

/* FE-MOTION-001: the arrival class may only be produced by a real
   `workspaceView` change. Internal refreshes (a same-view re-render) must not
   replay it, and a back-to-back navigation must switch to the alternate
   keyframes instead of remounting the router. Same `node --test` setup as the
   FE-TEST-001 pilots; the resolve shim covers the extensionless `src/`
   imports the runtime would otherwise miss. */
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

const { cleanup, renderHook, waitFor } = await import('@testing-library/react');
const { useWorkspaceTransition } = await import('../../src/cross/hooks/use-workspace-transition.ts');

type View = 'general' | 'safes' | 'posture';

afterEach(() => cleanup());

test('the arrival class is applied before paint (layout effect)', () => {
  const source = readFileSync(new URL('../../src/cross/hooks/use-workspace-transition.ts', import.meta.url), 'utf8');
  const activation = source.indexOf('setArrival((current) => ({ id: current.id + 1, active: true }))');
  assert.ok(activation > 0, 'the activation call must exist');
  const layoutHook = source.lastIndexOf('useLayoutEffect(', activation);
  const passiveHook = source.lastIndexOf('useEffect(', activation);
  assert.ok(layoutHook !== -1 && layoutHook > passiveHook, 'the arrival activation must run in a layout effect, before the first paint of the new workspace');
});

test('the arrival class starts only on a real workspace change and then goes idle', async () => {
  const { result, rerender } = renderHook(({ view }: { view: View }) => useWorkspaceTransition(view), { initialProps: { view: 'general' as View } });
  assert.equal(result.current, '');

  rerender({ view: 'safes' });
  assert.equal(result.current, ' is-arriving-a');

  // An internal refresh (same view, new render) never replays it.
  rerender({ view: 'safes' });
  assert.equal(result.current, ' is-arriving-a');

  // Back-to-back navigation switches keyframes so the animation restarts.
  rerender({ view: 'posture' });
  assert.equal(result.current, ' is-arriving-b');

  await waitFor(() => assert.equal(result.current, ''));
});
