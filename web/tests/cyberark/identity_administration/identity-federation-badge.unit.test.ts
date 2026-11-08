import test from 'node:test';
import assert from 'node:assert/strict';
import { federationBadgeLabel, federationBadgeTone, federationDrawerSummary } from '../../../src/cyberark/identity_administration/lib/federation-resolution.ts';
import type { FederationResolution } from '../../../src/cyberark/identity_administration/types/identity.ts';

/* IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §3.1/§7: every explicit
   federation_resolution state maps to distinct, non-misleading copy. The
   federation is always presented as a *derived* association -- these
   tests guard against any label implying the federation contains the
   user (that phrasing is explicitly forbidden by the plan). */

function resolution(overrides: Partial<FederationResolution>): FederationResolution {
  return {
    status: 'matched',
    match_basis: 'email_domain_rule',
    email_domain: null,
    federation_code: null,
    expected_name: null,
    object_id: null,
    source_id: null,
    display_name: null,
    active: null,
    ...overrides,
  };
}

test('federationBadgeLabel: matched shows the expected federation name', () => {
  const matched = resolution({ status: 'matched', expected_name: 'Okta Acme', display_name: 'Okta Acme' });
  assert.equal(federationBadgeLabel(matched), 'Okta Acme');
});

test('federationBadgeLabel: each non-matched status has distinct, correct copy', () => {
  assert.equal(federationBadgeLabel(resolution({ status: 'missing_federation', expected_name: 'Okta Globex' })), 'Esperada, no sincronizada');
  assert.equal(federationBadgeLabel(resolution({ status: 'unsupported_domain' })), 'Sin regla');
  assert.equal(federationBadgeLabel(resolution({ status: 'missing_email' })), '—');
  assert.equal(federationBadgeLabel(resolution({ status: 'ambiguous', expected_name: 'Okta INITECH' })), 'Más de una federación coincide');
});

test('federationBadgeLabel: absent resolution (backend hasn\'t attached it yet) degrades gracefully', () => {
  assert.equal(federationBadgeLabel(undefined), 'Sin regla de federación');
  assert.equal(federationBadgeLabel(null), 'Sin regla de federación');
});

test('federationBadgeTone: matched is success, missing/ambiguous are warning, the rest are neutral', () => {
  assert.equal(federationBadgeTone(resolution({ status: 'matched' })), 'success');
  assert.equal(federationBadgeTone(resolution({ status: 'missing_federation' })), 'warning');
  assert.equal(federationBadgeTone(resolution({ status: 'ambiguous' })), 'warning');
  assert.equal(federationBadgeTone(resolution({ status: 'unsupported_domain' })), 'neutral');
  assert.equal(federationBadgeTone(resolution({ status: 'missing_email' })), 'neutral');
  assert.equal(federationBadgeTone(undefined), 'neutral');
});

test('federationDrawerSummary: never phrases the association as the federation containing the user', () => {
  const cases: Array<FederationResolution | null | undefined> = [
    resolution({ status: 'matched', expected_name: 'Okta Globex' }),
    resolution({ status: 'missing_federation', expected_name: 'Okta Acme' }),
    resolution({ status: 'unsupported_domain' }),
    resolution({ status: 'missing_email' }),
    resolution({ status: 'ambiguous', expected_name: 'Okta INITECH' }),
    undefined,
  ];
  for (const value of cases) {
    const summary = federationDrawerSummary(value);
    assert.ok(summary.length > 0);
    assert.ok(!/contiene al usuario/i.test(summary));
  }
});

test('federationDrawerSummary: matched explicitly names the expected federation', () => {
  assert.match(federationDrawerSummary(resolution({ status: 'matched', expected_name: 'Okta Globex' })), /Okta Globex/);
});
