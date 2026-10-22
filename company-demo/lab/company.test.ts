import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accounts, company, coverage, coverageSummary, devices, people, personSummary, safes } from './company.ts';
import { createCompanyApi } from './api.ts';

test('one fictional company: all people, equipment and privileged accounts resolve consistently', () => {
  assert.equal(company.fictional, true);
  assert.equal(new Set(people.map(p => p.email)).size, 6);
  assert.equal(new Set(devices.map(d => d.deviceId)).size, devices.length);
  for (const p of people) {
    assert.ok(p.email.endsWith('@faro.example'));
    assert.ok(company.areas.includes(p.area));
    assert.ok(company.sites.includes(p.site));
    for (const id of p.safeIds) assert.ok(safes.some(s => s.id === id));
  }
  for (const d of devices) assert.ok(people.some(p => p.id === d.personId));
  for (const a of accounts) assert.ok(safes.some(s => s.id === a.safeId));
  assert.equal(people.flatMap(p => p.identityIds).length, 7); // Elena has two active records, not a seventh person.
});

test('the company has contrasting investigative cases and no fabricated identity match', () => {
  assert.deepEqual(people.map(p => coverage(p).status), ['partial', 'covered', 'gap', 'covered', 'unknown', 'covered']);
  const summary = coverageSummary();
  assert.equal(summary.counts.denominator, 6);
  assert.equal(summary.counts.coverage_percent, 50);
  assert.equal(summary.counts.covered + summary.counts.partial + summary.counts.gap + summary.counts.unknown, 6);
  assert.equal(personSummary(people[4]).tools.identity.status, 'ambiguous');
  assert.equal(personSummary(people[1]).tools.pam.status, 'unmatched');
});

test('partial and stale source evidence cannot produce coverage or gap conclusions', () => {
  for (const mode of ['stale', 'partial'] as const) {
    assert.ok(people.every(p => coverage(p, mode).status === 'unknown'));
    assert.equal(coverageSummary(mode).counts.coverage_percent, null);
    assert.equal(coverageSummary(mode).counts.device_coverage_percent, null);
    assert.equal(coverageSummary(mode).counts.gap, 0);
  }
  assert.equal(coverage(people[0], 'partial').sources.netskope.status, 'partial');
  assert.equal(coverage(people[0], 'stale').sources.netskope.age_hours, 73);
});

const call = (path: string, method = 'GET') => createCompanyApi('complete')(new URL(path, 'http://demo.invalid'), method);
test('person-to-inventory drill uses the same exact person and two observed equipment records', async () => {
  const summary = await (await call('/api/chains/person?email=ana.soto%40faro.example')).json();
  const inventory = await (await call(`/api/cmdb/netskope/devices?observed_user_id=${summary.tools.netskope.user.object_id}&freshness=all`)).json();
  assert.equal(inventory.total, 2);
  assert.ok(inventory.rows.every((row: { observed_user: { email: string } }) => row.observed_user.email === summary.email));
  assert.deepEqual(inventory.rows.map((r: { display_name: string }) => r.display_name).sort(), ['FARO-INF-001', 'FARO-INF-ANTERIOR']);
  const detail = await (await call('/api/safes/1')).json();
  const accountList = await (await call('/api/safes/1/accounts')).json();
  assert.equal(detail.safe.account_count, accountList.total);
  assert.equal(detail.safe.responsible_name, summary.name);
  const chain = await (await call('/api/chains/pam/expand?type=safe&id=1&direction=forward')).json();
  assert.equal(chain.total, summary.tools.pam.totals.platforms);
  assert.deepEqual(chain.rows.map((r: { label: string }) => r.label).sort(), ['PostgreSQL', 'Unix']);
});

test('search, filters and pagination narrow the same company dataset', async () => {
  const search = await (await call('/api/chains/person/search?q=carla')).json();
  assert.equal(search.people.length, 1);
  assert.equal(search.people[0].email, people[2].email);
  const first = await (await call('/api/cmdb/netskope/devices?freshness=all&limit=2')).json();
  const second = await (await call('/api/cmdb/netskope/devices?freshness=all&limit=2&offset=2')).json();
  assert.equal(first.total, 6);
  assert.ok(first.rows.every((a: { object_id: number }) => !second.rows.some((b: { object_id: number }) => a.object_id === b.object_id)));
  assert.equal((await (await call('/api/safes?q=DEV')).json()).total, 1);
  assert.equal((await (await call('/api/cmdb/netskope/devices')).json()).total, 5);
});

test('missing people, unsupported endpoints and writes are explicit, never fabricated success', async () => {
  assert.equal((await call('/api/chains/person?email=missing%40faro.example')).status, 404);
  assert.equal((await call('/api/crowdstrike/devices')).status, 501);
  assert.equal((await call('/api/safes/1', 'PUT')).status, 405);
  assert.equal((await call('/api/cmdb/netskope/devices?client_compliance=current')).status, 422);
});

test('a stale company snapshot never contains observations from after its capture', async () => {
  const response = await createCompanyApi('stale')(new URL('/api/cmdb/netskope/devices?freshness=all', 'http://demo.invalid'));
  const data = await response.json();
  for (const device of data.rows) {
    assert.ok(Date.parse(device.device_evidence.last_signal_at) <= Date.parse(data.source_evidence.source_completed_at));
    assert.equal(device.device_evidence.state, 'unknown');
  }
});
