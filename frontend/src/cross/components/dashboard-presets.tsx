import { LayoutTemplate, RotateCcw, Trash2 } from 'lucide-react';
import { usePopover } from '../hooks/use-popover';
import type { DashboardTeamTemplate } from '../lib/dashboard-team-templates-api';
import './dashboard-widget.css';

export type DashboardPresetOption = {
  id: string;
  label: string;
  description: string;
};

/** "Vistas iniciales" menu shared by both boards (VIEW-003): pick a role
 * preset or restore the source defaults. The caller owns the confirmation
 * dialog and the save, so choosing an option never replaces the saved view
 * on its own. */
export function DashboardPresetMenu<T extends DashboardPresetOption, W = unknown>({ presets, teamTemplates = [], disabled = false, onSelect, onTeamSelect, onReset, onClear }: {
  presets: readonly T[];
  teamTemplates?: DashboardTeamTemplate<W>[];
  disabled?: boolean;
  onSelect: (preset: T) => void;
  onTeamSelect?: (template: DashboardTeamTemplate<W>) => void;
  onReset: () => void;
  onClear: () => void;
}) {
  const { open, setOpen, ref } = usePopover<HTMLDivElement>();
  return <div className="dashboard-preset-menu" ref={ref}>
    <button type="button" className="button subtle" aria-haspopup="menu" aria-expanded={open} disabled={disabled} title="Aplicar una vista inicial por rol" onClick={() => setOpen((current) => !current)}><LayoutTemplate size={14} aria-hidden="true" /> Vistas iniciales</button>
    {open ? <div className="dashboard-preset-popover" role="menu" aria-label="Vistas iniciales">
      {presets.map((preset) => <button key={preset.id} type="button" role="menuitem" disabled={disabled} onClick={() => { setOpen(false); onSelect(preset); }}>
        <span><strong>{preset.label}</strong><small>{preset.description}</small></span>
      </button>)}
      {teamTemplates.map((template) => <button key={`team-${template.role_code}`} type="button" role="menuitem" disabled={disabled} onClick={() => { setOpen(false); onTeamSelect?.(template); }}>
        <span><strong>{template.role_name}</strong><small>Vista de equipo · versión {template.version}</small></span>
      </button>)}
      <button type="button" role="menuitem" className="dashboard-preset-reset" disabled={disabled} onClick={() => { setOpen(false); onReset(); }}>
        <RotateCcw size={14} aria-hidden="true" /><span><strong>Restablecer a predeterminada</strong><small>Vuelve a los bloques por defecto de esta fuente.</small></span>
      </button>
      <button type="button" role="menuitem" className="dashboard-preset-reset" disabled={disabled} onClick={() => { setOpen(false); onClear(); }}>
        <Trash2 size={14} aria-hidden="true" /><span><strong>Vaciar vista</strong><small>Quita todos los bloques para armarla desde cero.</small></span>
      </button>
    </div> : null}
  </div>;
}
