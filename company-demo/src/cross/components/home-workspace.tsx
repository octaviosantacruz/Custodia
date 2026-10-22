import { ArrowRight, Waypoints } from 'lucide-react';
import { useState, type CSSProperties, type ReactElement } from 'react';
import type { AuthStatus } from '../types/auth';
import { hasWorkspaceAccess, type WorkspaceView } from '../lib/workspaces';
import { HOME_WHEEL_CENTER, radialOrbitLayout, wheelPercent, wheelRay, type RadialWheelNode, type WheelPoint } from '../lib/home-wheel';
import './home-workspace.css';

type HomeWorkspaceProps = {
  authStatus: AuthStatus;
  onNavigate: (view: WorkspaceView) => void;
};

function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || 'ahí';
}

export function CustodiaMark({ size }: { size?: number } = {}) {
  return <svg className="custodia-mark" width={size} height={size} style={size ? { width: size, height: size } : undefined} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <rect className="custodia-mark-surface" width="32" height="32" rx="7" />
    <path className="custodia-mark-branch custodia-mark-branch-left" pathLength="1" d="M16 16 8.5 8.5" />
    <path className="custodia-mark-branch custodia-mark-branch-right" pathLength="1" d="M16 16 23.5 8.5" />
    <path className="custodia-mark-branch custodia-mark-branch-bottom" pathLength="1" d="M16 16v9" />
    <circle className="custodia-mark-node custodia-mark-node-core" cx="16" cy="16" r="4.2" />
    <circle className="custodia-mark-node custodia-mark-node-outer" cx="8" cy="8" r="2.8" />
    <circle className="custodia-mark-node custodia-mark-node-outer" cx="24" cy="8" r="2.8" />
    <circle className="custodia-mark-node custodia-mark-node-outer" cx="16" cy="25" r="2.8" />
  </svg>;
}

/* Keep the greeting typographic and immediately readable. Its short accent
   line adds motion without turning the word itself into an illustration. */
function GreetingWordmark() {
  return <span className="home-greeting-wordmark"><span className="home-greeting-text">Hola,</span><span className="home-greeting-accent" aria-hidden="true" /></span>;
}

function CyberArkLogo() {
  return <span className="home-domain-logo" aria-hidden="true">
    <img className="home-domain-logo-dark" src="/cyberark-logo-dark.png" alt="" />
    <img className="home-domain-logo-white" src="/cyberark-logo-white.png" alt="" />
  </span>;
}

function NetskopeLogo() {
  return <span className="home-domain-logo" aria-hidden="true">
    <img className="home-domain-logo-dark" src="/netskope-full-black.png" alt="" />
    <img className="home-domain-logo-white" src="/netskope-full-white.png" alt="" />
  </span>;
}

function BigIdLogo() {
  return <span className="home-domain-logo" aria-hidden="true">
    <img className="home-domain-logo-dark" src="/bigid-full-black.png" alt="" />
    <img className="home-domain-logo-white" src="/bigid-full-white.png" alt="" />
  </span>;
}

export type HomeSection = 'transversal' | 'platform';

type HomeToolId = 'people' | 'cyberark' | 'netskope' | 'bigid';
/* `people` lights every live spoke: the person view crosses all tools. */
type HomeFocus = HomeToolId | null;

type HomeTool = {
  id: HomeToolId;
  /* `transversal` entries are neutral Custodia capabilities (the wheel core);
     `platform` entries are the product tools drawn on the wheel and listed
     under "Plataformas". */
  section: HomeSection;
  label: string;
  detail: string;
  title: string;
  logo: () => ReactElement;
  view?: WorkspaceView;
};

export const HOME_SECTIONS: readonly { id: HomeSection; label: string }[] = [
  { id: 'transversal', label: 'Conexiones' },
  { id: 'platform', label: 'Plataformas' },
];

/* One list drives both the left actions (grouped by section) and the wheel
   (platform nodes plus the transversal core); a tool without a `view` is
   shown as coming soon. Adding a tool here places it on both. */
export const HOME_TOOLS: readonly HomeTool[] = [
  { id: 'people', section: 'transversal', label: 'Conexiones', detail: 'Vista del alcance de cada persona en las herramientas', title: 'Abrir Conexiones para ver el alcance de cada persona en las herramientas, sus registros relacionados y la cobertura de cliente Netskope', logo: CustodiaMark, view: 'person' },
  { id: 'cyberark', section: 'platform', label: 'CyberArk', detail: 'Gestión de accesos privilegiados', title: 'Abrir el tablero, inventario y accesos de CyberArk', logo: CyberArkLogo, view: 'safes' },
  { id: 'netskope', section: 'platform', label: 'Netskope', detail: 'Visibilidad de equipos, usuarios y alertas de fuga de datos', title: 'Abrir el resumen y el inventario de Netskope', logo: NetskopeLogo, view: 'netskopeInventory' },
  { id: 'bigid', section: 'platform', label: 'BigID DSPM', detail: 'Descubrimiento y postura de seguridad de datos', title: 'BigID DSPM · Próximamente', logo: BigIdLogo },
];

export function homeToolsForSection(section: HomeSection): readonly HomeTool[] {
  return HOME_TOOLS.filter((tool) => tool.section === section);
}

/* HOME-WHEEL-002 experimental variant: tools occupy the middle of a flat,
   two-circle radial crown. Destructuring is intentionally independent from
   HOME_TOOLS' DOM/navigation order. */
const [BIGID_LAYOUT, NETSKOPE_LAYOUT, CYBERARK_LAYOUT] = radialOrbitLayout(3, 90);

const HOME_NODE_LAYOUTS: Record<Exclude<HomeToolId, 'people'>, RadialWheelNode> = {
  cyberark: CYBERARK_LAYOUT,
  netskope: NETSKOPE_LAYOUT,
  bigid: BIGID_LAYOUT,
};

type HomeWheelNodeStyle = CSSProperties & {
  '--home-node-order': number;
  '--home-node-size': string;
};

function homeWheelNodeStyle(layout: RadialWheelNode, order: number): HomeWheelNodeStyle {
  return {
    ...wheelPercent(layout.position),
    '--home-node-order': order,
    '--home-node-size': `${layout.nodeSize}px`,
  };
}

function HomeWheelSpoke({ id, from, to, active }: { id: string; from: WheelPoint; to: WheelPoint; active: boolean }) {
  const ray = wheelRay(from, to);
  const style: CSSProperties = { left: ray.originLeft, top: ray.originTop, width: `${ray.lengthPercent}%`, transform: `rotate(${ray.angleDeg}deg)` };
  return <div className={`home-visibility-line home-visibility-line-${id}${active ? ' is-active' : ''}`} style={style} />;
}

function HomeWheelLabel({ tool, active }: { tool: HomeTool; active: boolean }) {
  return <span className={`home-visibility-label home-visibility-label-${tool.id}${active ? ' is-active' : ''}`} aria-hidden="true">
    <strong>{tool.label}</strong>
    <small>{tool.view ? tool.detail : 'Próximamente'}</small>
    {tool.view ? <span className="home-visibility-label-action">Abrir <ArrowRight size={12} /></span> : null}
  </span>;
}

export function HomeVisibilityGraphic({ monochrome = false, focus = null, showPeople = false, onNavigate, onFocusChange }: { monochrome?: boolean; focus?: HomeFocus; showPeople?: boolean; onNavigate?: (view: WorkspaceView) => void; onFocusChange?: (focus: HomeFocus) => void }) {
  const platformTools = homeToolsForSection('platform');
  const peopleTool = HOME_TOOLS.find((tool) => tool.id === 'people');
  const peopleView = peopleTool?.view;
  return <aside className={'home-visibility' + (monochrome ? ' home-visibility-monochrome' : '')} data-active-domain={focus || undefined} data-tools={platformTools.length} aria-label="Fuentes de visibilidad de Custodia">
    <div className="home-visibility-ring" aria-hidden="true" />
    <div className="home-visibility-orbit" aria-hidden="true" />
    {/* One edge per platform tool, drawn only while it is lit (hover or focus on the tool, or on the
        centre for every live tool): nothing is drawn at rest, so a new tool adds no static line. */}
    {platformTools.map((tool) => <HomeWheelSpoke
      key={tool.id}
      id={tool.id}
      from={HOME_WHEEL_CENTER}
      to={HOME_NODE_LAYOUTS[tool.id as Exclude<HomeToolId, 'people'>].position}
      active={Boolean(tool.view) && (focus === tool.id || focus === 'people')}
    />)}
    {platformTools.map((tool, index) => {
      const layout = HOME_NODE_LAYOUTS[tool.id as Exclude<HomeToolId, 'people'>];
      const style = homeWheelNodeStyle(layout, index);
      const Logo = tool.logo;
      if (!tool.view) {
        return <div
          key={tool.id}
          className={`home-visibility-node home-visibility-node-${tool.id} is-soon`}
          style={style}
          data-wheel-angle={layout.angleDeg}
          aria-hidden="true"
          title={tool.title}
          onMouseEnter={() => onFocusChange?.(tool.id)}
          onMouseLeave={() => onFocusChange?.(null)}
        ><Logo /><HomeWheelLabel tool={tool} active={focus === tool.id} /></div>;
      }
      const view = tool.view;
      const active = focus === tool.id || focus === 'people';
      return <button
        key={tool.id}
        className={`home-visibility-node home-visibility-node-${tool.id}` + (active ? ' is-active' : '')}
        style={style}
        data-wheel-angle={layout.angleDeg}
        type="button"
        aria-label={`Abrir ${tool.label}`}
        title={`Abrir ${tool.label}`}
        onClick={() => onNavigate?.(view)}
        onMouseEnter={() => onFocusChange?.(tool.id)}
        onMouseLeave={() => onFocusChange?.(null)}
        onFocus={() => onFocusChange?.(tool.id)}
        onBlur={() => onFocusChange?.(null)}
      ><Logo /><HomeWheelLabel tool={tool} active={focus === tool.id} /></button>;
    })}
    {/* The person view crosses every tool, so it takes the centre of the
        wheel; hovering it lights all the live spokes. It is the same
        transversal destination as the first left-column button. */}
    {showPeople && peopleTool && peopleView ? <>
    <button
      className={'home-visibility-core home-visibility-core-people' + (focus === 'people' ? ' is-active' : '')}
      type="button"
      aria-label={`Abrir ${peopleTool.label}`}
      title={peopleTool.title}
      onClick={() => onNavigate?.(peopleView)}
      onMouseEnter={() => onFocusChange?.('people')}
      onMouseLeave={() => onFocusChange?.(null)}
      onFocus={() => onFocusChange?.('people')}
      onBlur={() => onFocusChange?.(null)}
    ><span className="home-visibility-core-icon"><Waypoints size={22} /></span><span>{peopleTool.label}</span></button>
    <HomeWheelLabel tool={peopleTool} active={focus === 'people'} />
    </>
      : <div className="home-visibility-core"><CustodiaMark /><span>Custodia</span></div>}
  </aside>;
}

export function HomeWorkspace({ authStatus, onNavigate }: HomeWorkspaceProps) {
  const [focus, setFocus] = useState<HomeFocus>(null);
  const canOpenPeople = hasWorkspaceAccess('person', authStatus.permissions ?? []);
  const hover = (next: HomeFocus) => ({
    onMouseEnter: () => setFocus(next),
    onMouseLeave: () => setFocus(null),
    onFocus: () => setFocus(next),
    onBlur: () => setFocus(null),
  });

  const renderTool = (tool: HomeTool) => {
    const Logo = tool.logo;
    const view = tool.view;
    /* Hovering/focusing the person entry lights every live spoke, exactly like
       the wheel core; platform entries also light up while Personas is active. */
    const active = focus === tool.id || (tool.section === 'platform' && focus === 'people');
    if (!view) {
      return <div key={tool.id} className={`home-domain-button home-domain-button-${tool.id} home-domain-button-disabled`} aria-disabled="true" {...hover(tool.id)}>
        <span className="home-domain-icon"><Logo /></span>
        <span><strong>{tool.label}</strong><small>{tool.detail}</small></span>
        <small className="home-domain-status">Próximamente</small>
      </div>;
    }
    return <button key={tool.id} className={`home-domain-button home-domain-button-${tool.id}` + (active ? ' is-active' : '')} type="button" title={tool.title} onClick={() => onNavigate(view)} {...hover(tool.id)}>
      <span className="home-domain-icon"><Logo /></span>
      <span><strong>{tool.label}</strong><small>{tool.detail}</small></span>
      <ArrowRight size={18} />
    </button>;
  };

  return <main className="home-workspace">
    <section className="home-content" aria-labelledby="home-title">
      <h1 id="home-title" className="home-title-reveal"><GreetingWordmark /> <span className="home-greeting-name">{firstName(authStatus.user?.name)}</span></h1>
      <p className="home-copy home-reveal">¿Qué querés revisar hoy?</p>
      <div className="home-actions home-reveal">
        {/* Personas is transversal: the section (and its button) only exist
            when the actor can actually open it, never as an empty shell. */}
        {canOpenPeople && <section className="home-actions-group" data-section="transversal" aria-labelledby="home-section-transversal">
          <h2 className="home-actions-section" id="home-section-transversal">{HOME_SECTIONS[0].label}</h2>
          {homeToolsForSection('transversal').map(renderTool)}
        </section>}
        <section className="home-actions-group" data-section="platforms" aria-labelledby="home-section-platforms">
          <h2 className="home-actions-section" id="home-section-platforms">{HOME_SECTIONS[1].label}</h2>
          {homeToolsForSection('platform').map((tool) => <div key={tool.id} className={`home-domain-entry home-domain-entry-${tool.id}`}>{renderTool(tool)}</div>)}
        </section>
      </div>
    </section>
    <HomeVisibilityGraphic focus={focus} showPeople={canOpenPeople} onNavigate={onNavigate} onFocusChange={setFocus} />
  </main>;
}
