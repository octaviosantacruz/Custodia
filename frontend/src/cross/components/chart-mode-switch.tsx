import { ChartColumn, ChartPie } from 'lucide-react';
import { CHART_MODE_LABELS, type ChartMode } from '../lib/chart-mode';
import './chart-mode-switch.css';

/** Dona / Barras choice for a category chart. Presentation only: the data and its drill stay the same. */
export function ChartModeSwitch({ value, onChange, label, disabled = false }: { value: ChartMode; onChange: (mode: ChartMode) => void; label: string; disabled?: boolean }) {
  return <div className="chart-mode-switch" role="group" aria-label={label}>
    {(['donut', 'bars'] as const).map((mode) => <button key={mode} type="button" disabled={disabled} aria-pressed={value === mode} className={value === mode ? 'selected' : ''} onClick={() => onChange(mode)}>
      {mode === 'donut' ? <ChartPie size={14} aria-hidden="true" /> : <ChartColumn size={14} aria-hidden="true" />}{CHART_MODE_LABELS[mode]}
    </button>)}
  </div>;
}
