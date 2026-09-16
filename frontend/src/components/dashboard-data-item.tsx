import { ArrowRight, CircleHelp } from 'lucide-react';
import { usePopover } from '../hooks/use-popover';
import { dashboardValueLabel, dashboardWidgetDetail, dashboardWidgetExplanation, type DashboardWidget } from '../lib/dashboard-metrics';

type DashboardDataItemProps = {
  widget: DashboardWidget;
  onNavigate: (widget: DashboardWidget) => void;
};

export function DashboardDataItem({ widget, onNavigate }: DashboardDataItemProps) {
  const { open, setOpen, ref } = usePopover<HTMLDivElement>();
  const explanation = dashboardWidgetExplanation(widget);
  const tooltipId = `dashboard-data-help-${widget.widget_id}`;
  return <article className="dashboard-data-item" ref={ref}>
    <button type="button" className="dashboard-data-open" onClick={() => onNavigate(widget)} aria-label={`${widget.title}: ${dashboardValueLabel(widget)}. Abrir resultados`} title={`Abrir el inventario que compone ${widget.title}`}>
      <span>{widget.title}</span><strong>{dashboardValueLabel(widget)}</strong><small>{dashboardWidgetDetail(widget)}</small><ArrowRight size={14} aria-hidden />
    </button>
    <button type="button" className={`dashboard-data-help ${open ? 'active' : ''}`.trim()} aria-label={`Explicar ${widget.title}`} aria-controls={tooltipId} aria-expanded={open} title={`Explicar cómo se calcula ${widget.title}`} onClick={() => setOpen((current) => !current)}><CircleHelp size={15} aria-hidden /></button>
    {open && <section className="dashboard-data-tooltip" id={tooltipId} role="tooltip">
      <strong>{widget.title}</strong><p><b>Qué incluye:</b> {explanation.includes}</p><p><b>Fuente:</b> {explanation.source}</p><p><b>Para investigar:</b> {explanation.next}</p>
    </section>}
  </article>;
}
