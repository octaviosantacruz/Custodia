import { useEffect, useMemo, useRef, useState } from 'react';

import { strings, type Lang, type Strings } from './i18n.ts';
import type { Change, InventoryRecord, State } from './model/inventory.ts';
import { initialState, stateAt, type Scenario, type Step } from './model/scenario.ts';
import scenarioData from '../../fixtures/lab/scenario.json';

const scenario = scenarioData as unknown as Scenario;
const TOTAL = scenario.steps.length;

type Sim = 'ok' | 'loading' | 'empty' | 'offline' | 'forbidden' | 'error';
const SIMS: Sim[] = ['ok', 'loading', 'empty', 'offline', 'forbidden', 'error'];

type View = 'connections' | 'inventory' | 'changes';
const VIEWS: View[] = ['connections', 'inventory', 'changes'];

// Cada paso del guion lleva a la vista que lo explica; el visitante puede
// moverse libremente después.
function viewFor(step: Step): { view: View; record?: string } {
  const a = step.action;
  switch (a.type) {
    case 'view':
      return a.view === 'record' ? { view: 'inventory', record: a.record } : { view: 'connections' };
    case 'review':
      return { view: 'inventory', record: a.record };
    case 'sync':
      return { view: 'changes' };
    case 'reset':
      return { view: 'connections' };
  }
}

function readLang(): Lang {
  try {
    const saved = localStorage.getItem('custodia-demo-lang');
    if (saved === 'es' || saved === 'en') return saved;
  } catch {
    // Sin almacenamiento: se usa el idioma del navegador.
  }
  return navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en';
}

const dateFormat = (lang: Lang) =>
  new Intl.DateTimeFormat(lang === 'es' ? 'es' : 'en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });

export function App() {
  const [lang, setLang] = useState<Lang>(readLang);
  const [step, setStep] = useState(1);
  const [view, setView] = useState<View>('connections');
  const [selected, setSelected] = useState<string | null>(null);
  const [connection, setConnection] = useState('all');
  const [sim, setSim] = useState<Sim>('ok');
  const returnFocus = useRef<HTMLElement | null>(null);
  // Sólo una apertura hecha por la persona mueve el foco al detalle; el guion
  // no le saca el foco del botón que está usando.
  const [focusTick, setFocusTick] = useState(0);
  const t = strings[lang];

  const state = useMemo(() => stateAt(scenario, step), [step]);
  const current = scenario.steps[step - 1];

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem('custodia-demo-lang', lang);
    } catch {
      // El idioma sólo se recuerda si el navegador lo permite.
    }
  }, [lang]);

  const go = (next: number) => {
    const clamped = Math.min(TOTAL, Math.max(1, next));
    const target = viewFor(scenario.steps[clamped - 1]);
    setStep(clamped);
    setSim('ok');
    setView(target.view);
    setSelected(target.record ?? null);
    if (target.record) setConnection('all');
  };

  const open = (key: string, from: HTMLElement) => {
    returnFocus.current = from;
    setSelected(key);
    setFocusTick(n => n + 1);
  };
  const close = () => {
    setSelected(null);
    returnFocus.current?.focus();
  };

  const fmt = dateFormat(lang);

  return (
    <>
      <a className="skip" href="#main">
        {lang === 'es' ? 'Saltar al contenido' : 'Skip to content'}
      </a>
      <p className="banner" role="note">
        {t.banner}
      </p>
      <header className="top">
        <div className="brand">
          <h1>
            Custodia<span aria-hidden="true">_</span>
          </h1>
          <p>{t.subtitle}</p>
        </div>
        <div className="lang" role="group" aria-label={t.language}>
          {(['es', 'en'] as Lang[]).map(code => (
            <button key={code} type="button" aria-pressed={lang === code} onClick={() => setLang(code)}>
              {code.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <ScriptPanel t={t} lang={lang} step={step} current={current} onGo={go} sim={sim} onSim={setSim} />

      <nav className="tabs" aria-label={t.nav}>
        {VIEWS.map(v => (
          <button key={v} type="button" aria-current={view === v ? 'page' : undefined} onClick={() => setView(v)}>
            {t.views[v]}
          </button>
        ))}
      </nav>

      <div className={view === 'inventory' ? 'work with-detail' : 'work'}>
        <main id="main" tabIndex={-1}>
          {sim !== 'ok' && <SimState t={t} sim={sim} onRetry={() => setSim('ok')} />}
          {sim === 'ok' && view === 'connections' && <Connections t={t} state={state} fmt={fmt} />}
          {sim === 'ok' && view === 'inventory' && (
            <Inventory
              t={t}
              state={state}
              fmt={fmt}
              connection={connection}
              onConnection={setConnection}
              selected={selected}
              onOpen={open}
            />
          )}
          {sim === 'ok' && view === 'changes' && <Changes t={t} state={state} fmt={fmt} />}
        </main>
        {view === 'inventory' && sim === 'ok' && (
          <Detail t={t} state={state} fmt={fmt} recordKey={selected} focusTick={focusTick} onClose={close} />
        )}
      </div>
      <footer>{t.footer}</footer>
    </>
  );
}

function ScriptPanel({ t, lang, step, current, onGo, sim, onSim }: { t: Strings; lang: Lang; step: number; current: Step; onGo: (n: number) => void; sim: Sim; onSim: (s: Sim) => void }) {
  return (
    <section className="script" aria-labelledby="script-title">
      <div className="script-head">
        <h2 id="script-title">{t.script}</h2>
        <p className="mono" aria-live="polite">
          {t.stepOf(step, TOTAL)}
        </p>
      </div>
      <ol className="steps" aria-label={t.script}>
        {scenario.steps.map(s => (
          <li key={s.id}>
            <button type="button" aria-current={s.id === step ? 'step' : undefined} onClick={() => onGo(s.id)}>
              <span className="mono">{s.id}</span>
              <span className="step-title">{s.title[lang]}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="step-body" aria-live="polite">
        <h3>{t.whatHappens}</h3>
        <p>{t.steps[current.id]}</p>
      </div>
      <div className="controls">
        <button type="button" onClick={() => onGo(step - 1)} disabled={step === 1}>
          {t.prev}
        </button>
        <button type="button" className="primary" onClick={() => onGo(step + 1)} disabled={step === TOTAL}>
          {t.next}
        </button>
        <button type="button" onClick={() => onGo(1)} disabled={step === 1}>
          {t.reset}
        </button>
        <label className="field sim" htmlFor="sim-state">
          <span>{t.sim.label}</span>
          <select id="sim-state" value={sim} onChange={e => onSim(e.target.value as Sim)}>
            {SIMS.map(code => (
              <option key={code} value={code}>
                {t.sim[code]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted small">{t.sim.note}</p>
    </section>
  );
}

function Connections({ t, state, fmt }: { t: Strings; state: State; fmt: Intl.DateTimeFormat }) {
  return (
    <section aria-labelledby="h-connections">
      <h2 id="h-connections">{t.views.connections}</h2>
      <div className="scroll">
        <table>
          <caption className="sr">{t.views.connections}</caption>
          <thead>
            <tr>
              <th scope="col">{t.connections.name}</th>
              <th scope="col">{t.connections.connector}</th>
              <th scope="col">{t.connections.collections}</th>
              <th scope="col">{t.connections.lastComplete}</th>
              <th scope="col">{t.connections.lastRun}</th>
              <th scope="col" className="num">
                {t.connections.active}
              </th>
            </tr>
          </thead>
          <tbody>
            {state.connections.map(c => {
              const runs = state.runs.filter(r => r.connection === c.id);
              const last = runs.at(-1);
              const baseline = state.baselines[`${c.id}/${c.collections[0]}`];
              const complete = baseline ? runs.find(r => r.id === baseline.run) : undefined;
              const active = Object.values(state.records).filter(r => r.connection === c.id && r.status === 'active').length;
              return (
                <tr key={c.id}>
                  <th scope="row">{c.name}</th>
                  <td>
                    <span className="mono">{c.connector}</span> <Pill tone="muted">{t.connections.simulated}</Pill>
                  </td>
                  <td className="mono">{c.collections.join(', ')}</td>
                  <td>{complete ? fmt.format(new Date(complete.observedAt)) : t.connections.none}</td>
                  <td>{last ? <RunState t={t} completeness={last.completeness} id={last.id} /> : t.connections.none}</td>
                  <td className="num mono">{active}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SimState({ t, sim, onRetry }: { t: Strings; sim: Exclude<Sim, 'ok'>; onRetry: () => void }) {
  if (sim === 'loading') {
    return (
      <section className="state" aria-busy="true" role="status">
        <p>{t.sim.loadingText}</p>
        <div className="skeleton" aria-hidden="true" />
        <div className="skeleton" aria-hidden="true" />
        <div className="skeleton short" aria-hidden="true" />
      </section>
    );
  }
  const text = { empty: [t.sim.emptyTitle, t.sim.emptyText], offline: [t.sim.offlineTitle, t.sim.offlineText], forbidden: [t.sim.forbiddenTitle, t.sim.forbiddenText], error: [t.sim.errorTitle, t.sim.errorText] }[sim];
  const mark = { empty: '○', offline: '⚠', forbidden: '⊘', error: '✕' }[sim];
  return (
    <section className={`state ${sim}`} role={sim === 'error' || sim === 'offline' ? 'alert' : 'status'}>
      <h2>
        <span aria-hidden="true">{mark} </span>
        {text[0]}
      </h2>
      <p>{text[1]}</p>
      {sim === 'error' && (
        <div>
          <button type="button" className="primary" onClick={onRetry}>
            {t.sim.retry}
          </button>
        </div>
      )}
    </section>
  );
}

function RunState({ t, completeness, id }: { t: Strings; completeness: 'complete' | 'partial'; id: string }) {
  return (
    <>
      <span className="mono">{id}</span> <Pill tone={completeness === 'complete' ? 'ok' : 'warn'}>{(completeness === 'complete' ? '✓ ' : '◐ ') + t.completeness[completeness]}</Pill>
    </>
  );
}

function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'info' | 'muted'; children: React.ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

function Inventory(props: {
  t: Strings;
  state: State;
  fmt: Intl.DateTimeFormat;
  connection: string;
  onConnection: (c: string) => void;
  selected: string | null;
  onOpen: (key: string, from: HTMLElement) => void;
}) {
  const { t, state, connection, onConnection, selected, onOpen } = props;
  const rows = Object.values(state.records)
    .filter(r => connection === 'all' || r.connection === connection)
    .sort((a, b) => a.connection.localeCompare(b.connection) || a.externalId.localeCompare(b.externalId));
  const name = (id: string) => state.connections.find(c => c.id === id)?.name ?? id;
  return (
    <section aria-labelledby="h-inventory">
      <div className="section-head">
        <h2 id="h-inventory">{t.views.inventory}</h2>
        <label className="field" htmlFor="connection-filter">
          <span>{t.inventory.filter}</span>
          <select id="connection-filter" value={connection} onChange={e => onConnection(e.target.value)}>
            <option value="all">{t.inventory.all}</option>
            {state.connections.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="scroll">
        <table>
          <caption className="sr">{t.inventory.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t.connections.name}</th>
              <th scope="col">{t.inventory.id}</th>
              <th scope="col">{t.inventory.name}</th>
              <th scope="col">{t.inventory.type}</th>
              <th scope="col">{t.inventory.environment}</th>
              <th scope="col">{t.inventory.status}</th>
              <th scope="col">{t.inventory.owner}</th>
              <th scope="col">{t.inventory.lastSeen}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const review = state.reviews[r.key];
              return (
                <tr key={r.key} aria-selected={selected === r.key}>
                  <td>{name(r.connection)}</td>
                  <th scope="row">
                    <button type="button" className="link mono" aria-label={`${t.inventory.rowHint}: ${name(r.connection)} ${r.externalId}`} onClick={e => onOpen(r.key, e.currentTarget)}>
                      {r.externalId}
                    </button>
                  </th>
                  <td className="mono">{r.attributes.name}</td>
                  <td>{r.attributes.type}</td>
                  <td>{r.attributes.environment}</td>
                  <td>
                    <Pill tone={r.status === 'active' ? 'ok' : 'bad'}>{(r.status === 'active' ? '● ' : '○ ') + t.status[r.status]}</Pill>
                  </td>
                  <td>{review?.owner || <span className="muted">{t.inventory.noOwner}</span>}</td>
                  <td className="mono">{r.lastSeenRun}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="empty">{t.inventory.empty}</p>}
      </div>
    </section>
  );
}

function changeDetail(t: Strings, c: Change): string {
  if (c.kind === 'changed') {
    return c.fields.map(f => `${f}: ${c.before?.[f] ?? t.detail.empty_value} → ${c.after?.[f] ?? t.detail.empty_value}`).join(', ');
  }
  const attrs = c.kind === 'added' ? c.after : c.before;
  return attrs ? `${attrs.name} · ${attrs.type}` : '';
}

const KIND_TONE = { added: 'ok', changed: 'info', retired: 'bad' } as const;
const KIND_MARK = { added: '+ ', changed: '~ ', retired: '− ' } as const;

function Changes({ t, state, fmt }: { t: Strings; state: State; fmt: Intl.DateTimeFormat }) {
  const name = (id: string) => state.connections.find(c => c.id === id)?.name ?? id;
  const partial = state.runs.filter(r => r.completeness === 'partial' && r.retained > 0 && r.baseline).at(-1);
  const changes = [...state.changes].reverse();
  return (
    <section aria-labelledby="h-changes">
      <h2 id="h-changes">{t.views.changes}</h2>
      {partial && <p className="note">{t.changes.partialNote(partial.retained, partial.baseline!)}</p>}
      <div className="scroll">
        <table>
          <caption className="sr">{t.changes.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t.changes.kind}</th>
              <th scope="col">{t.changes.record}</th>
              <th scope="col">{t.changes.fields}</th>
              <th scope="col">{t.changes.run}</th>
              <th scope="col">{t.changes.completeness}</th>
            </tr>
          </thead>
          <tbody>
            {changes.map(c => (
              <tr key={c.id}>
                <td>
                  <Pill tone={KIND_TONE[c.kind]}>{KIND_MARK[c.kind] + t.kinds[c.kind]}</Pill>
                </td>
                <th scope="row">
                  {name(c.connection)} · <span className="mono">{c.externalId}</span>
                </th>
                <td className="mono">{changeDetail(t, c)}</td>
                <td>
                  <span className="mono">{c.run}</span>
                  <br />
                  <span className="muted">{fmt.format(new Date(c.observedAt))}</span>
                </td>
                <td>
                  <Pill tone={c.completeness === 'complete' ? 'ok' : 'warn'}>{(c.completeness === 'complete' ? '✓ ' : '◐ ') + t.completeness[c.completeness]}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {changes.length === 0 && <p className="empty">{t.changes.empty}</p>}
      </div>

      <h3 className="sub">{t.changes.runs}</h3>
      <div className="scroll">
        <table>
          <caption className="sr">{t.changes.runsCaption}</caption>
          <thead>
            <tr>
              <th scope="col">{t.changes.run}</th>
              <th scope="col">{t.connections.name}</th>
              <th scope="col">{t.changes.completeness}</th>
              <th scope="col">{t.changes.scope}</th>
              <th scope="col" className="num">
                {t.changes.observed}
              </th>
              <th scope="col" className="num">
                {t.changes.retained}
              </th>
              <th scope="col">{t.changes.baseline}</th>
            </tr>
          </thead>
          <tbody>
            {[...state.runs].reverse().map(r => (
              <tr key={r.id}>
                <th scope="row" className="mono">
                  {r.id}
                </th>
                <td>{name(r.connection)}</td>
                <td>
                  <Pill tone={r.completeness === 'complete' ? 'ok' : 'warn'}>{(r.completeness === 'complete' ? '✓ ' : '◐ ') + t.completeness[r.completeness]}</Pill>
                </td>
                <td className="mono">{r.scope}</td>
                <td className="num mono">{r.observed}</td>
                <td className="num mono">{r.retained}</td>
                <td className="mono">{r.baseline ?? t.changes.baselineNone}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Detail({ t, state, fmt, recordKey, focusTick, onClose }: { t: Strings; state: State; fmt: Intl.DateTimeFormat; recordKey: string | null; focusTick: number; onClose: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusTick > 0) heading.current?.focus();
  }, [focusTick]);
  const record: InventoryRecord | undefined = recordKey ? state.records[recordKey] : undefined;
  if (!record) {
    return (
      <aside className="detail" aria-label={t.detail.title}>
        <h2>{t.detail.title}</h2>
        <p className="muted">{t.detail.empty}</p>
      </aside>
    );
  }
  const review = state.reviews[record.key];
  const connection = state.connections.find(c => c.id === record.connection);
  const run = state.runs.find(r => r.id === record.lastSeenRun);
  const changes = state.changes.filter(c => c.record === record.key);
  return (
    <aside className="detail" aria-label={t.detail.title} onKeyDown={e => e.key === 'Escape' && onClose()}>
      <div className="detail-head">
        <h2 ref={heading} tabIndex={-1}>
          {connection?.name} · <span className="mono">{record.externalId}</span>
        </h2>
        <button type="button" onClick={onClose}>
          {t.detail.close}
        </button>
      </div>

      <h3>{t.detail.evidence}</h3>
      <dl>
        <dt>{t.detail.source}</dt>
        <dd>
          {connection?.name} · <span className="mono">{connection?.connector}</span> <Pill tone="muted">{t.connections.simulated}</Pill>
        </dd>
        <dt>{t.detail.firstRun}</dt>
        <dd className="mono">{record.firstRun}</dd>
        <dt>{t.detail.lastSeen}</dt>
        <dd>
          <span className="mono">{record.lastSeenRun}</span>
          {run && <span className="muted"> · {fmt.format(new Date(run.observedAt))}</span>}
        </dd>
        {record.retiredByRun && (
          <>
            <dt>{t.detail.retiredBy}</dt>
            <dd className="mono">{record.retiredByRun}</dd>
          </>
        )}
        {Object.entries(record.attributes).map(([k, v]) => (
          <div className="pair" key={k}>
            <dt className="mono">{k}</dt>
            <dd className="mono">{v}</dd>
          </div>
        ))}
      </dl>

      <h3>{t.detail.review}</h3>
      <p className="muted">{t.detail.reviewNote}</p>
      <dl>
        <dt>{t.detail.owner}</dt>
        <dd>{review?.owner || <span className="muted">{t.inventory.noOwner}</span>}</dd>
        <dt>{t.detail.note}</dt>
        <dd>{review?.note || <span className="muted">—</span>}</dd>
      </dl>
      <h4>{t.detail.historyTitle}</h4>
      {review && review.history.length > 0 ? (
        <ul className="history">
          {review.history.map((e, i) => (
            <li key={i}>
              <span className="mono">{fmt.format(new Date(e.at))}</span> · {t.detail.by} <span className="mono">{e.actor}</span> · {e.field === 'owner' ? t.detail.owner : t.detail.note}: {e.before || t.detail.empty_value} → {e.after}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{t.detail.noHistory}</p>
      )}

      <h3>{t.detail.history}</h3>
      {changes.length > 0 ? (
        <ul className="history">
          {changes.map(c => (
            <li key={c.id}>
              <Pill tone={KIND_TONE[c.kind]}>{KIND_MARK[c.kind] + t.kinds[c.kind]}</Pill> <span className="mono">{c.run}</span> · {t.completeness[c.completeness]}
              {c.kind === 'changed' && <span className="mono"> · {changeDetail(t, c)}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{t.detail.noChanges}</p>
      )}
    </aside>
  );
}

// Para pruebas: el estado inicial del guion.
export const initial = () => initialState(scenario);
