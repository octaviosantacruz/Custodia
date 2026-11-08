import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accounts, company, coverage, coverageSummary, devices, people, personSummary, safes } from '../../src/demo/model/company.ts';
import { allDevices, insights, personView, sourceRun } from '../../src/demo/model/view.ts';
import { netskopeVersions } from '../../src/demo/model/tools.ts';

test('one fictional company: people, equipment and privileged accounts resolve consistently', () => {
  assert.equal(company.fictional, true);
  assert.equal(new Set(people.map(p => p.email)).size, 6);
  for (const p of people) {
    assert.ok(p.email.endsWith('@acme.example'));
    for (const id of p.safeIds) assert.ok(safes.some(s => s.id === id));
  }
  for (const d of devices) assert.ok(people.some(p => p.id === d.personId));
  for (const a of accounts) assert.ok(safes.some(s => s.id === a.safeId));
  assert.equal(people.flatMap(p => p.identityIds).length, 7); // Eve tiene dos registros, no es una séptima persona.
});

test('contrasting cases and no fabricated identity match', () => {
  assert.deepEqual(people.map(p => coverage(p).status), ['partial', 'covered', 'gap', 'covered', 'unknown', 'covered']);
  assert.equal(coverageSummary().counts.coverage_percent, 50);
  assert.equal(personSummary(people[4]).tools.identity.status, 'ambiguous');
  assert.equal(personSummary(people[1]).tools.pam.status, 'unmatched');
});

test('findings cite only the sources used and name their rule', () => {
  const list = insights('complete');
  assert.deepEqual(list.map(i => [i.tone, i.person.name]), [['gap', 'Alice Morgan'], ['partial', 'Bob Chen'], ['unknown', 'Eve Taylor']]);
  for (const i of list) {
    assert.deepEqual(i.sources, i.id.startsWith('dup-') ? ['pam'] : ['pam', 'sse']);
    assert.ok(i.rule.length > 0);
  }
});

test('a stale or partial capture never produces a gap', () => {
  for (const mode of ['stale', 'partial'] as const) {
    const list = insights(mode);
    assert.equal(list.filter(i => i.tone === 'gap' || i.tone === 'partial').length, 0);
    assert.equal(list.filter(i => i.id.startsWith('blind-')).length, 2);
    assert.ok(people.every(p => personView(p, mode).coverage.status === 'unknown'));
  }
});

test('a stale capture holds no signal newer than itself', () => {
  const capture = Date.parse('2026-10-19T13:00:00Z');
  assert.ok(allDevices('stale').every(d => Date.parse(d.lastSignalAt) <= capture));
  assert.equal(allDevices('complete').filter(d => d.recent).length, 5);
});

test('client version observations belong to the selected capture', () => {
  for (const mode of ['complete', 'stale', 'partial'] as const) {
    const capture = sourceRun('sse', mode).completed_at;
    const versions = netskopeVersions(mode);
    assert.ok(versions.length > 0);
    assert.ok(versions.every(version => version.raw.observed_at === capture));
  }
});
