import { useEffect, useState, type MouseEvent } from 'react';
import {
  DEFAULT_GUIDE_SECTION, GUIDE_GROUP_LABELS, GUIDE_SECTIONS, guideSection, guideSectionFromSearch, guideSectionPath,
  shouldShowApiReference, type GuideSectionId,
} from '../content/guide-sections';
import { GUIDE_CONTENT, type GuideBlock } from '../content/product-guide';
import { hasWorkspaceAccess, workspacePath, type WorkspaceView } from '../lib/workspaces';
import './help-workspace.css';

type HelpWorkspaceProps = {
  apiDocsEnabled: boolean;
  requestedSection?: string | null;
  permissions: string[];
  onNavigate?: (view: WorkspaceView) => void;
};

function sectionFromLocation(): GuideSectionId {
  if (typeof window === 'undefined') return DEFAULT_GUIDE_SECTION;
  return guideSectionFromSearch(window.location.search);
}

/* DOCS-PORTAL-001: authenticated product guide, separate from the technical
   Scalar reference. Plain typed content is rendered as text (no innerHTML, no
   runtime Markdown) and the active section lives in the stable
   `/help?section=<id>` deep link. */
export function HelpWorkspace({ apiDocsEnabled, requestedSection = null, permissions, onNavigate }: HelpWorkspaceProps) {
  const [activeId, setActiveId] = useState<GuideSectionId>(() => guideSection(requestedSection)?.id ?? sectionFromLocation());
  const active = guideSection(activeId) ?? GUIDE_SECTIONS[0];
  const content = GUIDE_CONTENT[active.id];

  /* A Command-K selection asks the guide to open a section; deep links and
     Back/Forward read the same URL, so there is one source of truth. */
  useEffect(() => {
    const requested = guideSection(requestedSection);
    if (!requested) return;
    setActiveId(requested.id);
    window.history.pushState(window.history.state, '', guideSectionPath(requested.id));
  }, [requestedSection]);

  useEffect(() => {
    const onPopState = () => setActiveId(sectionFromLocation());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const selectSection = (event: MouseEvent<HTMLAnchorElement>, id: GuideSectionId) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setActiveId(id);
    window.history.pushState(window.history.state, '', guideSectionPath(id));
  };

  const openView = (event: MouseEvent<HTMLAnchorElement>, view: WorkspaceView) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate?.(view);
  };

  const renderBlock = (block: GuideBlock, index: number) => {
    if (block.kind === 'paragraph') return <p key={index}>{block.text}</p>;
    if (block.kind === 'steps') return <ol key={index}>{block.items.map((item) => <li key={item}>{item}</li>)}</ol>;
    if (block.kind === 'bullets') return <ul key={index}>{block.items.map((item) => <li key={item}>{item}</li>)}</ul>;
    if (block.kind === 'note') return <p className="help-note" key={index}>{block.text}</p>;
    /* Link only with a true deployment signal; otherwise the guide explains
       that this deployment keeps the reference private. */
    return shouldShowApiReference({ authenticated: true, api_docs_enabled: apiDocsEnabled })
      ? <p className="help-api-link" key={index}>{block.enabledText} <a href="/docs" target="_blank" rel="noreferrer">Abrir referencia API</a></p>
      : <p className="help-note" key={index}>{block.disabledText}</p>;
  };

  const visibleLinks = (content.links ?? []).filter((link) => hasWorkspaceAccess(link.view, permissions));

  return <div className="help-workspace">
    <nav className="help-nav" aria-label="Secciones de la guía">
      <p className="eyebrow">GUÍA DE PRODUCTO</p>
      <ul>
        {GUIDE_SECTIONS.map((section) => <li key={section.id}>
          <a
            href={guideSectionPath(section.id)}
            className={'help-nav-link' + (section.id === active.id ? ' is-active' : '')}
            aria-current={section.id === active.id ? 'true' : undefined}
            onClick={(event) => selectSection(event, section.id)}
          >{section.title}<small>{GUIDE_GROUP_LABELS[section.group]}</small></a>
        </li>)}
      </ul>
    </nav>
    <article className="help-content" aria-labelledby={`help-section-${active.id}`}>
      <p className="eyebrow">{GUIDE_GROUP_LABELS[active.group]}</p>
      <h3 id={`help-section-${active.id}`}>{active.title}</h3>
      <p className="help-summary">{active.summary}</p>
      <p className="help-owner">Responsable: {active.owner} · Se actualiza: {active.updateRule}</p>
      {content.blocks.map(renderBlock)}
      {visibleLinks.length ? <p className="help-links">
        <strong>Abrir en DS Hub:</strong>
        {visibleLinks.map((link) => <a
          key={link.view}
          href={workspacePath(link.view)}
          onClick={(event) => openView(event, link.view)}
        >{link.label}</a>)}
      </p> : null}
    </article>
  </div>;
}
