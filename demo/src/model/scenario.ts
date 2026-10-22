// El guion del laboratorio como datos: pasos con su acción y lo que se espera
// después de cada uno. La demo lo reproduce; los tests lo comprueban.
import { applyRun, emptyState, ModelError, setReview, type Connection, type Run, type State } from './inventory.ts';

export type Localized = { es: string; en: string };

export type Action =
  | { type: 'view'; view: string; record?: string }
  | { type: 'review'; record: string; owner?: string; note?: string; actor: string; at: string }
  | { type: 'sync'; run: string }
  | { type: 'reset' };

export interface Step {
  id: number;
  title: Localized;
  action: Action;
  expect: Record<string, unknown>;
}

export interface Scenario {
  about: string;
  version: number;
  connections: Connection[];
  runs: Run[];
  initialRuns: string[];
  steps: Step[];
}

function findRun(scenario: Scenario, id: string): Run {
  const run = scenario.runs.find(r => r.id === id);
  if (!run) throw new ModelError(`corrida inexistente en el escenario: ${id}`);
  return run;
}

// initialState es el fixture de partida; reiniciar vuelve exactamente a él.
export function initialState(scenario: Scenario): State {
  return scenario.initialRuns.reduce((state, id) => applyRun(state, findRun(scenario, id)), emptyState(scenario.connections));
}

export function applyAction(scenario: Scenario, state: State, action: Action): State {
  switch (action.type) {
    case 'view':
      return state;
    case 'review':
      return setReview(state, action.record, { owner: action.owner, note: action.note }, action.actor, action.at);
    case 'sync':
      return applyRun(state, findRun(scenario, action.run));
    case 'reset':
      return initialState(scenario);
  }
}

// stateAt reproduce el guion hasta el paso indicado (1 = primer paso). Volver
// atrás es volver a reproducir: el resultado depende sólo del guion.
export function stateAt(scenario: Scenario, step: number): State {
  if (!Number.isInteger(step) || step < 1 || step > scenario.steps.length) throw new ModelError(`paso fuera del guion: ${step}`);
  return scenario.steps.slice(0, step).reduce((state, s) => applyAction(scenario, state, s.action), initialState(scenario));
}
