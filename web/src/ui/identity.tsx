// Piezas de la identidad: la marca, el sello de fuente y el veredicto.
// Son las únicas que pintan con color; el resto de la interfaz es tinta.
import { useId } from 'react';
import type { CoverageStatus } from '../model/company.ts';
import { PLANNED, SOURCES, VERDICT_LABEL, type PlannedKey, type SourceKey } from '../model/view.ts';

/** La marca: dos registros que se cruzan; lo que comparten es lo que Custodia muestra. */
export function Mark({ size = 28 }: { size?: number }) {
  const clip = useId();
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs><clipPath id={clip}><rect x="2.5" y="2.5" width="18" height="18" rx="5" /></clipPath></defs>
      <rect x="11.5" y="11.5" width="18" height="18" rx="5" fill="currentColor" clipPath={`url(#${clip})`} />
      <rect x="2.5" y="2.5" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="2.6" />
      <rect x="11.5" y="11.5" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="2.6" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <Mark size={22} />
      <span>custodia</span>
    </span>
  );
}

/** Logos de producto, monocromos en blanco: identifican la herramienta, no llevan color del sistema. */
const LOGOS: Partial<Record<SourceKey | PlannedKey, { src: string; width: number; height: number }>> = {
  pam: { src: '/logos/cyberark-logo-white.png', width: 16, height: 18 },
  sse: { src: '/logos/netskope-full-white.png', width: 26, height: 14 },
};

export function ToolLogo({ source }: { source: SourceKey | PlannedKey }) {
  const logo = LOGOS[source];
  return logo ? <img className="tool-logo" src={logo.src} alt="" width={logo.width} height={logo.height} /> : null;
}

const sourceInfo = (key: SourceKey | PlannedKey) => key in SOURCES ? SOURCES[key as SourceKey] : PLANNED.find(p => p.key === key)!;

/** Sello de procedencia: monograma de dos letras en el color de la fuente. */
export function Seal({ source, label = 'kind', planned = false }: { source: SourceKey | PlannedKey; label?: 'kind' | 'product' | 'none'; planned?: boolean }) {
  const info = sourceInfo(source);
  const text = label === 'kind' ? info.kind : label === 'product' ? info.product : null;
  return (
    <span className={`seal${planned ? ' is-planned' : ''}`} data-src={source} title={label === 'none' ? `${info.kind} · ${info.product}` : undefined}>
      <span className="seal-mono" aria-hidden={text ? 'true' : undefined}>{info.mono}</span>
      {label === 'product' && <ToolLogo source={source} />}
      {text ? <span className="seal-text">{text}</span> : <span className="sr-only">{info.kind}</span>}
    </span>
  );
}

/** Forma del veredicto: lleno, medio, rombo o trama. Nunca sólo color. */
export function VerdictGlyph({ status, size = 12 }: { status: CoverageStatus; size?: number }) {
  return (
    <svg className="verdict-glyph" data-verdict={status} width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      {status === 'covered' && <circle cx="6" cy="6" r="5" fill="var(--tone)" />}
      {status === 'partial' && (<>
        <circle cx="6" cy="6" r="4.4" fill="none" stroke="var(--tone)" strokeWidth="1.4" />
        <path d="M6 1.6a4.4 4.4 0 0 1 0 8.8z" fill="var(--tone)" />
      </>)}
      {status === 'gap' && <path d="M6 .8 11.2 6 6 11.2.8 6z" fill="var(--tone)" />}
      {status === 'unknown' && <circle cx="6" cy="6" r="4.4" fill="none" stroke="var(--tone)" strokeWidth="1.4" strokeDasharray="2.2 1.6" />}
    </svg>
  );
}

export function Verdict({ status, label }: { status: CoverageStatus; label?: string }) {
  return (
    <span className="verdict" data-verdict={status}>
      <VerdictGlyph status={status} />
      <span>{label ?? VERDICT_LABEL[status]}</span>
    </span>
  );
}
