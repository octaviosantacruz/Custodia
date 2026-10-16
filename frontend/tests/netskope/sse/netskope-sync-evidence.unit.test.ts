import assert from 'node:assert/strict';
import test from 'node:test';
import { netskopeSyncStatement } from '../../../src/netskope/sse/lib/netskope-sync-evidence.ts';

const evidence = (overrides: Partial<{ source_fresh: boolean; source_status: string | null; source_completed_at: string | null }>) => ({
  source_fresh: false, source_status: null, source_completed_at: null, as_of: '2026-10-05T12:00:00Z', ...overrides,
});

test('NSK-HB-001: a complete recent sync is the only state that allows an evaluation', () => {
  const fresh = netskopeSyncStatement(evidence({ source_fresh: true, source_status: 'completed', source_completed_at: new Date(Date.now() - 3_600_000).toISOString() }));
  assert.equal(fresh.fresh, true);
  assert.match(fresh.text, /^Sincronizado hace /);
});

test('NSK-HB-001: every other sync state says why the evaluation is unavailable', () => {
  const cases: Array<[string | null, RegExp]> = [
    ['completed', /el último sync completo tiene más de 24 h/],
    ['partial', /la última corrida quedó parcial/],
    ['failed', /la última corrida falló/],
    ['running', /hay una corrida en curso/],
    ['queued', /hay una corrida en espera/],
    ['cancelled', /terminó como «cancelled»/],
    [null, /no hay corridas de Netskope registradas/],
  ];
  for (const [status, expected] of cases) {
    const statement = netskopeSyncStatement(evidence({ source_status: status }));
    assert.equal(statement.fresh, false, String(status));
    assert.match(statement.text, /^Sin sync vigente: /);
    assert.match(statement.text, expected);
  }
  assert.equal(netskopeSyncStatement(null).fresh, false);
  assert.equal(netskopeSyncStatement(undefined).fresh, false);
});
