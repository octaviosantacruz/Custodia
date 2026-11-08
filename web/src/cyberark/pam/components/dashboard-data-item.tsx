import { DateTime } from '../../../cross/components/date-time';
import { ArrowRight, CircleHelp, KeyRound, Network, ShieldCheck, Users, Vault, type LucideIcon } from 'lucide-react';
import { usePopover } from '../../../cross/hooks/use-popover';
import { dashboardValueLabel, dashboardWidgetDetail, dashboardWidgetExplanation, type DashboardWidget } from '../lib/dashboard-metrics';
import { dateTimeHint, formatNumber } from '../../../cross/lib/format';
import './dashboard-data-item.css';
import { t } from '../../../cross/i18n/index.ts';

type DashboardDataItemProps = {
  widget: DashboardWidget;
  onNavigate: (widget: DashboardWidget) => void;
};

type DataTone = 'success' | 'warning' | 'neutral';

/* Same semantics as the Netskope cards: success = coverage/health, warning =
   a gap or pending work, neutral = a plain count. Icon is the topic. */
export function dashboardDataPresentation(widget: DashboardWidget): { Icon: LucideIcon; tone: DataTone } {
  switch (widget.measure) {
    case 'safe_account_coverage': case 'kr1_safe_bu_coverage': return { Icon: Vault, tone: 'success' };
    case 'kr2_connection_coverage': case 'pam_sia_coverage': case 'zsp_coverage': return { Icon: Network, tone: 'success' };
    case 'account_platform_coverage': return { Icon: KeyRound, tone: 'success' };
    case 'cyberark_compliance': return { Icon: ShieldCheck, tone: 'success' };
    case 'pam_users': case 'pam_roles': return { Icon: Users, tone: 'neutral' };
    case 'sia_policies': case 'connections': return { Icon: Network, tone: 'neutral' };
    case 'accounts': return { Icon: KeyRound, tone: 'neutral' };
    default: return { Icon: Vault, tone: widget.filters?.health_filter || widget.filters?.workflow_status || widget.filters?.classification_status ? 'warning' : 'neutral' };
  }
}

export function DashboardDataItem({ widget, onNavigate }: DashboardDataItemProps) {
  const { open, setOpen, ref } = usePopover<HTMLDivElement>();
  const explanation = dashboardWidgetExplanation(widget);
  const isKr1 = widget.measure === 'safe_account_coverage';
  const calculable = widget.data_status !== 'unavailable' && typeof widget.total_count === 'number' && widget.total_count > 0 && typeof widget.covered_count === 'number';
  const valueLabel = isKr1 && !calculable ? 'No calculable' : dashboardValueLabel(widget);
  const tooltipId = `dashboard-data-help-${widget.widget_id}`;
  const hasDrilldown = widget.measure !== 'cyberark_compliance';
  const drilldownLabel = widget.measure === 'kr1_safe_bu_coverage' ? 'Abrir Safes sin unidad de negocio' : widget.measure === 'safe_account_coverage' ? t('Abrir Safes sin cuentas') : t('Abrir resultados');
  const { Icon, tone } = dashboardDataPresentation(widget);
  const title = <span className="dashboard-data-title"><Icon size={14} aria-hidden="true" />{widget.title}</span>;
  return <article className={`dashboard-data-item tone-${tone}`} data-status={widget.data_status ?? 'available'} ref={ref}>
    {hasDrilldown ? <button type="button" className="dashboard-data-open" onClick={() => onNavigate(widget)} aria-label={`${widget.title}: ${valueLabel}. ${drilldownLabel}`} title={widget.measure === 'kr1_safe_bu_coverage' || widget.measure === 'safe_account_coverage' ? drilldownLabel : `Abrir el inventario que compone ${widget.title}`}>
      {title}<strong>{valueLabel}</strong><small title={widget.measured_at ? dateTimeHint(widget.measured_at) : undefined}>{dashboardWidgetDetail(widget)}</small><ArrowRight size={14} aria-hidden />
    </button> : <div className="dashboard-data-open is-static">{title}<strong>{dashboardValueLabel(widget)}</strong><small title={widget.measured_at ? dateTimeHint(widget.measured_at) : undefined}>{dashboardWidgetDetail(widget)}</small></div>}
    <button type="button" className={`dashboard-data-help ${open ? 'active' : ''}`.trim()} aria-label={`Explicar ${widget.title}`} aria-controls={tooltipId} aria-expanded={open} title={`Explicar cómo se calcula ${widget.title}`} onClick={() => setOpen((current) => !current)}><CircleHelp size={15} aria-hidden /></button>
    {open && <section className="dashboard-data-tooltip" id={tooltipId} role="tooltip">
      <strong>{widget.title}</strong>
      {isKr1 ? <div className="pam-data-reading">
        <span>{t('KR1 · completitud de inventario')}</span>
        <dl>
          <div><dt>{t('Qué mide')}</dt><dd>{t('Safes con al menos una cuenta activa')}</dd></div>
          <div><dt>{t('Población')}</dt><dd>{typeof widget.total_count === 'number' ? `${typeof widget.covered_count === 'number' ? formatNumber(widget.covered_count) : 'Numerador no informado'} de ${formatNumber(widget.total_count)} Safes activos del alcance seleccionado` : 'Población no informada'}</dd></div>
          <div><dt>{t('Período / captura')}</dt><dd><DateTime value={widget.measured_at} missing="Fecha de captura no informada" /></dd></div>
          <div><dt>{t('Fórmula')}</dt><dd>{t('Safes activos con al menos una cuenta activa / total de Safes activos del alcance seleccionado × 100')}</dd></div>
          <div><dt>{t('Fuente')}</dt><dd>{explanation.source}</dd></div>
          <div><dt>{t('Qué no permite concluir')}</dt><dd>{explanation.includes}</dd></div>
        </dl>
        <p>{widget.data_status === 'pending' ? t('Dato pendiente de actualizar. ') : ''}{!calculable ? t('No calculable: falta población o evidencia del numerador. ') : ''}Desconocidos: conteo no informado por esta métrica.</p>
      </div> : <><p><b>{t('Qué incluye:')}</b> {explanation.includes}</p><p><b>{t('Fuente:')}</b> {explanation.source}</p><p><b>{t('Para investigar:')}</b> {explanation.next}</p></>}
    </section>}
  </article>;
}
