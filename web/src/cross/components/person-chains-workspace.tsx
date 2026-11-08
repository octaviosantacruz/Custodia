import { useMemo, useState, type ReactNode } from 'react';
import { ArrowUpRight, Search, UserRound } from 'lucide-react';
import { StateBlock } from './state-block';
import { StatusBadge } from './semantic';
import { HelpHint } from './help-hint';
import { personToolLink, personToolView } from '../lib/person-node-view';
import {
  PERSON_CENTER,
  PERSON_PLATFORM_LABELS,
  PERSON_STAGE,
  defaultPersonTool,
  personLinkStyle,
  personPlatformAnswer,
  siaAccessDetail,
  personPlatformSources,
  personToolFacts,
  personToolHeadline,
  stagePercent,
  topologyNode,
  type PersonLinkStyle,
  type PersonNodeId,
  type StagePoint,
} from '../lib/person-radial';
import { usePersonView } from '../hooks/use-person-view';
import { usePersonClientCoverage } from '../hooks/use-person-client-coverage';
import { PersonConnectionPanel } from './person-client-coverage';
import type { PersonSource, PersonToolSummary } from '../lib/chains-api';
import type { WorkspaceView } from '../lib/workspaces';
import './chain-workspace.css';
import './person-chains-workspace.css';
import { t } from '../i18n/index.ts';

type PersonChainsWorkspaceProps = {
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  onNavigate: (view: WorkspaceView, query?: string) => void;
  permissions: string[];
};

const PLATFORM_LABELS = PERSON_PLATFORM_LABELS;

/* CONN-SPACE-001: the platform nodes wear their brand mark: lime on the dark
   theme, the dark mark on the light one (same pairing as the switcher). */
const PLATFORM_LOGOS: Record<PersonNodeId, { dark: string; light: string }> = {
  pam: { dark: '/cyberark-logo-lime.png', light: '/cyberark-logo-dark.png' },
  netskope: { dark: '/netskope-full-lime.png', light: '/netskope-full-black.png' },
};

/* What each platform answers about the person, as the panel eyebrow. */
const PLATFORM_QUESTIONS: Record<PersonNodeId, string> = {
  pam: t('ACCESO PRIVILEGIADO'),
  netskope: t('CLIENTE NETSKOPE'),
};

const LINK_LEGEND: ReadonlyArray<{ style: PersonLinkStyle; label: string }> = [
  { style: 'linked', label: t('Vinculado por correo') },
  { style: 'reference', label: t('Referencia por nombre') },
  { style: 'ambiguous', label: t('Ambiguo') },
  { style: 'none', label: t('Sin registro') },
];

/* Workspace-local platform slots on the wide stage; Home and the shared radial
   coordinates stay put. CyberArk sits up-right and Netskope down-left so the
   two answers read apart from the person in the centre. */
const PERSON_VIEW_TOOL_POINTS: Record<PersonNodeId, StagePoint> = {
  pam: { x: 126, y: 26 },
  netskope: { x: 38, y: 82 },
};

const PLATFORM_ORDER: readonly PersonNodeId[] = ['pam', 'netskope'];

function PlatformLogo({ source, size = 'node' }: { source: PersonNodeId; size?: 'node' | 'panel' }) {
  const logo = PLATFORM_LOGOS[source];
  return <span className={`person-platform-logo is-${size} is-${source}`} aria-hidden="true">
    <img className="person-platform-logo-dark" src={logo.dark} alt="" />
    <img className="person-platform-logo-light" src={logo.light} alt="" />
  </span>;
}

type PersonToolEntry = { source: PersonNodeId; tool: PersonToolSummary | undefined };
type CyberArkCapability = Extract<PersonSource, 'identity' | 'sia'>;
type CyberArkCapabilityEntry = { source: CyberArkCapability; tool: PersonToolSummary };

function PersonRadial({ name, email, platforms, sia, selected, onSelect }: {
  name: string;
  email: string;
  platforms: PersonToolEntry[];
  /* SIA is part of CyberArk: it only feeds the CyberArk node. */
  sia: PersonToolSummary | undefined;
  selected: PersonNodeId | null;
  onSelect: (source: PersonNodeId) => void;
}) {
  return <div className="person-radial">
    <div className="person-radial-stage">
      {/* Each edge belongs to its destination platform and keeps its real
          provenance; a platform without a record (or not readable) has none. */}
      <svg className="person-radial-lines" viewBox={`0 0 ${PERSON_STAGE.width} ${PERSON_STAGE.height}`} preserveAspectRatio="none" aria-hidden>
        {platforms.map(({ source, tool }) => {
          const style = personLinkStyle(tool, source === 'pam' ? sia : undefined);
          if (style === 'none') return null;
          const edge = { from: PERSON_CENTER, to: PERSON_VIEW_TOOL_POINTS[source] };
          return <line
            key={source}
            className={`person-spoke is-${style}${source === selected ? ' is-selected' : ''}`}
            x1={edge.from.x} y1={edge.from.y} x2={edge.to.x} y2={edge.to.y}
            vectorEffect="non-scaling-stroke"
          />;
        })}
      </svg>

      <div className="person-radial-center" style={stagePercent(PERSON_CENTER)}>
        <span className="person-radial-avatar" aria-hidden><UserRound size={34} /></span>
        <strong>{name || email}</strong>
        {name ? <span className="mono">{email}</span> : null}
      </div>

      <div className="person-radial-tools" role="group" aria-label={t('Herramientas de la persona')}>
        {platforms.map(({ source, tool }, index) => {
          const platformSia = source === 'pam' ? sia : undefined;
          const style = personLinkStyle(tool, platformSia);
          const answer = personPlatformAnswer(source, tool, platformSia);
          const node = topologyNode(source);
          const text = <span className="person-radial-tool-text" aria-hidden>
            <small className="person-radial-tool-platform">{PLATFORM_LABELS[source]}</small>
            <strong>{answer.label}</strong>
            {answer.count ? <small>{answer.count}</small> : null}
          </span>;
          const label = `${PLATFORM_LABELS[source]}: ${answer.label}${answer.count ? ` · ${answer.count}` : ''}`;
          return <div
            key={source}
            className={`person-radial-node person-radial-node-${source}`}
            data-depth={node.depth}
            data-parent="person"
            style={{ ...stagePercent(PERSON_VIEW_TOOL_POINTS[source]), animationDelay: `${Math.min(index, 2) * 20}ms` }}
          >
            {tool ? <button
              type="button"
              className={`person-radial-tool is-${style} is-answer-${answer.answer}${source === selected ? ' is-selected' : ''}`}
              aria-pressed={source === selected}
              aria-label={label}
              onClick={() => onSelect(source)}
            ><PlatformLogo source={source} /></button>
              /* The actor cannot read this platform: shown, but never as a "no". */
              : <span className="person-radial-tool is-none is-answer-unknown" role="img" aria-label={label}><PlatformLogo source={source} /></span>}
            {text}
          </div>;
        })}
      </div>
    </div>
  </div>;
}

/* Identity and SIA are how CyberArk grants the access, not separate platforms. */
const CAPABILITY_LABELS: Record<CyberArkCapability, string> = {
  identity: t('Roles en Identity'),
  sia: t('Políticas de SIA'),
};

function CyberArkCapabilityDetails({ capabilities }: { capabilities: CyberArkCapabilityEntry[] }) {
  if (!capabilities.length) return null;
  return <section className="person-cyberark-capabilities" aria-label={t('Cómo obtiene el acceso')}>
    <p className="eyebrow">{t('CÓMO OBTIENE EL ACCESO')}</p>
    <ul>
      {capabilities.map(({ source, tool }) => {
        const view = personToolView(source, tool);
        return <li key={source}>
          <span>
            <strong>{CAPABILITY_LABELS[source]}</strong>
            <small>{personToolHeadline(source, tool)}</small>
            {source === 'sia' && siaAccessDetail(tool) ? <small>{siaAccessDetail(tool)}</small> : null}
          </span>
          <StatusBadge tone={view.tone}>{view.statusLabel}</StatusBadge>
        </li>;
      })}
    </ul>
  </section>;
}

function PersonToolPanel({ source, tool, sia, cyberArkCapabilities, evidence, onOpen }: {
  source: PersonNodeId;
  tool: PersonToolSummary | undefined;
  sia: PersonToolSummary | undefined;
  cyberArkCapabilities: CyberArkCapabilityEntry[];
  evidence: ReactNode;
  onOpen: (source: PersonSource) => void;
}) {
  const platformSia = source === 'pam' ? sia : undefined;
  const view = personToolView(source, tool, platformSia);
  const answer = personPlatformAnswer(source, tool, platformSia);
  const link = personToolLink(source, tool);
  const facts = personToolFacts(source, tool);
  return <aside className={`person-radial-panel is-${personLinkStyle(tool, platformSia)}`} aria-label={`${PLATFORM_LABELS[source]} de la persona`}>
    <div className="person-radial-panel-head">
      <PlatformLogo source={source} size="panel" />
      <div>
        <p className="eyebrow">{PLATFORM_QUESTIONS[source]}</p>
        <h3>{PLATFORM_LABELS[source]}</h3>
      </div>
    </div>
    <StatusBadge tone={answer.tone}>{answer.label}{answer.count ? ` · ${answer.count}` : ''}</StatusBadge>
    <p className="person-radial-provenance">
      <span>{view.statusLabel}</span>
      {view.why ? <HelpHint label={`Cómo se conecta con ${PLATFORM_LABELS[source]}`}><p>{view.why}</p></HelpHint> : null}
    </p>
    {facts.length ? <ul className="person-radial-facts" aria-label={`Detalle de ${PLATFORM_LABELS[source]}`}>
      {facts.map((fact) => <li key={fact.label} className="person-radial-fact" title={`${fact.label}: ${fact.value}`}>
        <span>{fact.label}</span>
        <strong>{fact.value}</strong>
      </li>)}
    </ul> : null}
    {source === 'pam' ? <CyberArkCapabilityDetails capabilities={cyberArkCapabilities} /> : null}
    {source === 'netskope' ? evidence : null}
    {link ? <button
      type="button"
      className="button secondary person-hub-action"
      onClick={() => onOpen(source)}
    ><ArrowUpRight size={14} aria-hidden /> {t('Abrir {name}', { name: PLATFORM_LABELS[source] })}</button> : null}
  </aside>;
}

export function PersonChainsWorkspace({ authChecked, authenticated, onUnauthorized, onError, onNavigate, permissions }: PersonChainsWorkspaceProps) {
  const controller = usePersonView({ authChecked, authenticated, onUnauthorized, onError });
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selection, setSelection] = useState<{ email: string; source: PersonNodeId } | null>(null);
  const summary = controller.summary;
  const canReadPersonCoverage = permissions.includes('access:manage')
    || (permissions.includes('identity:catalogs_read') && permissions.includes('netskope:read'));
  const coverage = usePersonClientCoverage({
    enabled: canReadPersonCoverage, authChecked, authenticated,
    email: summary?.email ?? null, onUnauthorized, onError,
  });
  const searchVisible = showSuggestions && controller.query.trim().length >= 2;
  /* Both platforms are always drawn so each answers its question; only the
     ones the actor can read are selectable. */
  const platforms = useMemo<PersonToolEntry[]>(() => {
    if (!summary) return [];
    return PLATFORM_ORDER.map((source) => ({ source, tool: summary.tools[source] }));
  }, [summary]);
  const tools = useMemo(() => platforms.filter((entry) => entry.tool), [platforms]);
  const cyberArkCapabilities = useMemo<CyberArkCapabilityEntry[]>(() => {
    if (!summary) return [];
    return (['identity', 'sia'] as const)
      .map((source) => ({ source, tool: summary.tools[source] }))
      .filter((entry): entry is CyberArkCapabilityEntry => Boolean(entry.tool && entry.tool.status !== 'unmatched'));
  }, [summary]);
  const hasConnection = canReadPersonCoverage && Boolean(summary?.tools.identity && summary?.tools.netskope);
  // A tool picked for another person does not carry over.
  const selectedSource = summary && selection?.email === summary.email && tools.some((entry) => entry.source === selection.source)
    ? selection.source
    : defaultPersonTool(tools);

  const openTool = (source: PersonSource) => {
    if (!summary) return;
    const link = personToolLink(source, summary.tools[source]);
    if (!link) return;
    onNavigate(link.view, link.query);
    // The tool's chain restores its trail from the URL query when it mounts,
    // so attach the deep link to the entry the navigation just created. If
    // the navigation did not happen (e.g. no access), the URL is left alone.
    if (link.path) {
      const target = new URL(link.path, window.location.origin);
      if (window.location.pathname === target.pathname) {
        window.history.replaceState(window.history.state, '', `${target.pathname}${target.search}`);
      }
    }
  };

  return <>
    <section className="chain-explorer person-explorer" aria-label={t('Vista por persona')}>
      <div className="chain-search">
        <label className="search-box"><Search size={16} /><input
          type="search"
          aria-label={t('Buscar persona por correo o nombre')}
          placeholder={t('Correo o nombre')}
          value={controller.query}
          onChange={(event) => { controller.setQuery(event.target.value); setShowSuggestions(true); }}
          onFocus={() => setShowSuggestions(true)}
        /></label>
        {searchVisible ? <div className="chain-search-results" role="listbox" aria-label={t('Personas encontradas')}>
          {controller.searchLoading ? <StateBlock variant="loading" title={t('Buscando personas…')} /> : null}
          {controller.searchError ? <StateBlock variant="error" title={t('No se pudo buscar')} hint={controller.searchError} /> : null}
          {!controller.searchLoading && !controller.searchError && !controller.people.length ? <p className="chain-search-empty">{t('Sin coincidencias. Probá con otro nombre o con el correo completo.')}</p> : null}
          {controller.people.map((person) => <button
            key={person.email}
            type="button"
            role="option"
            aria-selected={summary?.email === person.email}
            className="chain-search-item person-search-item"
            onClick={() => { void controller.selectPerson(person.email); setShowSuggestions(false); }}
          >
            <strong>{person.name || person.email}</strong>
            <small className="mono">{person.email}</small>
            <span className="person-source-chips" aria-label={t('Plataformas con registro')}>
              {personPlatformSources(person.sources).map((platform) => <span key={platform} className="person-source-chip is-present" aria-label={`Registro en ${platform}`}>{platform}</span>)}
            </span>
          </button>)}
        </div> : null}
      </div>

      {controller.summaryLoading ? <StateBlock variant="loading" title={t('Resolviendo la persona…')} /> : null}
      {controller.summaryError ? <StateBlock variant="error" title={t('No se pudo resolver la persona')} hint={controller.summaryError} /> : null}
      {summary && !controller.summaryLoading ? <section className="person-hub" aria-label={`Persona ${summary.name || summary.email}`}>
        <PersonRadial
          name={summary.name}
          email={summary.email}
          platforms={platforms}
          sia={summary.tools.sia}
          selected={selectedSource}
          onSelect={(source) => setSelection({ email: summary.email, source })}
        />
        {selectedSource ? <PersonToolPanel
          source={selectedSource}
          tool={summary.tools[selectedSource]}
          sia={summary.tools.sia}
          cyberArkCapabilities={cyberArkCapabilities}
          evidence={hasConnection ? <details key={summary.email} className="person-client-coverage-disclosure person-connection-disclosure">
            <summary>{t('Evidencia del cliente Netskope')}</summary>
            <PersonConnectionPanel
              identity={summary.tools.identity}
              netskope={summary.tools.netskope}
              selectedEmail={summary.email}
              detail={coverage.detail}
              detailLoading={coverage.detailLoading}
              detailError={coverage.detailError}
              onRetryDetail={() => { void coverage.retryDetail(); }}
            />
          </details> : null}
          onOpen={openTool}
        /> : null}
        <div className="chain-relation-legend person-radial-legend" aria-label={t('Leyenda de vínculos')}>
          {LINK_LEGEND.map((item) => <span key={item.style} className={`is-${item.style}`}>{item.label}</span>)}
        </div>
      </section> : null}

      {!summary && !controller.summaryLoading && !controller.summaryError && !(searchVisible && !controller.searchLoading && !controller.searchError && !controller.people.length) ? <StateBlock compact title={t('Elegí una persona para ver sus herramientas')} /> : null}
    </section>
  </>;
}
