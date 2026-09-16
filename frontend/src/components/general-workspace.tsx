import { useState } from 'react';
import { ArrowRight, Plus, SlidersHorizontal } from 'lucide-react';
import { BarList } from './dashboard';
import { PieChart } from './pie-chart';
import { AdvancedChart } from './advanced-chart';
import { DashboardCustomizer } from './dashboard-customizer';
import { StateBlock } from './state-block';
import { DashboardDataItem } from './dashboard-data-item';
import { useDashboardPreferences } from '../hooks/use-dashboard-preferences';
import { dashboardGoalProgress, dashboardValueLabel, dashboardWidgetDetail, type DashboardWidget } from '../lib/dashboard-metrics';
import { DASHBOARD_SIZE_SPANS, DASHBOARD_ZONE_COLUMNS, resolveDashboardRenderLayout } from '../lib/dashboard-layout';
import type { AnalyticsBucket } from '../types/safe';

type GeneralWorkspaceProps = {
  onWidgetNavigate: (widget: DashboardWidget, bucket?: AnalyticsBucket) => void;
  onUnauthorized: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  includeInternal: boolean;
};

export function GeneralWorkspace({ onWidgetNavigate, onUnauthorized, onError, onNotice, includeInternal }: GeneralWorkspaceProps) {
  const preferences = useDashboardPreferences({ onUnauthorized, onError, onNotice, includeInternal });
  const [customizing, setCustomizing] = useState<'manage' | 'create' | null>(null);
  const dataWidgets = preferences.widgets.filter((widget) => widget.kind === 'count');
  const visualWidgets = preferences.widgets.filter((widget) => widget.kind !== 'count');
  const usesCompactVisualGrid = visualWidgets.length === 6;
  const layout = usesCompactVisualGrid
    ? visualWidgets.map((widget, position) => ({ widget, position, size: 'sm' as const }))
    : resolveDashboardRenderLayout(visualWidgets);

  return <>
    <section className="personal-dashboard" aria-label="Mi panel de métricas">
      <div className="personal-dashboard-heading"><div><p className="eyebrow">MI VISTA</p><h2>Lo que elegiste seguir</h2><span className="database-caption">Tus filtros, contadores y objetivos sobre el inventario actual.</span></div><button type="button" className="button subtle" title="Ordenar, editar o eliminar las métricas de tu vista" onClick={() => setCustomizing('manage')}><SlidersHorizontal size={14} /> Editar vista</button></div>
      {preferences.loading ? <StateBlock variant="loading" title="Cargando tu panel..." />
        : preferences.widgets.length ? <div className="personal-dashboard-content">
          {dataWidgets.length ? <section className="dashboard-data-section" aria-labelledby="dashboard-data-title">
            <div className="dashboard-section-heading"><div><h3 id="dashboard-data-title">Datos clave</h3><p>Lectura rápida del inventario actual.</p></div><span>{dataWidgets.length} {dataWidgets.length === 1 ? 'dato' : 'datos'}</span></div>
            <div className="dashboard-data-strip">{dataWidgets.map((widget) => <DashboardDataItem key={widget.widget_id} widget={widget} onNavigate={onWidgetNavigate} />)}</div>
          </section> : null}
          {visualWidgets.length ? <section className="dashboard-visual-section" aria-labelledby="dashboard-visual-title">
            <div className="dashboard-section-heading"><div><h3 id="dashboard-visual-title">Gráficos y objetivos</h3><p>Comparaciones que necesitan más contexto visual.</p></div><span>{visualWidgets.length} {visualWidgets.length === 1 ? 'bloque' : 'bloques'}</span></div>
            <div className={`metrics personal-dashboard-metrics ${usesCompactVisualGrid ? 'compact-visual-grid' : ''}`.trim()}>{layout.map(({ widget, position, size }) => {
          const span = DASHBOARD_SIZE_SPANS[size];
          const col = position % DASHBOARD_ZONE_COLUMNS;
          const row = Math.floor(position / DASHBOARD_ZONE_COLUMNS);
          const style = { gridColumn: `${col + 1} / span ${span.cols}`, gridRow: `${row + 1} / span ${span.rows}` };
          return widget.kind === 'chart'
            ? <article className="metric-button personal-metric-button personal-chart-card" key={widget.widget_id} style={style}>
                <div className="personal-chart-heading"><span className="metric-label">{widget.title}</span><small>{dashboardWidgetDetail(widget)}</small></div>
                {widget.chart?.style === 'bars'
                  ? <BarList buckets={widget.buckets ?? []} emptyHint="Sin datos para este corte." onBucketSelect={(bucket) => onWidgetNavigate(widget, bucket)} />
                  : widget.chart?.style === 'pie'
                    ? <PieChart buckets={widget.buckets ?? []} onBucketSelect={(bucket) => onWidgetNavigate(widget, bucket)} />
                    : widget.chart ? <AdvancedChart title={widget.title} style={widget.chart.style} data={widget.chart_data} onSelect={(filterValue) => onWidgetNavigate(widget, { key: filterValue, filter_value: filterValue, count: 0 })} /> : null}
              </article>
            : <button type="button" className="metric-button personal-metric-button" key={widget.widget_id} style={style} onClick={() => onWidgetNavigate(widget)} aria-label={`${widget.title}: ${dashboardValueLabel(widget)}. Abrir resultados`}><div className="metric dashboard-goal"><span className="metric-label">{widget.title}</span><strong>{dashboardValueLabel(widget)}<small> / {widget.target_value}</small></strong><span className="dashboard-goal-meta">{widget.period_label || 'Sin período'} · {dashboardGoalProgress(widget)}%</span><span className="dashboard-goal-track" aria-hidden="true"><span style={{ width: `${dashboardGoalProgress(widget)}%` }} /></span><small>{dashboardWidgetDetail(widget)}</small></div><ArrowRight size={15} /></button>;
        })}</div>
          </section> : null}
          <button type="button" className="dashboard-create-card" title="Crear un dato, gráfico u objetivo para tu vista" onClick={() => setCustomizing('create')}><span className="dashboard-create-icon"><Plus size={18} /></span><span><strong>Agregar a la vista</strong><small>Dato compacto, gráfico u objetivo</small></span></button>
        </div>
        : <StateBlock variant="empty" title="Tu vista está vacía" hint="Creá contadores u objetivos con los filtros que importan para tu trabajo." action={<button type="button" className="button primary" onClick={() => setCustomizing('create')}><Plus size={14} /> Crear métrica</button>} />}
    </section>
    {customizing ? <DashboardCustomizer mode={customizing} widgets={preferences.widgets} saving={preferences.saving} onSave={preferences.save} onClose={() => setCustomizing(null)} includeInternal={includeInternal} /> : null}
  </>;
}
