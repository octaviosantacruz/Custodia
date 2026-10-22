import { people } from '../model/company.ts';
import { ago, personView, sourceRun, SOURCE_ORDER, SOURCES, type SourceKey } from '../model/view.ts';
import { Seal, Verdict } from '../ui/identity.tsx';
import { Link, useApp } from '../ui/router.tsx';
import { Shell } from '../ui/shell.tsx';

type View = ReturnType<typeof personView>;
type Node = { label: string; sub: string; faint?: boolean };
type Group = { source: SourceKey; join: 'matched' | 'ambiguous' | 'unmatched'; joinLabel: string; records: Node[] };

function groups(view: View): Group[] {
  const { person } = view;
  return [
    {
      // CyberArk: identidades (módulo Identity) y Safes (módulo PAM) de la misma fuente.
      source: 'pam', join: view.identity.status === 'ambiguous' ? 'ambiguous' : 'matched',
      joinLabel: view.identity.status === 'ambiguous' ? `${person.identityIds.length} candidatos, sin unir` : 'correo exacto',
      records: [
        ...person.identityIds.map(id => ({ label: `acme-identity-${id}`, sub: 'Identity · identidad activa' })),
        ...view.safes.map(safe => ({ label: safe.name, sub: `PAM · ${safe.accounts.length} ${safe.accounts.length === 1 ? 'cuenta' : 'cuentas'}` })),
      ],
    },
    {
      source: 'sse', join: 'matched', joinLabel: 'correo exacto',
      records: view.devices.length === 0
        ? [{ label: 'ningún equipo', sub: 'no observado en la captura', faint: true }]
        : view.devices.map(device => ({ label: device.hostname, sub: device.recent ? `señal ${ago(device.lastSignalAt)}` : `sin señal · ${ago(device.lastSignalAt)}`, faint: !device.recent })),
    },
  ];
}

/** La trama: persona → fuentes → registros. Color = fuente; trazo = cómo se unió. */
function Trama({ view }: { view: View }) {
  const ROW = 54, GAP = 22, TOP = 18;
  const list = groups(view);
  let y = TOP;
  const placed = list.map(group => {
    const slots = Math.max(group.records.length, 1);
    const start = y;
    y += slots * ROW + GAP;
    return { ...group, y: start + (slots * ROW) / 2 - ROW / 2 + 20, recordY: group.records.map((_, i) => start + i * ROW + 20) };
  });
  const height = y - GAP + TOP;
  const personY = height / 2;
  const P = 70, S = 316, R = 540, SW = 212;
  const curve = (x1: number, y1: number, x2: number, y2: number) => `M${x1} ${y1} C${(x1 + x2) / 2} ${y1} ${(x1 + x2) / 2} ${y2} ${x2} ${y2}`;
  const description = list.map(g => `${SOURCES[g.source].kind}: ${g.joinLabel}, ${g.records.length} registros`).join('; ');

  return (
    <svg className="trama" viewBox={`0 0 760 ${height}`} role="img" aria-label={`Trama de ${view.person.name}. ${description}.`}>
      {placed.map(g => (
        <g key={g.source} data-src={g.source} className={`trama-group is-${g.join}`}>
          <path className="trama-edge is-join" d={curve(P + 34, personY, S - SW / 2, g.y)} />
          {g.recordY.map((ry, i) => (
            <path key={i} className={`trama-edge is-record${g.records[i].faint ? ' is-faint' : ''}`} d={curve(S + SW / 2, g.y, R, ry)} />
          ))}
          <rect className="trama-source" x={S - SW / 2} y={g.y - 20} width={SW} height={40} rx={8} />
          <text className="trama-mono" x={S - SW / 2 + 14} y={g.y + 4}>{SOURCES[g.source].mono}</text>
          <text className="trama-source-label" x={S - SW / 2 + 42} y={g.y + 4}>{SOURCES[g.source].product}</text>
          <text className="trama-join" x={S} y={g.y + 36} textAnchor="middle">{g.joinLabel}</text>
          {g.records.map((record, i) => (
            <g key={record.label} className={`trama-record${record.faint ? ' is-faint' : ''}`}>
              <rect x={R} y={g.recordY[i] - 19} width={210} height={38} rx={6} />
              <text className="trama-record-label" x={R + 12} y={g.recordY[i] - 3}>{record.label}</text>
              <text className="trama-record-sub" x={R + 12} y={g.recordY[i] + 12}>{record.sub}</text>
            </g>
          ))}
        </g>
      ))}
      <g className="trama-person">
        <circle cx={P} cy={personY} r={34} />
        <text x={P} y={personY + 6} textAnchor="middle">{view.person.name.split(' ').map(w => w[0]).join('')}</text>
      </g>
    </svg>
  );
}

export function Person({ id }: { id: number }) {
  const { mode } = useApp();
  const person = people.find(p => p.id === id);
  if (!person) {
    return <Shell title="Persona no encontrada"><p><Link to="/personas">Volver a Personas</Link></p></Shell>;
  }
  const view = personView(person, mode);
  const c = view.coverage;
  const run = sourceRun('sse', mode);

  return (
    <Shell
      title={person.name}
      lede={`${person.area} · ${person.site}`}
    >
      <p className="data muted person-email">{person.email}</p>
      <div className="person-layout">
        <section className="card" aria-labelledby="trama-title">
          <header className="card-head">
            <h2 id="trama-title">Trama</h2>
            <p className="muted">Cómo se une esta persona en cada fuente.</p>
          </header>
          <Trama view={view} />
          <ul className="trama-legend">
            <li><svg width="28" height="8" aria-hidden="true"><path d="M0 4h28" className="legend-solid" /></svg> unión por correo exacto</li>
            <li><svg width="28" height="8" aria-hidden="true"><path d="M0 4h28" className="legend-dashed" /></svg> ambiguo: no se une solo</li>
            <li><svg width="28" height="8" aria-hidden="true"><path d="M0 4h28" className="legend-dotted" /></svg> sin registro o sin señal</li>
          </ul>
        </section>

        <aside className="card verdict-card" data-verdict={c.status} aria-labelledby="verdict-title">
          <p className="label">Cobertura de cliente</p>
          <h2 id="verdict-title"><Verdict status={c.status} /></h2>
          <p>{c.explanation}</p>
          <dl className="facts">
            <div><dt>Regla</dt><dd className="data">{c.metric_code} v{c.metric_version}</dd></div>
            <div><dt>Equipos con señal en 7 días</dt><dd className="data">{c.devices_recent} de {c.devices_total}</dd></div>
            <div><dt>Identidades activas</dt><dd className="data">{c.identity_records}</dd></div>
            <div><dt>Corrida de {SOURCES.sse.product}</dt><dd className="data">{run.run_id}</dd></div>
            <div><dt>Estado de la captura</dt><dd>{run.freshness === 'fresh' ? 'completa y vigente' : run.freshness === 'stale' ? `desactualizada (${run.age_hours} h)` : 'parcial'}</dd></div>
          </dl>
          <p className="hint">Es una conclusión sobre evidencia del cliente {SOURCES.sse.product}. No prueba un EDR activo.</p>
        </aside>
      </div>

      <section aria-labelledby="sources-title" className="by-source">
        <h2 id="sources-title" className="section-title">Lo que dice cada fuente</h2>
        <div className="by-source-grid">
          {SOURCE_ORDER.map(key => (
            <article key={key} className="card source-card" data-src={key} aria-labelledby={`src-${key}`}>
              <header><Seal source={key} label="kind" /><h3 id={`src-${key}`} className="sr-only">{SOURCES[key].kind}</h3><span className="muted">{SOURCES[key].product}</span></header>
              {key === 'pam' && (<>
                <h4 className="label">Identity</h4>
                {view.identity.status === 'ambiguous'
                  ? <p>Dos identidades activas con el mismo correo: <span className="data">{person.identityIds.map(i => `acme-identity-${i}`).join(', ')}</span>. Ninguna se elige automáticamente.</p>
                  : <p>Una identidad activa, <span className="data">acme-identity-{person.identityIds[0]}</span>, unida por correo exacto.</p>}
                <h4 className="label">PAM</h4>
                {view.safes.length === 0
                  ? <p className="muted">Sin usuario privilegiado. No implica que deba tenerlo.</p>
                  : <ul className="mini-list">{view.safes.map(safe => (
                      <li key={safe.id}><Link to="/cyberark/safes" className="data">{safe.name}</Link><span className="muted">{safe.accounts.map(a => a.name).join(', ')}</span></li>
                    ))}</ul>}
              </>)}
              {key === 'sse' && (
                view.devices.length === 0
                  ? <p className="muted">Usuario presente, ningún equipo observado.</p>
                  : <ul className="mini-list">{view.devices.map(device => (
                      <li key={device.id}><span className="data">{device.hostname}</span><span className={device.recent ? '' : 'muted'}>{device.recent ? 'señal' : 'sin señal'} {ago(device.lastSignalAt)}</span></li>
                    ))}</ul>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="card case-note" aria-labelledby="case-title">
        <h2 id="case-title" className="label">Nota del caso</h2>
        <p>{person.case}</p>
      </section>
    </Shell>
  );
}
