import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { JSDOM } from 'jsdom';

/* FE-MOTION-001: exit-duration contract of the shared presence hook, including
   the zero-duration path the widget picker uses under reduced motion. Same
   `node --test` + jsdom + Testing Library setup FE-TEST-001 established. */

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
const { usePresence } = await import('../../src/cross/hooks/use-presence.ts');

type Value = { id: number } | null;

afterEach(() => cleanup());

test('keeps the last value mounted during the exit window and then unmounts it', async () => {
  const first = { id: 1 };
  const { result, rerender } = renderHook(({ value }: { value: Value }) => usePresence(value, 60), { initialProps: { value: first as Value } });
  assert.equal(result.current.current, first);
  assert.equal(result.current.leaving, false);

  rerender({ value: null });
  assert.equal(result.current.current, first);
  assert.equal(result.current.leaving, true);

  await waitFor(() => assert.equal(result.current.current, null));
  assert.equal(result.current.leaving, false);
});

test('a zero exit duration unmounts on the same commit, with no pending wait', () => {
  const first = { id: 2 };
  const { result, rerender } = renderHook(({ value }: { value: Value }) => usePresence(value, 0), { initialProps: { value: first as Value } });
  rerender({ value: null });
  assert.equal(result.current.current, null);
  assert.equal(result.current.leaving, false);
});

test('returning before the exit window cancels the unmount', async () => {
  const first = { id: 3 };
  const { result, rerender } = renderHook(({ value }: { value: Value }) => usePresence(value, 60), { initialProps: { value: first as Value } });
  rerender({ value: null });
  rerender({ value: first });
  assert.equal(result.current.current, first);
  assert.equal(result.current.leaving, false);
  await new Promise((resolve) => setTimeout(resolve, 90));
  assert.equal(result.current.current, first);
  assert.equal(result.current.leaving, false);
});
