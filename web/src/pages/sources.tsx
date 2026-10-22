import { company } from '../model/company.ts';
import { PLANNED, sourceRun, SOURCE_ORDER, SOURCES } from '../model/view.ts';
import { Seal, ToolLogo } from '../ui/identity.tsx';
import { useApp } from '../ui/router.tsx';
import { Shell } from '../ui/shell.tsx';

export function Sources() {
  const { mode } = useApp();
  return (
    <Shell title="Fuentes" lede="Qué herramientas alimentan a Custodia, con qué captura y qué falta conectar.">
      <h2 className="section-title">Conectadas</h2>
      <div className="source-grid">
        {SOURCE_ORDER.map(key => {
          const run = sourceRun(key, mode);
          return (
            <article key={key} className="card source-tile" data-src={key} aria-labelledby={`tile-${key}`}>
              <header><Seal source={key} label="kind" /><ToolLogo source={key} /></header>
              <h3 id={`tile-${key}`}>{SOURCES[key].product}</h3>
              <p className="muted">{SOURCES[key].detail}</p>
              <dl className="facts">
                <div><dt>Corrida</dt><dd className="data">{run.run_id}</dd></div>
                <div><dt>Estado</dt><dd>{run.status === 'completed' ? 'completa' : 'parcial'}</dd></div>
                <div><dt>Antigüedad</dt><dd className="data">{run.age_hours} h</dd></div>
                <div><dt>Frescura</dt><dd><span className={`freshness is-${run.freshness}`}>{run.freshness === 'fresh' ? 'al día' : run.freshness === 'stale' ? 'fuera de umbral' : 'incompleta'}</span></dd></div>
              </dl>
            </article>
          );
        })}
      </div>
      <h2 className="section-title">En el plan</h2>
      <div className="source-grid">
        {PLANNED.map(source => (
          <article key={source.key} className="card source-tile is-planned" data-src={source.key} aria-labelledby={`tile-${source.key}`}>
            <header><Seal source={source.key} label="kind" planned /></header>
            <h3 id={`tile-${source.key}`}>{source.product}</h3>
            <p className="muted">{source.detail}</p>
            <p className="hint">Sin adaptador ni contrato. Color reservado.</p>
          </article>
        ))}
      </div>
      <p className="hint">Captura de ejemplo de {company.name}: {company.capturedAt.replace('T', ' ').replace(':00Z', ' UTC')}.</p>
    </Shell>
  );
}
