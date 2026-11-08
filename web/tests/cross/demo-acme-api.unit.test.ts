import assert from 'node:assert/strict';
import test from 'node:test';
import { acmeResponse, shiftDates, withAcmeData } from '../../src/demo/acme-api.ts';
import { accounts, devices, people, safes } from '../../src/demo/model/company.ts';

const get = (path: string) => acmeResponse(new URL(path, 'https://demo.example'), 'GET') as Record<string, unknown>;

test('person search filters the Acme people by name or email', () => {
  const result = get('/api/chains/person/search?q=alice') as { people: { email: string }[] };
  assert.deepEqual(result.people.map((person) => person.email), ['alice.morgan@acme.example']);
  assert.equal((get('/api/chains/person/search?q=acme') as { people: unknown[] }).people.length, people.length);
});

test('the site cases come out of the same model', () => {
  assert.equal((get('/api/chains/person/coverage/detail?email=alice.morgan@acme.example') as { status: string }).status, 'gap');
  assert.equal((get('/api/chains/person/coverage/detail?email=bob.chen@acme.example') as { status: string }).status, 'partial');
  assert.equal((get('/api/chains/person/coverage/detail?email=eve.taylor@acme.example') as { status: string }).status, 'unknown');
  const old = (get('/api/cmdb/netskope/devices?q=ACME-INF-OLD') as { rows: { device_evidence: { state: string } }[] }).rows;
  assert.equal(old.length, 1);
  assert.notEqual(old[0].device_evidence.state, 'recent');
});

test('counters agree with the lists they summarise', () => {
  assert.equal((get('/api/safes') as { total: number }).total, safes.length);
  assert.equal((get('/api/accounts') as { total: number }).total, accounts.length);
  assert.equal((get('/api/summary') as { accounts: number }).accounts, accounts.length);
  assert.equal((get('/api/cmdb/netskope/metrics') as { devices_total: number }).devices_total, devices.length);
  assert.equal((get('/api/safes/1/accounts') as { total: number }).total, accounts.filter((account) => account.safeId === 1).length);
});

test('unknown routes and writes are delegated', () => {
  assert.equal(acmeResponse(new URL('https://demo.example/api/cmdb/netskope/alerts'), 'GET'), null);
  assert.equal(acmeResponse(new URL('https://demo.example/api/safes'), 'PUT'), null);
});

test('dates move together so the capture always looks recent', async () => {
  assert.deepEqual(shiftDates({ at: '2026-10-22T13:00:00Z', label: 'x' }, 3_600_000), { at: '2026-10-22T14:00:00.000Z', label: 'x' });
  const handle = withAcmeData(async () => ({ status: 404, contentType: 'application/json', body: '{}' }), () => Date.parse('2026-12-01T10:30:00Z'));
  const response = await handle({ url: 'https://demo.example/api/cmdb/netskope/sync-evidence', method: 'GET', body: null });
  assert.equal(JSON.parse(response.body).source_completed_at, '2026-12-01T08:00:00.000Z');
  assert.equal((await handle({ url: 'https://demo.example/api/nope', method: 'GET', body: null })).status, 404);
});
