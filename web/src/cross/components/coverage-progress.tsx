import { useQuery } from '@tanstack/react-query';
import { Camera } from 'lucide-react';
import { useState } from 'react';
import { fetchCoverageProgress, takeCoverageSnapshot } from '../lib/connection-inventory-api';
import { capabilitySegments, trendGeometry, workSegments, xOfN } from '../lib/coverage-progress';
import { dateTimeHint, formatDate, formatNumber } from '../lib/format';
import type { CoverageBlock, CoveragePoint } from '../types/connection';
import { StackedBar } from './stacked-bar';
import { StaleDestinations } from './stale-destinations';
import { StateBlock } from './state-block';
import { t } from '../i18n/index.ts';

type Props = { refreshKey: number; canManage: boolean; onError: (message: string) => void; onNotice: (message: string) => void };

const WIDTH = 640;
const HEIGHT = 200;

function Card({ title, headline, children }: { title: string; headline: string; children: React.ReactNode }) {
  return <section className="progress-card"><h2>{title}</h2><p className="progress-headline">{headline}</p>{children}</section>;
}

function Trend({ points }: { points: CoveragePoint[] }) {
  const { top, lines, x, y } = trendGeometry(points, WIDTH, HEIGHT);
  const last = points[points.length - 1];
  const summary = lines.map((line) => `${line.label}: ${line.values[line.values.length - 1]}`).join(', ');
  return <figure className="progress-trend">
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={t('Evolución semanal hasta {snapshot_date}. {value} de {n} destinos.', { snapshot_date: last.snapshot_date, value: summary, n: last.n })}>
      <line className="progress-axis" x1="28" y1={y(0)} x2={WIDTH - 28} y2={y(0)} />
      <text className="progress-tick" x="2" y={y(top) + 4}>{top}</text>
      <text className="progress-tick" x="12" y={y(0) + 4}>0</text>
      {lines.map((line) => <polyline key={line.key} className={`progress-line is-${line.key}`} points={line.points} fill="none" />)}
      {lines.map((line) => points.map((point, index) => <circle key={`${line.key}-${point.snapshot_date}`} className={`progress-dot is-${line.key}`} cx={x(index)} cy={y(line.values[index])} r="3"><title>{`${line.label} · ${point.snapshot_date}: ${xOfN(line.values[index], point.n)}`}</title></circle>))}
      <text className="progress-tick" x="28" y={HEIGHT - 6}>{points[0].snapshot_date}</text>
      <text className="progress-tick" x={WIDTH - 28} y={HEIGHT - 6} textAnchor="end">{last.snapshot_date}</text>
    </svg>
    <figcaption><ul className="progress-legend">{lines.map((line) => <li key={line.key}><i className={`is-${line.key}`} />{line.label}</li>)}</ul></figcaption>
  </figure>;
}

export function CoverageProgress({ refreshKey, canManage, onError, onNotice }: Props) {
  const query = useQuery({ queryKey: ['cross', 'coverage-progress', refreshKey], queryFn: ({ signal }) => fetchCoverageProgress(signal) });
  const [saving, setSaving] = useState(false);

  const snapshot = async () => {
    setSaving(true); onError('');
    try { await takeCoverageSnapshot(); onNotice(t('Foto de hoy guardada')); await query.refetch(); }
    catch (error) { onError(error instanceof Error ? error.message : t('No se pudo guardar la foto')); }
    finally { setSaving(false); }
  };

  if (query.isLoading) return <StateBlock variant="loading" title={t('Calculando el avance…')} />;
  if (query.error || !query.data) return <StateBlock variant="error" title={t('No se pudo calcular el avance')} hint={query.error instanceof Error ? query.error.message : undefined} action={<button type="button" className="button subtle" onClick={() => void query.refetch()}>{t('Reintentar')}</button>} />;

  const { current, series } = query.data;
  const total: CoverageBlock = current.total;
  if (total.n === 0) return <StateBlock variant="empty" title={t('Todavía no hay destinos activos para medir.')} hint="Importá la planilla en Destinos para empezar." />;

  const today: CoveragePoint = { ...total, snapshot_date: new Date().toISOString().slice(0, 10), captured_at: new Date().toISOString() };
  const trend = series.length && series[series.length - 1].snapshot_date === today.snapshot_date ? series : [...series, today];
  const first = trend[0];
  const row = (label: string, count: number, n: number) => <td><strong>{xOfN(count, n)}</strong><span className="table-subvalue">{label}</span></td>;

  return <div className="coverage-progress">
    <div className="progress-cards">
      <Card title={t('Platform')} headline={`${xOfN(total.platform.match, total.n)} coinciden`}><StackedBar segments={capabilitySegments(total.platform)} total={total.n} ariaLabel={t('Platform declarado contra SIA')} /></Card>
      <Card title="DBA" headline={`${xOfN(total.dba.match, total.n)} coinciden`}><StackedBar segments={capabilitySegments(total.dba)} total={total.n} ariaLabel={t('DBA declarado contra SIA')} /></Card>
      <Card title={t('Trabajo')} headline={`${xOfN(total.work.onboarded, total.n)} incorporados`}><StackedBar segments={workSegments(total.work)} total={total.n} ariaLabel={t('Estado de trabajo de los destinos')} /></Card>
    </div>

    <section className="list-panel database-surface progress-panel">
      <div className="compact-table-wrap"><table className="compact-table progress-table">
        <caption className="sr-only">{t('Avance por ambiente')}</caption>
        <thead><tr><th>{t('Ambiente')}</th><th>{t('Destinos')}</th><th>{t('Platform coincide')}</th><th>{t('DBA coincide')}</th><th>{t('Incorporados')}</th><th>{t('Bloqueados')}</th><th>{t('Desvío Platform')}</th><th>{t('Desvío DBA')}</th></tr></thead>
        <tbody>
          {current.by_environment.map((env) => <tr key={env.environment}>
            <td><strong>{env.environment}</strong></td>
            <td className="metric-num">{formatNumber(env.n)}</td>
            {row('Platform', env.platform.match, env.n)}
            {row('DBA', env.dba.match, env.n)}
            {row('Incorporados', env.work.onboarded, env.n)}
            {row('Bloqueados', env.work.blocked, env.n)}
            {row('Platform', env.platform.missing + env.platform.undeclared, env.n)}
            {row('DBA', env.dba.missing + env.dba.undeclared, env.n)}
          </tr>)}
          <tr className="progress-total"><td><strong>{t('Total')}</strong></td><td className="metric-num">{formatNumber(total.n)}</td>
            {row('Platform', total.platform.match, total.n)}{row('DBA', total.dba.match, total.n)}{row('Incorporados', total.work.onboarded, total.n)}{row('Bloqueados', total.work.blocked, total.n)}
            {row('Platform', total.platform.missing + total.platform.undeclared, total.n)}{row('DBA', total.dba.missing + total.dba.undeclared, total.n)}</tr>
        </tbody>
      </table></div>
    </section>

    <section className="list-panel database-surface progress-panel">
      <div className="compact-table-wrap"><table className="compact-table progress-table">
        <caption className="sr-only">{t('Avance por responsable')}</caption>
        <thead><tr><th>{t('Responsable')}</th><th>{t('Destinos')}</th><th>{t('Pendientes')}</th><th>{t('En curso')}</th><th>{t('Incorporados')}</th><th>{t('Bloqueados')}</th></tr></thead>
        <tbody>
          {current.by_responsible.map((person) => <tr key={person.responsible}>
            <td><strong>{person.responsible}</strong></td>
            <td className="metric-num">{formatNumber(person.n)}</td>
            {row('Pendientes', person.work.pending, person.n)}
            {row('En curso', person.work.in_progress, person.n)}
            {row('Incorporados', person.work.onboarded, person.n)}
            {row('Bloqueados', person.work.blocked, person.n)}
          </tr>)}
        </tbody>
      </table></div>
    </section>

    <StaleDestinations refreshKey={refreshKey} />

    <section className="list-panel database-surface progress-panel">
      <div className="progress-trend-head">
        <div><h2>{t('Evolución semanal')}</h2><p className="muted">La última foto de cada semana; se guarda después de cada sync y de cada import.</p></div>
        {canManage && <button type="button" className="button subtle" disabled={saving} onClick={() => void snapshot()}><Camera size={15} aria-hidden /> {saving ? t('Guardando…') : t('Guardar la foto de hoy')}</button>}
      </div>
      {series.length === 0
        ? <p className="muted progress-empty" role="status">{t('Todavía no hay fotos: la serie empieza con la próxima sincronización o import{hoy}.', { hoy: canManage ? t(', o guardando la de hoy') : '' })}</p>
        : <>
          <Trend points={trend} />
          <p className="muted progress-since">{t('Desde')} <time dateTime={first.captured_at} title={dateTimeHint(first.captured_at)}>{formatDate(first.captured_at)}</time>: Platform {xOfN(first.platform.match, first.n)} → {xOfN(total.platform.match, total.n)}; DBA {xOfN(first.dba.match, first.n)} → {xOfN(total.dba.match, total.n)}; incorporados {xOfN(first.work.onboarded, first.n)} → {xOfN(total.work.onboarded, total.n)}.</p>
        </>}
    </section>
  </div>;
}
