import assert from 'node:assert/strict';
import test from 'node:test';
import { uciRiskChange, uciRiskChangeLabel, uciRiskLabel } from '../../../src/netskope/sse/lib/netskope-uci.ts';

const company = (users: number, poor: number, moderate: number, previous: { users: number; poor: number; moderate: number } | null) => ({ users, poor, moderate, previous });

test('the change is in percentage points of the at-risk share, and "Sin dato" without a snapshot', () => {
  assert.equal(uciRiskChangeLabel(uciRiskChange(company(200, 10, 30, { users: 200, poor: 5, moderate: 20 }))), '+7,5 pp');
  assert.equal(uciRiskChangeLabel(uciRiskChange(company(100, 5, 5, { users: 100, poor: 20, moderate: 0 }))), '−10 pp');
  assert.equal(uciRiskChangeLabel(uciRiskChange(company(100, 5, 5, { users: 100, poor: 10, moderate: 0 }))), 'Sin cambio');
  assert.equal(uciRiskChangeLabel(uciRiskChange(company(50, 0, 0, null))), 'Sin dato');
  assert.equal(uciRiskChangeLabel(uciRiskChange(company(50, 0, 0, { users: 0, poor: 0, moderate: 0 }))), 'Sin dato');
});

test('the share is a proportion over the users with an email', () => {
  assert.equal(uciRiskLabel({ users: 200, poor: 10, moderate: 30 }), '20 %');
  assert.equal(uciRiskLabel({ users: 0, poor: 0, moderate: 0 }), '0 %');
});
