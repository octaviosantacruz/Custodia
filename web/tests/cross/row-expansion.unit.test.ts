import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/* UX-AUD-007: plain tables must not fake treegrid semantics on <tr>; the
   expansion control belongs in a real button inside the first cell. The e2e
   suite covers the reachable routes in the browser; this scan also guards the
   Identity Administration roles table, which no current navigation renders. */
const FILES = [
  'cross/components/activity-view.tsx',
  'cross/components/connection-inventory-workspace.tsx',
  'cyberark/identity_administration/components/identity-admin-workspace.tsx',
  'cyberark/pam/components/pam-roles-workspace.tsx',
  'cyberark/sia/components/sia-workspace.tsx',
];

test('expandable table rows never carry aria-expanded, aria-label or tabIndex', () => {
  for (const file of FILES) {
    const source = readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8');
    for (const tag of source.match(/<tr\b[^>]*>/g) ?? []) {
      assert.ok(!tag.includes('aria-expanded'), `${file}: <tr> must not carry aria-expanded -> ${tag.slice(0, 120)}`);
      assert.ok(!tag.includes('aria-label'), `${file}: <tr> must not carry aria-label -> ${tag.slice(0, 120)}`);
      assert.ok(!tag.includes('tabIndex={0}'), `${file}: <tr> must not be focusable -> ${tag.slice(0, 120)}`);
    }
  }
});
