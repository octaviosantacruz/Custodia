import type { CoverageStatus } from '../model/company.ts';
import { PLANNED, SOURCE_ORDER, SOURCES } from '../model/view.ts';
import { Mark, Seal, Verdict, VerdictGlyph, Wordmark } from '../ui/identity.tsx';
import { Shell } from '../ui/shell.tsx';

const INK = [
  ['--ink-50', 'Fondo'], ['--ink-100', 'Panel'], ['--ink-150', 'Elevado'], ['--ink-200', 'Campo'], ['--ink-300', 'Filo'],
  ['--ink-400', 'Filo fuerte'], ['--ink-600', 'Texto 3'], ['--ink-700', 'Texto 2'], ['--ink-900', 'Texto 1'],
];
const SHAPES: Record<CoverageStatus, string> = { covered: 'círculo lleno', partial: 'medio círculo', gap: 'rombo', unknown: 'anillo punteado' };

export function System() {
  return (
    <Shell title="Sistema visual" lede="La identidad de Custodia: una marca, tres familias de color con un trabajo cada una, y una tinta neutra para todo lo demás.">
      <section className="card system-block" aria-labelledby="sys-brand">
        <h2 id="sys-brand">Marca</h2>
        <div className="brand-row">
          <span className="brand-tile"><Mark size={64} /></span>
          <div>
            <p className="brand-wordmark"><Wordmark /></p>
            <p className="muted">Dos registros que se cruzan: cada herramienta dice lo suyo y Custodia muestra lo que comparten, con su procedencia. Va en lima sólo en la marca, la acción principal, el foco y la selección.</p>
          </div>
        </div>
        <ul className="swatches">
          <li><span className="swatch" style={{ background: 'var(--brand)' }} /><strong>Lima</strong><code>--brand</code><span>marca · acción · foco</span></li>
          <li><span className="swatch" style={{ background: 'var(--brand-ink)' }} /><strong>Tinta sobre lima</strong><code>--brand-ink</code><span>texto del botón principal</span></li>
        </ul>
      </section>

      <section className="card system-block" aria-labelledby="sys-src">
        <h2 id="sys-src">Procedencia: qué herramienta lo dice</h2>
        <p className="muted">Un tono frío por <em>tipo</em> de fuente, nunca por fabricante, con igual luminosidad para que ninguna pese más. Siempre va con su sello de dos letras: se lee sin depender del color.</p>
        <ul className="swatches">
          {SOURCE_ORDER.map(key => (
            <li key={key} data-src={key}><span className="swatch" style={{ background: 'var(--tone)' }} /><Seal source={key} /><code>--src-{key}</code><span>{SOURCES[key].product}</span></li>
          ))}
          {PLANNED.map(source => (
            <li key={source.key} data-src={source.key}><span className="swatch is-reserved" style={{ borderColor: 'var(--tone)' }} /><Seal source={source.key} planned /><code>--src-{source.key}</code><span>reservado</span></li>
          ))}
        </ul>
      </section>

      <section className="card system-block" aria-labelledby="sys-verdict">
        <h2 id="sys-verdict">Veredicto: qué concluye una regla</h2>
        <p className="muted">Sólo las reglas pintan veredictos. Cada uno tiene forma propia, y una captura incompleta siempre produce «desconocido», nunca una brecha falsa.</p>
        <ul className="swatches">
          {(['covered', 'partial', 'gap', 'unknown'] as CoverageStatus[]).map(status => (
            <li key={status} data-verdict={status}>
              <span className="swatch is-glyph"><VerdictGlyph status={status} size={22} /></span>
              <Verdict status={status} /><code>--v-{status}</code><span>{SHAPES[status]}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card system-block" aria-labelledby="sys-ink">
        <h2 id="sys-ink">Tinta</h2>
        <p className="muted">Nueve pasos en el mismo matiz frío. Superficies, filos y texto salen sólo de aquí.</p>
        <ol className="ink-ramp">
          {INK.map(([token, name]) => (
            <li key={token}><span style={{ background: `var(${token})` }} /><strong>{name}</strong><code>{token}</code></li>
          ))}
        </ol>
      </section>

      <section className="card system-block" aria-labelledby="sys-type">
        <h2 id="sys-type">Tipografía</h2>
        <div className="type-specimen">
          <p className="type-ui">Instrument Sans <span className="muted">— interfaz y títulos</span></p>
          <p className="type-data">JetBrains Mono <span className="muted">— datos: correos, equipos, corridas</span></p>
          <p className="type-sample"><span className="data">alice.morgan@acme.example</span> · <span className="data">acme-netskope-complete</span></p>
        </div>
      </section>

      <section className="card system-block" aria-labelledby="sys-rules">
        <h2 id="sys-rules">Reglas</h2>
        <ol className="rules">
          <li>Un color, un trabajo. La lima nunca marca un dato; un color de fuente nunca marca un veredicto.</li>
          <li>El color nunca está solo: sello de dos letras para fuentes, forma para veredictos, texto siempre.</li>
          <li>El trazo dice cómo se unió un dato: continuo es correo exacto, discontinuo es ambiguo, punteado es ausencia.</li>
          <li>Lo observado no es un veredicto. «Sin señal» es un hecho de la fuente; «brecha» lo decide una regla.</li>
          <li>Los logos de las herramientas van en blanco y sólo junto a su nombre: identifican el producto, el color lo pone el sello.</li>
        </ol>
      </section>
    </Shell>
  );
}
