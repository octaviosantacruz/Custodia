import type { MouseEvent } from 'react';
import { areaOf, domainMeta, domainWorkspaces } from '../lib/domains';
import { canonicalRecentWorkspace, hasWorkspaceAccess, workspacePath, type WorkspaceView } from '../lib/workspaces';
import { WORKSPACE_META } from '../lib/workspace-meta';
import './section-nav.css';

type Props = {
  workspaceView: WorkspaceView;
  permissions: string[];
  onNavigate: (view: WorkspaceView) => void;
};

/** Keep ordinary links usable for new tabs; the shell owns in-app history. */
export function navigateInApp(event: MouseEvent<HTMLAnchorElement>, navigate: () => void) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate();
}

/** UX-NAV-001: the views of a tool that declares `sectionNav`, above the page title. */
export function SectionNav({ workspaceView, permissions, onNavigate }: Props) {
  const area = areaOf(workspaceView);
  const active = canonicalRecentWorkspace(workspaceView);
  return <nav className="section-nav" aria-label={t('Secciones de {product}', { product: domainMeta(area).product.label })}>
    {domainWorkspaces(area).filter((view) => hasWorkspaceAccess(view, permissions)).map((view) => {
      const meta = WORKSPACE_META[view];
      const selected = view === active;
      const cardId = `section-nav-card-${view}`;
      return <a key={view} href={workspacePath(view)} aria-current={selected ? 'page' : undefined} aria-label={meta.label} aria-describedby={cardId}
        onClick={(event) => navigateInApp(event, () => { if (!selected) onNavigate(view); })}>
        {meta.icon}<span>{meta.label}</span>
        {/* The question each view answers stays one hover or focus away. */}
        <span className="section-nav-card" id={cardId} role="tooltip"><strong>{meta.label}</strong><small>{meta.detail}</small></span>
      </a>;
    })}
  </nav>;
}

import { t } from '../i18n/index.ts';