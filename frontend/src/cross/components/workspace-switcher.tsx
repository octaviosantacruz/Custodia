import { WORKSPACE_TOOL_LABELS } from '../../sources';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  Check, ChevronDown, LoaderCircle, Save, Settings2, SlidersHorizontal, Star, X,
} from 'lucide-react';
import { usePopover } from '../hooks/use-popover';
import { CustodiaMark } from './home-workspace';
import { areaOf, domainMeta, domains, domainWorkspaces, quickAccessLimit, type Domain } from '../lib/domains';
import {
  canonicalWorkspaceList, hasWorkspaceAccess, workspacePath, type WorkspaceView,
  canonicalRecentWorkspace,
} from '../lib/workspaces';
import { WORKSPACE_META } from '../lib/workspace-meta';
import type { WorkspacePreferences } from '../lib/workspace-preferences-api';
import './workspace-switcher.css';

type WorkspaceSwitcherProps = {
  isHome?: boolean;
  workspaceView: WorkspaceView;
  permissions: string[];
  onWorkspaceChange: (view: WorkspaceView) => void;
  preferences: WorkspacePreferences;
  onPreferencesChange: (next: Partial<Pick<WorkspacePreferences, 'visible_workspaces' | 'hidden_workspaces' | 'recent_workspaces'>>) => Promise<void>;
  /* UX-NAV-001: the tool shows its own views as a bar, so this menu only keeps
     pinned and recent views across every tool. */
  crossTool?: boolean;
};

// Each logo has a variant per theme (same approach as home-workspace.tsx):
// the white Netskope mark is invisible on the light surface otherwise.
const PRODUCT_MARKS: Record<Domain, { label: string; image?: { dark: string; light: string }; fallback: string }> = {
  pam: { label: domainMeta('pam').product.label, image: { dark: '/cyberark-logo-mint.png', light: '/cyberark-logo-dark.png' }, fallback: 'C' },
  dlp: { label: domainMeta('dlp').product.label, image: { dark: '/netskope-full-mint.png', light: '/netskope-full-black.png' }, fallback: 'N' },
  cross: { label: 'Conexiones', fallback: 'C' },
  admin: { label: 'Administración', fallback: 'A' },
  dspm: { label: 'BigID DSPM', fallback: 'B' },
};

function ProductMark({ view, compact = false }: { view: WorkspaceView; compact?: boolean }) {
  const product = PRODUCT_MARKS[areaOf(view)];
  return <span className={'workspace-product-mark' + (compact ? ' compact' : '')} title={WORKSPACE_TOOL_LABELS[view]}>
    {areaOf(view) === 'cross' ? <CustodiaMark size={compact ? 16 : 18} /> : areaOf(view) === 'admin' ? <SlidersHorizontal size={compact ? 14 : 16} aria-hidden="true" /> : product.image ? <>
      <img className="workspace-product-logo-on-dark" src={product.image.dark} alt="" />
      <img className="workspace-product-logo-on-light" src={product.image.light} alt="" />
    </> : <span aria-hidden="true">{product.fallback}</span>}
    {!compact && <small>{WORKSPACE_TOOL_LABELS[view]}</small>}
  </span>;
}

function WorkspaceLink({ view, active, onSelect, showProduct = false }: { view: WorkspaceView; active?: boolean; onSelect: (view: WorkspaceView) => void; showProduct?: boolean }) {
  const meta = WORKSPACE_META[view];
  const navigateInApp = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onSelect(view);
  };
  return <a
    href={workspacePath(view)}
    className={'workspace-domain-link' + (active ? ' active' : '')}
    aria-current={active ? 'page' : undefined}
    aria-label={showProduct ? `${WORKSPACE_TOOL_LABELS[view]} · ${meta.label} · ${meta.detail}` : undefined}
    title={`Abrir ${meta.label}: ${meta.detail}`}
    onClick={navigateInApp}
  >
    {showProduct && <ProductMark view={view} compact />}
    <span className="workspace-domain-link-icon">{meta.icon}</span>
    <span className="workspace-domain-link-text"><strong>{meta.label}</strong><small>{meta.detail}</small></span>
  </a>;
}

export function WorkspaceSwitcher({ isHome = false, workspaceView, permissions, onWorkspaceChange, preferences, onPreferencesChange, crossTool = false }: WorkspaceSwitcherProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { open, setOpen, ref } = usePopover<HTMLDivElement>({ fallbackFocusRef: triggerRef });
  const menuRef = useRef<HTMLElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<WorkspaceView[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const activeDomain = areaOf(workspaceView);
  const workspaceVisible = (view: WorkspaceView) => hasWorkspaceAccess(view, permissions);
  const pickWorkspace = (view: WorkspaceView) => {
    onWorkspaceChange(view);
    setOpen(false);
    setEditing(false);
  };
  const allTopLevelWorkspaces = domains.flatMap(({ id }) => domainWorkspaces(id));
  const allAvailable = allTopLevelWorkspaces.filter(workspaceVisible);
  const available = domainWorkspaces(activeDomain).filter(workspaceVisible);
  const activeProduct = PRODUCT_MARKS[activeDomain];
  const isTopLevelWorkspace = (view: WorkspaceView) => domainWorkspaces(areaOf(view)).includes(view);
  const configuredQuickAccess = canonicalWorkspaceList(preferences.visible_workspaces);
  const limit = quickAccessLimit();
  const allQuickAccess = configuredQuickAccess.filter((view) => allAvailable.includes(view)).slice(0, limit);
  const scope = crossTool ? allAvailable : available;
  const quickAccess = allQuickAccess.filter((view) => scope.includes(view));
  const recent = canonicalWorkspaceList(preferences.recent_workspaces)
    .filter((view) => scope.includes(view) && !quickAccess.includes(view) && (isHome || view !== canonicalRecentWorkspace(workspaceView)))
    .slice(0, 4);
  const triggerLabel = isHome ? 'Inicio' : WORKSPACE_META[canonicalRecentWorkspace(workspaceView)].label;
  const dirty = draft.length !== allQuickAccess.length || draft.some((view, index) => view !== allQuickAccess[index]);

  const beginEditing = () => {
    setDraft(allQuickAccess);
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
    setDraft((current) => {
      if (current.includes(view)) return current.filter((item) => item !== view);
      return current.length < limit ? [...current, view] : current;
    });
  };
  const saveDraft = async () => {
    const visible_workspaces = draft;
    const hiddenElsewhere = canonicalWorkspaceList(preferences.hidden_workspaces).filter((view) => isTopLevelWorkspace(view) && !allAvailable.includes(view));
    const hidden_workspaces = [...hiddenElsewhere, ...allAvailable.filter((view) => !draft.includes(view))];
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
    {crossTool ? <button ref={triggerRef} className={'workspace-switcher-trigger' + (open ? ' active' : '')} type="button" aria-label="Abrir accesos rápidos" aria-expanded={open} title="Vistas fijadas y recientes de todas las herramientas" onClick={() => setOpen((current) => !current)}>
      <Star size={14} aria-hidden /><span>Accesos rápidos</span><ChevronDown size={15} aria-hidden />
    </button> : <button ref={triggerRef} className={'workspace-switcher-trigger' + (open ? ' active' : '')} type="button" aria-label={`Cambiar workspace. Actual: ${triggerLabel}`} aria-expanded={open} title="Cambiar de workspace" onClick={() => setOpen((current) => !current)}>
      <span>{triggerLabel}</span><ChevronDown size={15} aria-hidden />
    </button>}
    {open && <section className="workspace-menu" aria-label="Workspaces" ref={menuRef}>
      {editing ? <div ref={editorRef} className="workspace-preferences-editor" role="dialog" aria-labelledby="workspace-editor-title" tabIndex={-1}>
        <div className="workspace-editor-header">
          <div><strong id="workspace-editor-title">Accesos rápidos</strong><span>Personalizá accesos de todas las herramientas.</span></div>
          <button className="workspace-editor-close" type="button" aria-label="Cancelar edición" onClick={closeEditing} disabled={saving}><X size={16} /></button>
        </div>
        <div className="workspace-editor-limit"><span>{draft.length} seleccionados</span><small>Hasta {limit}</small></div>
        <div className="workspace-editor-options">
          {allAvailable.map((view) => {
            const selected = draft.includes(view);
            const disabled = !selected && draft.length >= limit;
            return <label key={view} className={'workspace-editor-option' + (selected ? ' selected' : '') + (disabled ? ' disabled' : '')}>
              <input type="checkbox" checked={selected} disabled={disabled || saving} onChange={() => toggleDraft(view)} />
              <span className="workspace-editor-check" aria-hidden>{selected ? <Check size={13} /> : null}</span>
              <ProductMark view={view} />
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
          {crossTool
            ? <div><strong>Accesos rápidos</strong><span>Tus vistas de cualquier herramienta.</span></div>
            : <div><strong>Vistas de {activeProduct.label}</strong><span>Para cambiar de herramienta, usá el selector anterior.</span></div>}
        </div>
        {quickAccess.length ? <>
          <p className="workspace-menu-section-label">Vistas rápidas</p>
          <div className="workspace-domain-nav" data-section="quick-access">
            {quickAccess.map((view) => <WorkspaceLink key={view} view={view} active={!isHome && view === workspaceView} onSelect={pickWorkspace} showProduct={crossTool} />)}
          </div>
        </> : <button className="workspace-quick-empty-action" type="button" onClick={beginEditing}><Settings2 size={14} /><span><strong>Fijar vistas rápidas</strong><small>Guardá tus accesos frecuentes{crossTool ? ' de cualquier herramienta' : ` de ${activeProduct.label}`}.</small></span></button>}
        {recent.length ? <><p className="workspace-menu-section-label">Recientes</p><div className="workspace-domain-nav" data-section="recent">{recent.map((view) => <WorkspaceLink key={view} view={view} onSelect={pickWorkspace} showProduct={crossTool} />)}</div></> : null}
        {crossTool ? null : <>
          <p className="workspace-menu-section-label">Todas las vistas de {activeProduct.label}</p>
          <div className="workspace-domain-nav" data-section="tool-workspaces">
            {available.map((view) => <WorkspaceLink key={view} view={view} active={!isHome && view === workspaceView} onSelect={pickWorkspace} />)}
          </div>
        </>}
        {quickAccess.length ? <div className="workspace-preferences">
          <button className="workspace-preferences-trigger" type="button" onClick={beginEditing}><Settings2 size={14} /> Editar vistas rápidas</button>
        </div> : null}
      </>}
    </section>}
  </div>;
}
