import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

/* FE-MOTION-001: the Safes filter-counter pulse must derive from the count
   itself. The component keys the counter span with the derived value, so the
   browser restarts its short CSS animation exactly when the number changes --
   no state copy, no ref, no timer, no effect -- and memoized rows never
   re-render. The component is a `.tsx` file, so `node --test` cannot import
   it: the source scan below pins the real mechanism and the jsdom probe
   exercises the same contract (memoized rows + a value-keyed counter). */

const componentSource = readFileSync(new URL('../../../src/cyberark/pam/components/safe-table-filters.tsx', import.meta.url), 'utf8');
const motionCss = readFileSync(new URL('../../../src/styles/motion.css', import.meta.url), 'utf8');

test('the counter derives its pulse from the count without copying it into state', () => {
  assert.ok(!componentSource.includes('useState'), 'the filters component must not copy activeFilters into state');
  assert.ok(!componentSource.includes('count-pulse'), 'the pulse must not depend on a helper that mirrors the count');
  assert.match(componentSource, /<span key=\{activeFilters\} className="filter-summary">/);
  assert.match(motionCss, /\.filter-summary \{ animation: motion-filter-pulse var\(--motion-fast\)/);
  const reduceBlock = motionCss.slice(motionCss.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduceBlock, /\.filter-summary \{ animation: none; \}/);
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

const React = await import('react');
const { cleanup, render } = await import('@testing-library/react');

afterEach(() => cleanup());

test('a counter change never commits memoized rows and remounts only the counter', () => {
  let rowRenders = 0;
  const rowPhases: string[] = [];

  /* The Profiler lives inside each memoized row on purpose: a bailed-out memo
     never re-renders the row body, so the row's own Profiler is exactly the
     instrumentation that proves no row commit happened. */
  const Row = React.memo(function Row({ safe }: { safe: string }) {
    rowRenders += 1;
    return React.createElement(React.Profiler, { id: `row-${safe}`, onRender: (_id: string, phase: string) => { rowPhases.push(`${safe}:${phase}`); } },
      React.createElement('span', { className: 'safe-table-row' }, safe));
  });

  /* Same mechanism as the component: the derived count is the key. */
  const Counter = ({ value }: { value: number }) => React.createElement('span', { key: value, className: 'filter-summary' }, `${value} activos`);

  const safes = ['A', 'B', 'C'];
  const Harness = ({ filters }: { filters: number }) => React.createElement(React.Fragment, null,
    safes.map((safe) => React.createElement(Row, { key: safe, safe })),
    React.createElement(Counter, { value: filters }),
  );

  const view = render(React.createElement(Harness, { filters: 0 }));
  const initialRenders = rowRenders;
  assert.equal(initialRenders, safes.length);
  assert.equal(rowPhases.filter((phase) => phase.endsWith(':mount')).length, safes.length);
  const firstCounter = view.container.querySelector('.filter-summary');
  assert.ok(firstCounter);

  view.rerender(React.createElement(Harness, { filters: 2 }));

  assert.equal(rowRenders, initialRenders, 'filter feedback must not re-render memoized rows');
  assert.equal(rowPhases.filter((phase) => phase.endsWith(':update')).length, 0, 'no row commit on counter change');
  const secondCounter = view.container.querySelector('.filter-summary');
  assert.ok(secondCounter);
  assert.notEqual(secondCounter, firstCounter, 'the counter span is keyed by the count, so it remounts to restart the pulse');
  assert.equal(secondCounter.className, 'filter-summary');
  assert.equal(secondCounter.textContent, '2 activos');
});
