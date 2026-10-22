// Modelo de inventario de la demo: observaciones externas, cambios explicados
// y revisión humana como capas separadas (PRODUCT.md, CONNECTORS.md). Es la
// referencia que el backend Go deberá reproducir contra el mismo fixture.
// Funciones puras sobre objetos serializables: nunca mutan el estado recibido.

export type Completeness = 'complete' | 'partial';
export type Attributes = Record<string, string>;

export interface Connection {
  id: string;
  name: string;
  connector: string;
  collections: string[];
}

export interface Observation {
  externalId: string;
  attributes: Attributes;
}

export interface Run {
  id: string;
  connection: string;
  collection: string;
  // Alcance/filtro de la extracción: sólo una completa del mismo alcance
  // puede respaldar una baja.
  scope: string;
  completeness: Completeness;
  observedAt: string;
  observations: Observation[];
}

export interface InventoryRecord {
  key: string;
  connection: string;
  collection: string;
  externalId: string;
  attributes: Attributes;
  status: 'active' | 'retired';
  firstRun: string;
  lastSeenRun: string;
  // Alcance de la última corrida que lo observó: sólo una completa de ese
  // mismo alcance puede retirarlo.
  scope: string;
  retiredByRun?: string;
}

export type ChangeKind = 'added' | 'changed' | 'retired';

export interface Change {
  id: string;
  run: string;
  record: string;
  connection: string;
  collection: string;
  externalId: string;
  kind: ChangeKind;
  fields: string[];
  before?: Attributes;
  after?: Attributes;
  completeness: Completeness;
  observedAt: string;
}

export interface RunSummary {
  id: string;
  connection: string;
  collection: string;
  scope: string;
  completeness: Completeness;
  observedAt: string;
  observed: number;
  added: number;
  changed: number;
  retired: number;
  // Activos que la corrida no devolvió y siguen vigentes (parcial, o una
  // completa que inicia línea base nueva).
  retained: number;
  // La corrida completa contra la que se compararon las bajas, o null si
  // esta corrida es la línea base.
  baseline: string | null;
}

export interface ReviewEvent {
  at: string;
  actor: string;
  field: 'owner' | 'note';
  before: string;
  after: string;
}

export interface Review {
  owner: string;
  note: string;
  history: ReviewEvent[];
}

export interface State {
  connections: Connection[];
  runs: RunSummary[];
  records: Record<string, InventoryRecord>;
  changes: Change[];
  reviews: Record<string, Review>;
  // Última corrida completa por conexión/colección: la línea base vigente.
  baselines: Record<string, { run: string; scope: string }>;
}

export class ModelError extends Error {}

export function recordKey(connection: string, collection: string, externalId: string): string {
  return `${connection}/${collection}/${externalId}`;
}

export function emptyState(connections: Connection[]): State {
  return { connections: structuredClone(connections), runs: [], records: {}, changes: [], reviews: {}, baselines: {} };
}

function differingFields(a: Attributes, b: Attributes): string[] {
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...names].filter(name => a[name] !== b[name]).sort();
}

// applyRun publica una corrida. Altas y cambios se registran desde la segunda
// corrida de una línea base: la primera observación no es un cambio. Una baja
// exige una corrida completa del mismo alcance que la línea base vigente; una
// parcial o un alcance nuevo nunca retiran nada.
export function applyRun(current: State, run: Run): State {
  const connection = current.connections.find(c => c.id === run.connection);
  if (!connection) throw new ModelError(`conexión desconocida: ${run.connection}`);
  if (!connection.collections.includes(run.collection)) throw new ModelError(`colección desconocida: ${run.collection}`);
  if (current.runs.some(r => r.id === run.id)) throw new ModelError(`corrida ya publicada: ${run.id}`);
  const seen = new Set<string>();
  for (const o of run.observations) {
    // Un ID repetido en la misma corrida impide afirmar qué se observó.
    if (seen.has(o.externalId)) throw new ModelError(`ID externo repetido en ${run.id}: ${o.externalId}`);
    seen.add(o.externalId);
  }

  const state = structuredClone(current);
  const lineKey = `${run.connection}/${run.collection}`;
  const baseline = state.baselines[lineKey];
  const comparable = baseline !== undefined && baseline.scope === run.scope;
  const summary: RunSummary = {
    id: run.id, connection: run.connection, collection: run.collection, scope: run.scope,
    completeness: run.completeness, observedAt: run.observedAt,
    observed: run.observations.length, added: 0, changed: 0, retired: 0, retained: 0,
    baseline: comparable ? baseline.run : null,
  };
  const change = (kind: ChangeKind, record: InventoryRecord, fields: string[], before?: Attributes, after?: Attributes) => {
    state.changes.push({
      id: `${run.id}:${record.externalId}`, run: run.id, record: record.key,
      connection: record.connection, collection: record.collection, externalId: record.externalId,
      kind, fields, before, after, completeness: run.completeness, observedAt: run.observedAt,
    });
    summary[kind]++;
  };

  for (const o of run.observations) {
    const key = recordKey(run.connection, run.collection, o.externalId);
    const existing = state.records[key];
    if (!existing || existing.status === 'retired') {
      const record: InventoryRecord = {
        key, connection: run.connection, collection: run.collection, externalId: o.externalId,
        attributes: { ...o.attributes }, status: 'active', firstRun: existing?.firstRun ?? run.id, lastSeenRun: run.id,
        scope: run.scope,
      };
      state.records[key] = record;
      if (comparable) change('added', record, [], undefined, { ...o.attributes });
      continue;
    }
    const fields = differingFields(existing.attributes, o.attributes);
    if (fields.length > 0) {
      const before = existing.attributes;
      existing.attributes = { ...o.attributes };
      if (comparable) change('changed', existing, fields, before, { ...o.attributes });
    }
    existing.lastSeenRun = run.id;
    existing.scope = run.scope;
  }

  for (const record of Object.values(state.records)) {
    if (record.connection !== run.connection || record.collection !== run.collection) continue;
    if (record.status !== 'active' || seen.has(record.externalId)) continue;
    if (run.completeness === 'complete' && comparable && record.scope === run.scope) {
      record.status = 'retired';
      record.retiredByRun = run.id;
      change('retired', record, [], record.attributes, undefined);
    } else {
      summary.retained++;
    }
  }

  if (run.completeness === 'complete') state.baselines[lineKey] = { run: run.id, scope: run.scope };
  state.runs.push(summary);
  return state;
}

// setReview registra una decisión humana sobre un registro. Vive aparte de
// las observaciones: ninguna corrida la modifica.
export function setReview(current: State, key: string, update: { owner?: string; note?: string }, actor: string, at: string): State {
  if (!current.records[key]) throw new ModelError(`registro desconocido: ${key}`);
  const state = structuredClone(current);
  const review = state.reviews[key] ?? { owner: '', note: '', history: [] };
  for (const field of ['owner', 'note'] as const) {
    const after = update[field];
    if (after === undefined || after === review[field]) continue;
    review.history.push({ at, actor, field, before: review[field], after });
    review[field] = after;
  }
  if (review.history.length > 0) state.reviews[key] = review;
  return state;
}
