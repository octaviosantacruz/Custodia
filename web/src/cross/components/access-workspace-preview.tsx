import { useMemo } from 'react';
import { CATALOG_ENTRIES } from '../lib/workspace-catalog';
import { domainAccessible, domainMeta } from '../lib/domains';
import { hasWorkspaceAccess } from '../lib/workspaces';
import './access-workspace-preview.css';
import { t } from '../i18n/index.ts';

/** The shell's own gates, evaluated against a draft rather than the viewer. */
export function AccessWorkspacePreview({ codes, unavailable, label = 'Vistas del menú' }: { codes: string[]; unavailable?: string; label?: string }) {
  const groups = useMemo(() => {
    const visible = CATALOG_ENTRIES.filter((entry) => entry.catalog && entry.switcher && domainAccessible(entry.domain, codes) && hasWorkspaceAccess(entry.id, codes));
    return [...new Set(visible.map((entry) => entry.domain))].map((domain) => ({
      domain, name: domainMeta(domain).label, views: visible.filter((entry) => entry.domain === domain),
    }));
  }, [codes]);
  return <section className="access-workspace-preview" aria-label={label}>
    <h3>{label}</h3>
    {unavailable ? <p>{unavailable}</p> : <>
      <dl>{groups.map((group) => <div key={group.domain}><dt>{group.name}</dt><dd>{group.views.map((view) => <span key={view.id}>{view.label}</span>)}</dd></div>)}</dl>
      {!groups.length && <p>{t('Sin vistas disponibles.')}</p>}
      <p>{t('Según estos permisos, sin otros roles ni preferencias personales. Cada función conserva sus permisos sobre datos.')}</p>
    </>}
  </section>;
}
