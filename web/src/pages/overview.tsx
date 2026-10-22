import { accounts, coverageSummary, devices, people, safes, type CoverageStatus } from '../model/company.ts';
import { insights, personView, PLANNED, VERDICT_LABEL } from '../model/view.ts';
import { Seal, Verdict, VerdictGlyph } from '../ui/identity.tsx';
import { Link, useApp } from '../ui/router.tsx';
import { Shell } from '../ui/shell.tsx';

const VERDICTS: CoverageStatus[] = ['covered', 'partial', 'gap', 'unknown'];

export function Overview() {
  const { mode } = useApp();
  const summary = coverageSummary(mode);
  const found = insights(mode);
  const counts = summary.counts;

  return (
    <Shell title="Resumen" lede="Qué dicen las fuentes de Acme Corp y qué se concluye al cruzarlas.">
      <div className="overview">
        <section className="card coverage" aria-labelledby="coverage-title">
          <header className="card-head">
            <div>
              <h2 id="coverage-title">Cobertura de cliente</h2>
              <p className="muted">{summary.label}. Regla <span className="data">CONN-001 v1</span>, señal en 7 días.</p>
            </div>
            <p className="coverage-figure">
              {counts.coverage_percent === null
                ? <><strong>—</strong><span>no evaluable</span></>
                : <><strong>{Math.round(counts.coverage_percent)}%</strong><span>de {counts.denominator} personas</span></>}
            </p>
          </header>
          <div className="ribbon" role="img" aria-label={VERDICTS.map(v => `${counts[v]} ${VERDICT_LABEL[v].toLowerCase()}`).join(', ')}>
            {VERDICTS.filter(v => counts[v] > 0).map(v => (
              <span key={v} data-verdict={v} style={{ flexGrow: counts[v] }} />
            ))}
          </div>
          <ul className="ribbon-legend">
            {VERDICTS.map(v => (
              <li key={v} data-verdict={v}><VerdictGlyph status={v} /> <strong>{counts[v]}</strong> {VERDICT_LABEL[v].toLowerCase()}</li>
            ))}
          </ul>
          <h3 className="label by-person-title">Por persona</h3>
          <ul className="by-person">
            {people.map(person => {
              const status = personView(person, mode).coverage.status;
              return (
                <li key={person.id} data-verdict={status}>
                  <VerdictGlyph status={status} />
                  <Link to={`/personas/${person.id}`}>{person.name}</Link>
                  <span className="sr-only">: {VERDICT_LABEL[status]}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="card inventory" aria-labelledby="inventory-title">
          <h2 id="inventory-title">Inventario y procedencia</h2>
          <dl className="stat-list">
            <div><dt><Seal source="pam" label="none" /> Personas</dt><dd>{people.length}</dd></div>
            <div><dt><Seal source="pam" label="none" /> Identidades activas</dt><dd>{people.flatMap(p => p.identityIds).length}</dd></div>
            <div><dt><Seal source="sse" label="none" /> Equipos</dt><dd>{devices.length}</dd></div>
            <div><dt><Seal source="pam" label="none" /> Safes</dt><dd>{safes.length}</dd></div>
            <div><dt><Seal source="pam" label="none" /> Cuentas privilegiadas</dt><dd>{accounts.length}</dd></div>
          </dl>
          <p className="hint">El sello indica qué fuente afirma cada número.</p>
        </section>

        <section className="findings" aria-labelledby="findings-title">
          <header className="section-head">
            <h2 id="findings-title">Hallazgos cruzados</h2>
            <p className="muted">Lo que aparece sólo al juntar las fuentes. Ordenados por gravedad.</p>
          </header>
          <ol className="finding-list">
            {found.map(item => (
              <li key={item.id} className="finding" data-verdict={item.tone}>
                <div className="finding-mark"><VerdictGlyph status={item.tone} size={14} /></div>
                <div className="finding-body">
                  <h3>{item.title}</h3>
                  <p className="finding-who">
                    <Link to={`/personas/${item.person.id}`}>{item.person.name}</Link>
                    <span className="muted"> · {item.person.area}</span>
                  </p>
                  <p className="finding-detail">{item.detail}</p>
                  <div className="finding-meta">
                    <span className="chain" aria-label={`Fuentes: ${item.sources.length}`}>
                      {item.sources.map(source => <Seal key={source} source={source} label="none" />)}
                    </span>
                    <span className="data muted">{item.rule}</span>
                  </div>
                </div>
                <Verdict status={item.tone} />
              </li>
            ))}
          </ol>
        </section>

        <section className="card blind-spots" aria-labelledby="blind-title">
          <h2 id="blind-title">Puntos ciegos</h2>
          <p className="muted">Fuentes que todavía no están conectadas. Mientras falten, Custodia no concluye sobre lo que medirían.</p>
          <ul className="planned-list">
            {PLANNED.map(source => (
              <li key={source.key}><Seal source={source.key} planned /> <span className="muted">{source.detail}</span></li>
            ))}
          </ul>
          <p className="hint">La señal de Netskope no demuestra un EDR activo: hace falta su propia fuente.</p>
        </section>
      </div>
    </Shell>
  );
}
