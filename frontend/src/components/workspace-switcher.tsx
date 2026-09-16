import { useEffect, useRef, useState } from 'react';
import {
  Check, ChevronDown, LoaderCircle, Save, Settings2, X,
} from 'lucide-react';
import { usePopover } from '../hooks/use-popover';
import { domainMeta, domainOf, domainWorkspaces } from '../lib/domains';
import {
  canonicalWorkspaceList, categorizedWorkspaces, hasWorkspaceAccess, type WorkspaceView,
} from '../lib/workspaces';
import { WORKSPACE_META } from '../lib/workspace-meta';
import { MAX_QUICK_ACCESS_PER_DOMAIN, type WorkspacePreferences } from '../lib/workspace-preferences-api';

type WorkspaceSwitcherProps = {
  isHome?: boolean;
  workspaceView: WorkspaceView;
  permissions: string[];
  onWorkspaceChange: (view: WorkspaceView) => void;
  preferences: WorkspacePreferences;
  onPreferencesChange: (next: Partial<Pick<WorkspacePreferences, 'visible_workspaces' | 'hidden_workspaces' | 'recent_workspaces'>>) => Promise<void>;
};

function WorkspaceLink({ view, active, onSelect }: { view: WorkspaceView; active?: boolean; onSelect: (view: WorkspaceView) => void }) {
  const meta = WORKSPACE_META[view];
  return <button
    type="button"
    className={'workspace-domain-link' + (active ? ' active' : '')}
    aria-current={active ? 'page' : undefined}
    title={`Abrir ${meta.label}: ${meta.detail}`}
    onClick={() => onSelect(view)}
  >
    <span className="workspace-domain-link-icon">{meta.icon}</span>
    <span className="workspace-domain-link-text"><strong>{meta.label}</strong><small>{meta.detail}</small></span>
  </button>;
}

export function WorkspaceSwitcher({ isHome = false, workspaceView, permissions, onWorkspaceChange, preferences, onPreferencesChange }: WorkspaceSwitcherProps) {
  const { open, setOpen, ref } = usePopover<HTMLDivElement>();
  const menuRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<WorkspaceView[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const activeDomain = domainOf(workspaceView);
  const currentDomain = domainMeta(activeDomain);
  const workspaceVisible = (view: WorkspaceView) => hasWorkspaceAccess(view, permissions);
  const pickWorkspace = (view: WorkspaceView) => {
    onWorkspaceChange(view);
    setOpen(false);
    setEditing(false);
  };
  const available = domainWorkspaces(activeDomain).filter(workspaceVisible);
  const isTopLevelWorkspace = (view: WorkspaceView) => domainWorkspaces(domainOf(view)).includes(view);
  const configuredQuickAccess = canonicalWorkspaceList(preferences.visible_workspaces);
  const quickAccess = configuredQuickAccess.filter((view) => available.includes(view));
  const recent = canonicalWorkspaceList(preferences.recent_workspaces).filter((view) => available.includes(view) && !quickAccess.includes(view));
  const browseViews = available.filter((view) => !quickAccess.includes(view) && !recent.includes(view));
  const browseCategories = categorizedWorkspaces(browseViews);
  const visibleElsewhere = configuredQuickAccess.filter((view) =>
    isTopLevelWorkspace(view) && !available.includes(view) && hasWorkspaceAccess(view, permissions),
  );
  const availableSlots = MAX_QUICK_ACCESS_PER_DOMAIN;
  const dirty = draft.length !== quickAccess.length || draft.some((view, index) => view !== quickAccess[index]);

  const beginEditing = () => {
    setDraft(quickAccess);
    setSaveError('');
    setEditing(true);
    requestAnimationFrame(() => menuRef.current?.scrollTo({ top: 0 }));
  };
  const closeEditing = () => {
    setEditing(false);
    setSaveError('');
    requestAnimationFrame(() => triggerRef.current?.focus());
  };
  useEffect(() => {
    if (editing) editorRef.current?.focus();
  }, [editing]);
  useEffect(() => {
    if (!open && editing) {
      setEditing(false);
      setSaveError('');
    }
  }, [editing, open]);
  const toggleDraft = (view: WorkspaceView) => {
    setSaveError('');
    setDraft((current) => current.includes(view)
      ? current.filter((item) => item !== view)
      : current.length < availableSlots ? [...current, view] : current);
  };
  const saveDraft = async () => {
    const visible_workspaces = [...visibleElsewhere, ...draft];
    const hiddenElsewhere = canonicalWorkspaceList(preferences.hidden_workspaces).filter((view) => isTopLevelWorkspace(view) && !available.includes(view));
    const hidden_workspaces = [...hiddenElsewhere, ...available.filter((view) => !draft.includes(view))];
    setSaving(true);
    setSaveError('');
    try {
      await onPreferencesChange({ visible_workspaces, hidden_workspaces });
      closeEditing();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'No se pudieron guardar los accesos rápidos');
    } finally {
      setSaving(false);
    }
  };

  return <div className="workspace-launcher" ref={ref}>
    <button ref={triggerRef} className={'workspace-switcher-trigger' + (open ? ' active' : '')} type="button" aria-label={`Cambiar workspace. Actual: ${isHome ? 'Inicio' : WORKSPACE_META[workspaceView].label}`} aria-expanded={open} title="Cambiar de workspace" onClick={() => setOpen((current) => !current)}>
      <span>{isHome ? 'Inicio' : WORKSPACE_META[workspaceView].label}</span><ChevronDown size={15} aria-hidden />
    </button>
    {open && <section className="workspace-menu" aria-label="Workspaces" ref={menuRef}>
      {editing ? <div ref={editorRef} className="workspace-preferences-editor" role="dialog" aria-labelledby="workspace-editor-title" tabIndex={-1}>
        <div className="workspace-editor-header">
          <div><strong id="workspace-editor-title">Accesos rápidos</strong><span>Personalizá las vistas de {currentDomain.label}.</span></div>
          <button className="workspace-editor-close" type="button" aria-label="Cancelar edición" onClick={closeEditing} disabled={saving}><X size={16} /></button>
        </div>
        <div className="workspace-editor-limit"><span>{draft.length} de {availableSlots} disponibles aquí</span>{visibleElsewhere.length ? <small>{visibleElsewhere.length} guardados en otra herramienta</small> : null}</div>
        <div className="workspace-editor-options">
          {available.map((view) => {
            const selected = draft.includes(view);
            const disabled = !selected && draft.length >= availableSlots;
            return <label key={view} className={'workspace-editor-option' + (selected ? ' selected' : '') + (disabled ? ' disabled' : '')}>
              <input type="checkbox" checked={selected} disabled={disabled || saving} onChange={() => toggleDraft(view)} />
              <span className="workspace-editor-check" aria-hidden>{selected ? <Check size={13} /> : null}</span>
              <span className="workspace-editor-option-copy"><strong>{WORKSPACE_META[view].label}</strong><small>{WORKSPACE_META[view].detail}</small></span>
            </label>;
          })}
        </div>
        {saveError ? <p className="workspace-editor-error" role="alert">{saveError}</p> : null}
        <div className="workspace-editor-actions">
          <button className="button subtle" type="button" onClick={closeEditing} disabled={saving}>Cancelar</button>
          <button className="button primary" type="button" onClick={() => void saveDraft()} disabled={!dirty || saving}>
            {saving ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}{saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div> : <>
        <div className="workspace-menu-header">
          <div><strong>Vistas de {currentDomain.label}</strong><span>Elegí qué querés revisar.</span></div>
        </div>
        <p className="workspace-menu-section-label">Acceso rápido</p>
        <div className="workspace-domain-nav" data-section="quick-access">
        {quickAccess.length ? quickAccess.map((view) => <WorkspaceLink key={view} view={view} active={!isHome && view === workspaceView} onSelect={pickWorkspace} />) : <p className="workspace-quick-empty">Todavía no fijaste vistas de esta herramienta.</p>}
        </div>
        {recent.length ? <><p className="workspace-menu-section-label">Recientes</p><div className="workspace-domain-nav" data-section="recent">{recent.map((view) => <WorkspaceLink key={view} view={view} onSelect={pickWorkspace} />)}</div></> : null}
        {browseCategories.length ? <><p className="workspace-menu-section-label">Más vistas</p>
          <div className="workspace-domain-nav" data-section="tool-workspaces">
            {browseCategories.map((category) => <div key={category.id} className="workspace-browse-category">
              <p className="workspace-menu-section-label">{category.label}</p>
              {category.views.map((view) => <WorkspaceLink key={view} view={view} active={!isHome && view === workspaceView} onSelect={pickWorkspace} />)}
            </div>)}
          </div></> : null}
        <div className="workspace-preferences">
          <button className="workspace-preferences-trigger" type="button" onClick={beginEditing}><Settings2 size={14} /> Personalizar accesos rápidos</button>
        </div>
      </>}
    </section>}
  </div>;
}
