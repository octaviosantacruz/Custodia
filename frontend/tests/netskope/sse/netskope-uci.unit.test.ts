import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterUciRows, uciDelta, uciDeltaLabel, uciDeltaTone, uciIsTruncated, uciUserLabel,
} from '../../../src/netskope/sse/lib/netskope-uci.ts';
import type { NetskopeUciRow } from '../../../src/netskope/sse/types/netskope.ts';

const row = (over: Partial<NetskopeUciRow>): NetskopeUciRow => ({
  email: 'ana@example.test', user_id: null, name: null, rating: 'Poor', score: 200, previous_score: null,
  scored_at: '2026-10-04T00:00:00Z', ...over,
});

test('NSK-UBA-002 the delta is null without a previous reading and never shown as zero', () => {
  assert.equal(uciDelta(row({ previous_score: null })), null);
  assert.equal(uciDeltaLabel(null), 'Sin dato');
  assert.equal(uciDeltaTone(null), 'unknown');
  assert.equal(uciDelta(row({ score: 150, previous_score: 400 })), -250);
  assert.equal(uciDeltaLabel(-250), 'Empeora −250');
  assert.equal(uciDeltaTone(-250), 'down');
  assert.equal(uciDeltaLabel(120), 'Mejora +120');
  assert.equal(uciDeltaTone(120), 'up');
  assert.equal(uciDeltaLabel(0), 'Sin cambio');
  assert.equal(uciDeltaTone(0), 'flat');
});

test('NSK-UBA-002 filters by rating and by name or email, case-insensitively', () => {
  const rows = [
    row({ email: 'a@x.test', name: 'Ana Pérez', rating: 'Poor' }),
    row({ email: 'b@x.test', name: null, rating: 'Moderate' }),
  ];
  assert.equal(filterUciRows(rows, '', '').length, 2);
  assert.deepEqual(filterUciRows(rows, 'Moderate', '').map((r) => r.email), ['b@x.test']);
  assert.deepEqual(filterUciRows(rows, '', ' ANA ').map((r) => r.email), ['a@x.test']);
  assert.deepEqual(filterUciRows(rows, '', 'B@X').map((r) => r.email), ['b@x.test']);
  assert.equal(filterUciRows(rows, 'Poor', 'b@x').length, 0);
});

test('NSK-UBA-002 labels the user by name or falls back to the email', () => {
  assert.equal(uciUserLabel(row({ name: 'Ana', email: 'a@x.test' })), 'Ana');
  assert.equal(uciUserLabel(row({ name: null, email: 'a@x.test' })), 'a@x.test');
});

test('NSK-UBA-002 reports when the returned page omits rated users', () => {
  assert.equal(uciIsTruncated(600, 500), true);
  assert.equal(uciIsTruncated(284, 284), false);
});
