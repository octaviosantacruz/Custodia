// El guion determinista (DESIGN.md) contra lo esperado en el fixture, y las
// reglas del contrato que el guion no recorre. Corre con `node --test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { applyRun, emptyState, ModelError, setReview, type Run, type State } from './inventory.ts';
import { initialState, stateAt, type Scenario } from './scenario.ts';

const scenario: Scenario = JSON.parse(readFileSync(new URL('../../../fixtures/lab/scenario.json', import.meta.url), 'utf8'));

type Expect = {
  inventory?: Record<string, Record<string, string>>;
  records?: Record<string, Record<string, unknown>>;
  changes?: { run: string; kind: string; record: string; fields?: string[] }[];
  reviews?: Record<string, { owner: string; note: string; events: number }>;
  run?: Record<string, unknown>;
  equalsStep?: number;
};

function inventory(state: State): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const r of Object.values(state.records)) {
    (out[r.connection] ??= {})[r.externalId] = r.status;
  }
  return out;
}

for (const step of scenario.steps) {
  test(`paso ${step.id}: ${step.title.es}`, () => {
    const before = step.id > 1 ? stateAt(scenario, step.id - 1) : initialState(scenario);
    const after = stateAt(scenario, step.id);
    const expect = step.expect as Expect;

    if (expect.equalsStep !== undefined) {
      assert.deepEqual(after, stateAt(scenario, expect.equalsStep));
      return;
    }
    if (expect.inventory) assert.deepEqual(inventory(after), expect.inventory);
    for (const [key, fields] of Object.entries(expect.records ?? {})) {
      const record = after.records[key];
      assert.ok(record, `falta ${key}`);
      for (const [name, value] of Object.entries(fields)) {
        assert.deepEqual((record as unknown as Record<string, unknown>)[name], value, `${key}.${name}`);
      }
    }
    if (expect.changes) {
      const produced = after.changes.slice(before.changes.length).map(c => ({
        run: c.run, kind: c.kind, record: c.record, ...(c.kind === 'changed' ? { fields: c.fields } : {}),
      }));
      assert.deepEqual(produced, expect.changes);
    }
    if (expect.reviews) {
      const reviews = Object.fromEntries(Object.entries(after.reviews).map(([key, r]) => [key, { owner: r.owner, note: r.note, events: r.history.length }]));
      assert.deepEqual(reviews, expect.reviews);
    }
    if (expect.run) {
      const summary = after.runs.find(r => r.id === expect.run!.id);
      assert.ok(summary, `falta la corrida ${expect.run.id}`);
      for (const [name, value] of Object.entries(expect.run)) {
        assert.deepEqual((summary as unknown as Record<string, unknown>)[name], value, `corrida.${name}`);
      }
    }
  });
}

test('Sur no cambia en ningún paso: el mismo ID externo en otra conexión es otro registro', () => {
  const sur = (s: State) => Object.values(s.records).filter(r => r.connection === 'sur');
  const start = sur(initialState(scenario));
  for (const step of scenario.steps) {
    assert.deepEqual(sur(stateAt(scenario, step.id)), start, `paso ${step.id}`);
  }
  assert.notEqual(stateAt(scenario, 6).records['norte/resources/r-17'].attributes.name, start[0].attributes.name);
});

test('la decisión humana sobrevive a cambios, parciales y bajas de otros registros', () => {
  const decided = stateAt(scenario, 3).reviews['norte/resources/r-17'];
  for (const step of [4, 5, 6]) {
    assert.deepEqual(stateAt(scenario, step).reviews['norte/resources/r-17'], decided, `paso ${step}`);
  }
  assert.deepEqual(decided.history.map(e => e.field), ['owner', 'note']);
});

test('reiniciar recupera exactamente el fixture inicial', () => {
  assert.deepEqual(stateAt(scenario, scenario.steps.length), initialState(scenario));
  assert.deepEqual(stateAt(scenario, 1), initialState(scenario));
});

test('el modelo no muta el estado que recibe', () => {
  const base = initialState(scenario);
  const snapshot = structuredClone(base);
  applyRun(base, scenario.runs.find(r => r.id === 'norte-2')!);
  setReview(base, 'norte/resources/r-17', { owner: 'X' }, 'a', '2026-03-02T00:00:00Z');
  assert.deepEqual(base, snapshot);
});

const lab = scenario.connections;
const run = (id: string, completeness: Run['completeness'], ids: string[], scope = 'all'): Run => ({
  id, connection: 'norte', collection: 'resources', scope, completeness, observedAt: '2026-03-01T00:00:00Z',
  observations: ids.map(externalId => ({ externalId, attributes: { name: externalId } })),
});

test('una completa con alcance distinto inicia línea base nueva y no retira', () => {
  let s = applyRun(emptyState(lab), run('a', 'complete', ['x', 'y']));
  s = applyRun(s, run('b', 'complete', ['x'], 'only-x'));
  assert.equal(s.records['norte/resources/y'].status, 'active');
  const summary = s.runs.at(-1)!;
  assert.equal(summary.baseline, null);
  assert.equal(summary.retained, 1);
  // Desde ahí la nueva línea base sí respalda bajas de su propio alcance.
  s = applyRun(s, run('c', 'complete', [], 'only-x'));
  assert.equal(s.records['norte/resources/x'].status, 'retired');
  assert.equal(s.records['norte/resources/y'].status, 'active', 'y nunca estuvo en el alcance only-x');
});

test('un registro retirado que reaparece vuelve como alta y conserva su primera corrida', () => {
  let s = applyRun(emptyState(lab), run('a', 'complete', ['x']));
  s = applyRun(s, run('b', 'complete', []));
  s = applyRun(s, run('c', 'complete', ['x']));
  const x = s.records['norte/resources/x'];
  assert.deepEqual([x.status, x.firstRun, x.retiredByRun], ['active', 'a', undefined]);
  assert.deepEqual(s.changes.map(c => `${c.run}:${c.kind}`), ['b:retired', 'c:added']);
});

test('la primera corrida es línea base: observa sin registrar altas', () => {
  const s = applyRun(emptyState(lab), run('a', 'partial', ['x']));
  assert.equal(s.changes.length, 0);
  assert.equal(s.records['norte/resources/x'].status, 'active');
  assert.deepEqual(s.baselines, {}, 'una parcial no fija línea base');
});

test('rechaza corridas que no se pueden interpretar, sin cambiar nada', () => {
  const base = initialState(scenario);
  assert.throws(() => applyRun(base, { ...run('d', 'complete', ['x']), observations: [{ externalId: 'x', attributes: {} }, { externalId: 'x', attributes: {} }] }), ModelError);
  assert.throws(() => applyRun(base, { ...run('e', 'complete', []), connection: 'oeste' }), ModelError);
  assert.throws(() => applyRun(base, { ...run('f', 'complete', []), collection: 'users' }), ModelError);
  assert.throws(() => applyRun(base, run('norte-1', 'complete', [])), ModelError);
  assert.throws(() => setReview(base, 'norte/resources/r-99', { owner: 'X' }, 'a', 't'), ModelError);
  assert.throws(() => stateAt(scenario, 0), ModelError);
  assert.throws(() => stateAt(scenario, scenario.steps.length + 1), ModelError);
});

test('una revisión sin cambios no deja historial', () => {
  const s = setReview(initialState(scenario), 'norte/resources/r-17', { owner: '' }, 'a', 't');
  assert.deepEqual(s.reviews, {});
});

test('una parcial actualiza lo que sí observó y lo marca como parcial', () => {
  let s = applyRun(emptyState(lab), run('a', 'complete', ['x', 'y']));
  s = applyRun(s, { ...run('b', 'partial', ['x']), observations: [{ externalId: 'x', attributes: { name: 'x2' } }] });
  assert.deepEqual(s.changes.map(c => [c.kind, c.externalId, c.completeness, c.fields]), [['changed', 'x', 'partial', ['name']]]);
  assert.equal(s.records['norte/resources/y'].status, 'active');
  assert.equal(s.baselines['norte/resources'].run, 'a', 'una parcial no reemplaza la línea base');
});
