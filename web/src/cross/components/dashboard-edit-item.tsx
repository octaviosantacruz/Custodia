import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, Copy, EllipsisVertical, GripVertical, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { usePopover } from '../hooks/use-popover';
import { DASHBOARD_SIZE_LABELS, type DashboardWidgetSize } from '../lib/dashboard-layout';
import type { ChartMode } from '../lib/chart-mode';
import { ChartModeSwitch } from './chart-mode-switch';
import './dashboard-edit-item.css';

const SIZE_OPTIONS: DashboardWidgetSize[] = ['sm', 'md', 'lg'];
const SETTINGS_OPEN_EVENT = 'dashboard-settings-open';

export function DashboardEditToolbar({ label, hint, dirty, saving, onCancel, onSave }: {
  label: string;
  hint?: string;
  dirty: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return <div className="dashboard-edit-bar" role="toolbar" aria-label={label}>
    <span>{dirty ? 'Cambios sin guardar' : 'Sin cambios'}{hint ? ` · ${hint}` : ''}</span>
    <button type="button" className="button subtle" onClick={onCancel} disabled={saving}>Cancelar</button>
    <button type="button" className="button primary" onClick={onSave} disabled={saving || !dirty}>{saving ? 'Guardando…' : 'Guardar vista'}</button>
  </div>;
}

/** Side panel with everything configurable about one block: presentation, size and the tool's own settings (`children`). */
function DashboardSettingsPanel({ id, title, size, showSize, saving, mode, onMode, onSize, onClose, children }: {
  id: string;
  title: string;
  size?: DashboardWidgetSize;
  showSize: boolean;
  saving: boolean;
  mode?: ChartMode;
  onMode?: (mode: ChartMode) => void;
  onSize: (id: string, size: DashboardWidgetSize) => void;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  /* The panel starts under the edit bar so "Guardar vista" and "Cancelar" stay reachable while it is open. */
  const [top, setTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const bar = document.querySelector('.dashboard-edit-bar');
      setTop(bar ? Math.max(0, Math.round(bar.getBoundingClientRect().bottom + 8)) : null);
    };
    place();
    window.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place); window.removeEventListener('resize', place); };
  }, []);
  return <div ref={panelRef} className="dashboard-settings-panel" style={top === null ? undefined : { top }} role="dialog" aria-modal="false" aria-label={`Configurar ${title}`}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    <div className="dashboard-settings-head">
      <div><small>Configurar</small><h3>{title}</h3></div>
      <button ref={closeRef} type="button" className="icon-button" aria-label="Cerrar configuración" onClick={onClose}><X size={16} /></button>
    </div>
    <div className="dashboard-settings-body">
      {mode && onMode ? <section><h4>Presentación</h4><ChartModeSwitch value={mode} onChange={onMode} label={`Presentación de ${title}`} disabled={saving} /></section> : null}
      {showSize && size ? <section><h4>Tamaño</h4>
        <div className="dashboard-widget-size" role="group" aria-label={`Tamaño de ${title}`}>
          {SIZE_OPTIONS.map((option) => <button key={option} type="button" className={`dashboard-size-chip ${size === option ? 'selected' : ''}`.trim()} aria-pressed={size === option} disabled={saving} onClick={() => onSize(id, option)}><strong>{DASHBOARD_SIZE_LABELS[option]}</strong></button>)}
        </div>
      </section> : null}
      {children}
    </div>
    <div className="dashboard-settings-foot"><button type="button" className="button primary" onClick={onClose}>Listo</button></div>
  </div>;
}

export function DashboardEditItem({ id, title, index, count, size, saving, showSize = true, style, mode, onMode, onMove, onMoveBefore, onSize, onRemove, onDuplicate, onAnnounce, settings, openSettingsOnMount = false, onSettingsChange, children }: {
  id: string;
  title: string;
  index: number;
  count: number;
  size?: DashboardWidgetSize;
  saving: boolean;
  showSize?: boolean;
  style?: React.CSSProperties;
  /** Donut or bars, for category charts only. */
  mode?: ChartMode;
  onMode?: (mode: ChartMode) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onMoveBefore: (draggedId: string, targetId: string) => void;
  onSize: (id: string, size: DashboardWidgetSize) => void;
  onRemove: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onAnnounce: (message: string) => void;
  /** The tool's own settings (name, filters, preview), shown inside the side panel. */
  settings?: React.ReactNode;
  /** A block that was just created opens its settings straight away. */
  openSettingsOnMount?: boolean;
  onSettingsChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  const [configuring, setConfiguring] = useState(openSettingsOnMount);
  const configureRef = useRef<HTMLButtonElement>(null);
  const menu = usePopover<HTMLDivElement>({ fallbackFocusRef: configureRef });
  const menuId = useId();

  useEffect(() => {
    const closeWhenAnotherOpens = (event: Event) => { if ((event as CustomEvent<string>).detail !== id) setConfiguring(false); };
    window.addEventListener(SETTINGS_OPEN_EVENT, closeWhenAnotherOpens);
    return () => window.removeEventListener(SETTINGS_OPEN_EVENT, closeWhenAnotherOpens);
  }, [id]);
  const openSettings = () => { window.dispatchEvent(new CustomEvent(SETTINGS_OPEN_EVENT, { detail: id })); setConfiguring(true); onSettingsChange?.(true); };
  const closeSettings = () => { setConfiguring(false); onSettingsChange?.(false); requestAnimationFrame(() => configureRef.current?.focus()); };
  const choose = (action: () => void) => () => { menu.setOpen(false); action(); };

  return <div
    className={`dashboard-edit-item${size ? ` size-${size}` : ''}${dragging ? ' dragging' : ''}${configuring ? ' configuring' : ''}`}
    style={style}
    draggable
    onDragStart={(event) => { setDragging(true); event.dataTransfer.setData('text/plain', id); event.dataTransfer.effectAllowed = 'move'; }}
    onDragEnd={() => setDragging(false)}
    onDragOver={(event) => event.preventDefault()}
    onDrop={(event) => { event.preventDefault(); setDragging(false); const dragged = event.dataTransfer.getData('text/plain'); if (dragged) onMoveBefore(dragged, id); }}
    tabIndex={0}
    role="listitem"
    aria-label={`${title}, posición ${index + 1} de ${count}`}
    onKeyDown={(event) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); onMove(id, -1); onAnnounce(`${title} movido a la posición ${Math.max(1, index)}`); }
      else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); onMove(id, 1); onAnnounce(`${title} movido a la posición ${Math.min(count, index + 2)}`); }
    }}
  >
    <div className="dashboard-edit-controls">
      <span className="dashboard-edit-handle" aria-hidden="true"><GripVertical size={14} /></span>
      <strong className="dashboard-edit-title">{title}</strong>
      <button ref={configureRef} type="button" className="button subtle dashboard-edit-configure" aria-label={`Configurar ${title}`} aria-haspopup="dialog" aria-expanded={configuring} disabled={saving} onClick={() => (configuring ? closeSettings() : openSettings())}><SlidersHorizontal size={13} aria-hidden="true" /> Configurar</button>
      <div className="dashboard-edit-menu" ref={menu.ref}>
        <button type="button" className="icon-button" aria-label={`Más acciones de ${title}`} aria-haspopup="menu" aria-expanded={menu.open} aria-controls={menu.open ? menuId : undefined} disabled={saving} onClick={() => menu.setOpen((current) => !current)}><EllipsisVertical size={15} aria-hidden="true" /></button>
        {menu.open ? <div className="dashboard-edit-menu-list" id={menuId} role="menu" aria-label={`Acciones de ${title}`}>
          {onDuplicate ? <button type="button" role="menuitem" aria-label={`Duplicar ${title}`} onClick={choose(() => onDuplicate(id))}><Copy size={14} aria-hidden="true" /> Duplicar</button> : null}
          <button type="button" role="menuitem" aria-label={`Mover ${title} arriba`} disabled={index === 0} onClick={choose(() => onMove(id, -1))}><ChevronUp size={14} aria-hidden="true" /> Mover arriba</button>
          <button type="button" role="menuitem" aria-label={`Mover ${title} abajo`} disabled={index === count - 1} onClick={choose(() => onMove(id, 1))}><ChevronDown size={14} aria-hidden="true" /> Mover abajo</button>
          <button type="button" role="menuitem" className="danger" aria-label={`Quitar ${title}`} onClick={choose(() => onRemove(id))}><Trash2 size={14} aria-hidden="true" /> Quitar</button>
        </div> : null}
      </div>
    </div>
    <div className="dashboard-edit-content" inert>{children}</div>
    {configuring ? createPortal(<DashboardSettingsPanel id={id} title={title} size={size} showSize={showSize} saving={saving} mode={mode} onMode={onMode} onSize={onSize} onClose={closeSettings}>{settings}</DashboardSettingsPanel>, document.body) : null}
  </div>;
}
