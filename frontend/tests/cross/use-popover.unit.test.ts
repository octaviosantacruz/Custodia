import assert from 'node:assert/strict';
import test from 'node:test';
import { focusRestoreTarget } from '../../src/cross/hooks/use-popover.ts';

/* UX-AUD-004: the popover focus-restore decision, extracted as a pure helper
   because the repo's unit suite has no DOM (FE-TEST-001). The hook uses it on
   Escape; the e2e suite covers the real browser behavior. */

test('focus restoration prefers the element that opened the popover', () => {
  const previous = { isConnected: true } as HTMLElement;
  const fallback = { isConnected: true } as HTMLElement;
  assert.equal(focusRestoreTarget(previous, fallback), previous);
});

test('a disconnected previous node falls back to the declared trigger', () => {
  const previous = { isConnected: false } as HTMLElement;
  const fallback = { isConnected: true } as HTMLElement;
  assert.equal(focusRestoreTarget(previous, fallback), fallback);
});

test('no target is focused when neither node is connected', () => {
  assert.equal(focusRestoreTarget(null, null), null);
  assert.equal(focusRestoreTarget(null, undefined), null);
  assert.equal(
    focusRestoreTarget({ isConnected: false } as HTMLElement, { isConnected: false } as HTMLElement),
    null,
  );
});
