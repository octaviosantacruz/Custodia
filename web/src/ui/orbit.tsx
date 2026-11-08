// Rueda de fuentes: Cruces al centro y cada fuente en una corona a su alrededor.
// Geometría y componente propios de Custodia (el estilo radial lo pidió el dueño
// tomando como referencia la portada de DSHub; no se importa código de DSHub).
import { useState, type CSSProperties } from 'react';
import { PLANNED, SOURCES, SOURCE_ORDER, sourceRun, type PlannedKey, type SourceKey } from '../model/view.ts';
import { useApp, Link } from './router.tsx';
import { Seal, ToolLogo } from './identity.tsx';

const STAGE = 200;
const CENTER = STAGE / 2;
const CROWN = 75; // punto medio entre el anillo interior (54 %) y el exterior (96 %)
const round = (n: number) => Math.round(n * 100) / 100;

/** `count` posiciones equidistantes; 0° a la derecha, giro horario, -90° arriba. */
export function orbitLayout(count: number, startAngle = -90) {
  return Array.from({ length: count }, (_, i) => {
    const angle = ((startAngle + (i * 360) / count) * Math.PI) / 180;
    return { x: round(CENTER + CROWN * Math.cos(angle)), y: round(CENTER + CROWN * Math.sin(angle)) };
  });
}

type Spot = { key: SourceKey | PlannedKey; to?: string; title: string; detail: string };

export function SourceOrbit() {
  const { mode } = useApp();
  const [focus, setFocus] = useState<string | null>(null);
  const spots: Spot[] = [
    ...SOURCE_ORDER.map(key => ({
      key, to: key === 'pam' ? '/cyberark/identidades' : '/netskope/usuarios',
      title: SOURCES[key].product,
      detail: `${SOURCES[key].kind} · ${sourceRun(key, mode).freshness === 'fresh' ? 'al día' : sourceRun(key, mode).freshness === 'stale' ? 'desactualizada' : 'parcial'}`,
    })),
    ...PLANNED.map(p => ({ key: p.key, title: p.product, detail: `${p.kind} · próximamente` })),
  ];
  const points = orbitLayout(spots.length);
  const pct = (v: number) => `${round((v / STAGE) * 100)}%`;
  const live = (s: Spot) => Boolean(s.to);
  const lit = (s: Spot) => live(s) && (focus === s.key || focus === 'core');

  return (
    <nav className="orbit" aria-label="Fuentes de Custodia" data-focus={focus ?? undefined}>
      <div className="orbit-ring" aria-hidden="true" />
      <div className="orbit-inner" aria-hidden="true" />
      {spots.map((s, i) => {
        const dx = points[i].x - CENTER, dy = points[i].y - CENTER;
        const length = Math.hypot(dx, dy);
        const style: CSSProperties = { left: '50%', top: '50%', width: pct(length), transform: `rotate(${round((Math.atan2(dy, dx) * 180) / Math.PI)}deg)` };
        return <span key={s.key} data-src={s.key} className={`orbit-spoke${lit(s) ? ' is-active' : ''}`} style={style} aria-hidden="true" />;
      })}
      {spots.map((s, i) => {
        const style = { left: pct(points[i].x), top: pct(points[i].y), '--orbit-order': i } as CSSProperties;
        const label = (
          <span className="orbit-label" aria-hidden="true">
            <strong>{s.title}</strong><small>{s.detail}</small>
          </span>
        );
        if (!s.to) {
          return <div key={s.key} data-src={s.key} className="orbit-node is-soon" style={style} title={`${s.title} · próximamente`}>
            <Seal source={s.key} label="none" planned />{label}
          </div>;
        }
        return <Link key={s.key} to={s.to} data-src={s.key} className={`orbit-node${lit(s) || focus === s.key ? ' is-active' : ''}`} style={style}
          aria-label={`Abrir ${s.title}`}
          onMouseEnter={() => setFocus(s.key)} onMouseLeave={() => setFocus(null)} onFocus={() => setFocus(s.key)} onBlur={() => setFocus(null)}>
          <Seal source={s.key} label="none" /><ToolLogo source={s.key} />{label}
        </Link>;
      })}
      <Link to="/personas" className={`orbit-core${focus === 'core' ? ' is-active' : ''}`} aria-label="Abrir Personas: lo que se concluye al cruzar las fuentes"
        onMouseEnter={() => setFocus('core')} onMouseLeave={() => setFocus(null)} onFocus={() => setFocus('core')} onBlur={() => setFocus(null)}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" /></svg>
        <span>Cruces</span>
      </Link>
    </nav>
  );
}

export type PersonSpot = { key: SourceKey; title: string; detail: string; join: 'matched' | 'ambiguous' | 'unmatched' };

/** Rueda de una persona: sus iniciales al centro y una fuente por nodo; el trazo del radio dice cómo se unió. */
export function PersonOrbit({ initials, name, spots }: { initials: string; name: string; spots: PersonSpot[] }) {
  const points = orbitLayout(spots.length, spots.length === 2 ? 180 : -90);
  const pct = (v: number) => `${round((v / STAGE) * 100)}%`;
  return (
    <div className="orbit orbit-person" role="img" aria-label={`Rueda de ${name}: ${spots.map(s => `${SOURCES[s.key].product}, ${s.detail}`).join('; ')}`}>
      <div className="orbit-ring" aria-hidden="true" />
      <div className="orbit-inner" aria-hidden="true" />
      {spots.map((s, i) => {
        const dx = points[i].x - CENTER, dy = points[i].y - CENTER;
        const style: CSSProperties = { left: '50%', top: '50%', width: pct(Math.hypot(dx, dy)), transform: `rotate(${round((Math.atan2(dy, dx) * 180) / Math.PI)}deg)` };
        return <span key={s.key} data-src={s.key} className={`orbit-spoke is-active is-${s.join}`} style={style} aria-hidden="true" />;
      })}
      {spots.map((s, i) => (
        <div key={s.key} data-src={s.key} className={`orbit-node is-fixed is-${s.join}`} style={{ left: pct(points[i].x), top: pct(points[i].y), '--orbit-order': i } as CSSProperties} aria-hidden="true">
          <Seal source={s.key} label="none" /><ToolLogo source={s.key} />
          <span className="orbit-label orbit-label-static"><strong>{SOURCES[s.key].product}</strong><small>{s.detail}</small></span>
        </div>
      ))}
      <div className="orbit-core orbit-core-person" aria-hidden="true"><span>{initials}</span></div>
    </div>
  );
}
