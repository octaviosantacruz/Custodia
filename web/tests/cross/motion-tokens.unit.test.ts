import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { MOTION_BASE_MS, MOTION_FAST_MS, MOTION_PANEL_MS } from '../../src/cross/lib/motion.ts';

/* FE-MOTION-001: the CSS file is the source of truth for the durations and
   the reduced-motion policy; this scan keeps the TS mirror honest and fails
   if a migrated surface loses its explicit reduce rule or the legacy 420ms
   workspace animation comes back. */
const motionCss = readFileSync(new URL('../../src/styles/motion.css', import.meta.url), 'utf8');
const mainTsx = readFileSync(new URL('../../src/main.tsx', import.meta.url), 'utf8');
const stylesCss = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

function tokenValue(css: string, name: string): string | null {
  const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  return match ? match[1].trim() : null;
}

test('motion.css defines the phase-1 durations and zeroes them under reduced motion', () => {
  assert.equal(tokenValue(motionCss, 'motion-fast'), '140ms');
  assert.equal(tokenValue(motionCss, 'motion-base'), '190ms');
  assert.equal(tokenValue(motionCss, 'motion-panel'), '210ms');
  const reduceBlock = motionCss.slice(motionCss.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.ok(reduceBlock.length > 0, 'motion.css must declare the reduced-motion block');
  for (const token of ['motion-fast', 'motion-base', 'motion-panel']) {
    assert.match(reduceBlock, new RegExp(`--${token}:\\s*0ms;`), `${token} must resolve to 0ms under reduce`);
  }
  // The policy is token-based; no destructive global override.
  assert.ok(!/\*\s*\{[^}]*animation:\s*none\s*!important/.test(motionCss), 'no global animation-killer rule');
});

test('the TS mirror matches the CSS tokens', () => {
  assert.equal(`--motion-fast ${MOTION_FAST_MS}ms`, `--motion-fast ${tokenValue(motionCss, 'motion-fast')}`);
  assert.equal(`--motion-base ${MOTION_BASE_MS}ms`, `--motion-base ${tokenValue(motionCss, 'motion-base')}`);
  assert.equal(`--motion-panel ${MOTION_PANEL_MS}ms`, `--motion-panel ${tokenValue(motionCss, 'motion-panel')}`);
});

test('main.tsx imports motion.css after the styles it normalizes', () => {
  const motionImport = mainTsx.indexOf("import './styles/motion.css';");
  const shellImport = mainTsx.indexOf("import './styles/application-shell.css';");
  assert.ok(shellImport >= 0 && motionImport > shellImport, 'motion.css must load after application-shell.css');
});

test('the historical 420ms workspace animation is replaced by the content arrival', () => {
  assert.ok(!stylesCss.includes('workspace-arrive'), 'styles.css must not keep the 420ms workspace-arrive animation');
  assert.match(motionCss, /\.workspace-content\.is-arriving-a \{ animation: workspace-content-arrive /);
  assert.match(motionCss, /\.workspace-content\.is-arriving-b \{ animation: workspace-content-arrive-alt /);
});
