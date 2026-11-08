import { DateTime } from '../../../cross/components/date-time';
import { StateBlock } from '../../../cross/components/state-block';
import { PieChart } from '../../../cross/components/pie-chart';
import { formatNumber } from '../../../cross/lib/format';
import { useNetskopePanel } from '../hooks/use-netskope-panel';
import { fetchNetskopeAaSeverity } from '../lib/netskope-api';
import { normalizeNetskopeAlertBuckets } from '../lib/netskope-dashboard';
import { t } from '../../../cross/i18n/index.ts';

type Props = { compact?: boolean; enabled: boolean; refreshKey?: number; onUnauthorized: () => void };

/** Only mounted for a selected severity widget; no database fallback. */
export function NetskopeAaSeverity({ compact = false, enabled, refreshKey, onUnauthorized }: Props) {
  const panel = useNetskopePanel({ cacheKey: ['aa', 'severity'], enabled, refreshKey, onUnauthorized, load: fetchNetskopeAaSeverity });
  const metric = panel.data;
  const title = metric?.scope === 'dlp' ? t('Severidad DLP · Advanced Analytics') : t('Severidad · Advanced Analytics');
  const unit = metric?.unit === 'incidents' ? t('Incidentes') : t('Eventos');
  const hint = metric?.window_days
    ? `Ventana guardada: últimos ${metric.window_days} días · ${metric.timezone} · ${unit}`
    : 'Métrica agregada desde Netskope';
  return <>
    <div className={compact ? undefined : 'personal-chart-heading'}><strong>{title}</strong><small>{hint}</small></div>
    {panel.error ? <StateBlock variant="error" title={t('No se pudo consultar Advanced Analytics')} hint={panel.error} action={<button className="button subtle" type="button" onClick={() => void panel.reload()}>{t('Reintentar')}</button>} />
      : !metric ? <StateBlock variant="loading" title={t('Consultando Advanced Analytics…')} />
      : metric.state === 'not_configured' ? <StateBlock title={t('Widget AA sin configurar')} hint="Falta seleccionar un agregado de severidad y confirmar su período." />
      : metric.state === 'pending_validation' ? <StateBlock title={t('Definición AA pendiente de validación')} hint="Confirmá la población, unidad, período y filtros guardados antes de habilitar este agregado." />
      : metric.state === 'empty' ? <StateBlock title={t('El widget AA no devolvió filas')} hint="No hay un conteo disponible para este período." />
      : <>
        <PieChart size={compact ? 84 : undefined} thickness={compact ? 15 : undefined} buckets={normalizeNetskopeAlertBuckets('by_severity', metric.buckets)} />
        <small>{formatNumber(metric.total ?? 0)} {unit.toLocaleLowerCase('es')} · Consultado <DateTime value={metric.fetched_at} />{panel.loading ? t(' · Actualizando…') : ''}</small>
      </>}
  </>;
}
