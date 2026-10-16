import assert from 'node:assert/strict';
import test from 'node:test';

import {
  personConnectionLink,
  personCoverageDetailReason,
} from '../../src/cross/lib/person-coverage-presentation.ts';
import type {
  PersonClientCoverageDetail,
  PersonCoverageSourceRun,
  PersonToolSummary,
} from '../../src/cross/lib/chains-api.ts';

function sourceRun(source: 'identity_administration' | 'netskope', freshness: PersonCoverageSourceRun['freshness']): PersonCoverageSourceRun {
  return {
    source_system: source,
    source_file: source === 'netskope' ? 'netskope-api' : 'identity-administration-scim',
    freshness,
  };
}

function detail(overrides: Partial<PersonClientCoverageDetail> = {}): PersonClientCoverageDetail {
  return {
    devices_ambiguous: 0, devices_not_recent: 0, devices_recent: 0, devices_total: 0,
    email: 'persona@example.test', explanation: 'La respuesta informa evidencia desconocida.',
    identity_records: 1, metric_code: 'CONN-001', metric_version: '1', netskope_users: 0,
    sources: {
      identity: sourceRun('identity_administration', 'fresh'),
      netskope: sourceRun('netskope', 'fresh'),
    },
    status: 'unknown',
    ...overrides,
  };
}

test('individual unknown uses its own source snapshot and distinguishes ambiguity from absent counterpart', () => {
  assert.equal(personCoverageDetailReason(detail({ sources: {
    identity: sourceRun('identity_administration', 'fresh'),
    netskope: sourceRun('netskope', 'stale'),
  } })), 'No se puede determinar: Netskope desactualizada.');
  assert.equal(personCoverageDetailReason(detail({ devices_ambiguous: 1, netskope_users: 1 })),
    'No se puede determinar: la evidencia individual tiene candidatos o dispositivos ambiguos.');
  assert.equal(personCoverageDetailReason(detail()),
    'No se puede determinar: no hay una contraparte Netskope observada para esta persona.');
  for (const candidates of [
    { identity_records: 2, netskope_users: 1 },
    { identity_records: 1, netskope_users: 2 },
  ]) {
    assert.equal(personCoverageDetailReason(detail({ ...candidates, devices_ambiguous: 0 })),
      'No se puede determinar: la evidencia individual tiene candidatos o dispositivos ambiguos.');
  }
});

test('only unknown individual statuses need a presentation reason', () => {
  assert.equal(personCoverageDetailReason(detail({ status: 'gap', netskope_users: 1 })), null);
});


test('a missing, reference-only or ambiguous counterpart never confirms an Identity–Netskope connection', () => {
  const matched: PersonToolSummary = { status: 'matched', basis: 'email_exact' };
  for (const counterpart of [undefined, { status: 'unmatched' }, { status: 'reference' }] as (PersonToolSummary | undefined)[]) {
    assert.equal(personConnectionLink(matched, counterpart).label, 'Sin contraparte confirmada');
    assert.equal(personConnectionLink(counterpart, matched).label, 'Sin contraparte confirmada');
  }
  for (const [identity, netskope] of [[matched, { status: 'ambiguous' }], [{ status: 'ambiguous' }, matched]] as [PersonToolSummary, PersonToolSummary][]) {
    assert.equal(personConnectionLink(identity, netskope).label, 'Vínculo ambiguo');
    assert.match(personConnectionLink(identity, netskope).explanation, /No se confirma una relación/);
  }
});
