import assert from 'node:assert/strict';
import test from 'node:test';
import { netskopeDlpFreshness, netskopeDlpQueryString, netskopeDlpTrend } from '../../../src/netskope/sse/lib/netskope-dlp.ts';

test('the drill query only carries the policy name and pagination', () => {
  const params = new URLSearchParams(netskopeDlpQueryString({ policy: 'Policy A' }, 0));
  assert.deepEqual([...params.keys()].sort(), ['limit', 'offset', 'policy']);
  assert.equal(params.get('limit'), '5');
  assert.equal(params.get('policy'), 'Policy A');
  assert.deepEqual([...new URLSearchParams(netskopeDlpQueryString({ policy: '' }, 0, 3)).keys()].sort(), ['limit', 'offset']);
});

test('the 7-day trend never divides by a zero base', () => {
  assert.deepEqual(netskopeDlpTrend(3, 1), { direction: 'up', label: '+200%' });
  assert.deepEqual(netskopeDlpTrend(0, 2), { direction: 'down', label: '−100%' });
  assert.deepEqual(netskopeDlpTrend(2, 2), { direction: 'flat', label: 'Igual' });
  assert.deepEqual(netskopeDlpTrend(4, 0), { direction: 'new', label: 'Nueva' });
  assert.deepEqual(netskopeDlpTrend(0, 0), { direction: 'flat', label: 'Sin actividad' });
});

test('freshness never presents missing capture as zero', () => {
  const unconfigured = netskopeDlpFreshness({ configured: false, captured_at: null, partial: null });
  assert.equal(unconfigured.tone, 'off');
  assert.match(unconfigured.detail, /no hay alertas que mostrar todavía/);

  const pending = netskopeDlpFreshness({ configured: true, captured_at: null, partial: null });
  assert.equal(pending.tone, 'attention');
  assert.match(pending.detail, /no se presenta como cero/);

  const partial = netskopeDlpFreshness({ configured: true, captured_at: '2026-09-25T00:00:00Z', partial: true });
  assert.equal(partial.tone, 'attention');
  assert.match(partial.detail, /incompletos/);

  const now = Date.parse('2026-09-25T10:00:00Z');
  const fresh = netskopeDlpFreshness({ configured: true, captured_at: '2026-09-25T00:00:00Z', partial: false }, null, now);
  assert.equal(fresh.tone, 'ok');
  assert.equal(fresh.label, 'Captura completa');
});

test('FE-AUD-004: a complete but old capture is flagged and never reads as up to date', () => {
  const now = Date.parse('2026-09-27T00:00:01Z');
  const old = netskopeDlpFreshness({ configured: true, captured_at: '2026-09-25T00:00:00Z', partial: false }, null, now);
  assert.equal(old.tone, 'attention');
  assert.equal(old.label, 'Captura completa');
  assert.match(old.detail, /más de 24 horas/);
  assert.notEqual(old.label, 'Captura al día');
});
