import { DateTime } from '../../../cross/components/date-time';
import { netskopeUsersReference, netskopeWidgetDefinition } from '../lib/netskope-dashboard';
import { formatNumber } from '../../../cross/lib/format';
import type { NetskopeSelectedMetrics as NetskopeMetrics, NetskopeWidgetInstance } from '../types/netskope';
import { CircleHelp } from 'lucide-react';
import { MetricReading } from '../../../cross/components/metric-reading';
import { netskopeSyncStatement } from '../lib/netskope-sync-evidence';
import { usePopover } from '../../../cross/hooks/use-popover';

// Bounded pilot: only inventory metrics with existing counts and
// semantics. Alert aggregates and cross-user metrics keep their own contracts.
const FORMULAS: Partial<Record<NetskopeWidgetInstance['id'], string>> = {
  users_total: 'Conteo de identidades Netskope activas en el inventario: las que tienen al menos una cuenta no borrada. Habilitado es tener una cuenta activa; el resto está deshabilitado.',
  users_recent_activity: 'Cada identidad se cuenta una vez si tiene al menos un dispositivo resuelto por ID o correo exacto con un evento en la ventana elegida. El porcentaje usa el total de identidades en inventario.',
  devices_total: 'Conteo de dispositivos activos cuyo último evento cae en los últimos 7 días. Cuenta cualquier tipo de evento (latido de DEM, túnel, apagado, instalación o desinstalación); un evento fechado hasta 1 hora por delante del reloj se acepta porque los latidos llegan sellados con adelanto.',
  devices_stale_30d: 'Conteo de dispositivos activos de todo el inventario (no sólo los de los últimos 7 días) cuyo último evento válido tiene más de 30 días; sin porcentaje, porque no comparte población con «Dispositivos». Es la misma regla de antigüedad que «Candidatos a revisar» en Postura.',
  devices_by_os: 'Conteo por sistema operativo entre dispositivos con evento en 7 días. El Top-8 muestra porcentajes sobre esa población; el resto sólo se calcula con total coherente.',
  devices_by_client: 'Conteo por versión de cliente entre dispositivos con evento en 7 días. El Top-8 muestra porcentajes sobre esa población; el resto sólo se calcula con total coherente.',
  devices_by_make: 'Conteo por fabricante entre dispositivos con evento en 7 días. El Top-8 muestra porcentajes sobre esa población; el resto sólo se calcula con total coherente.',
  devices_by_classification: 'Conteo por clasificación entre dispositivos con evento en 7 días. El Top-8 muestra porcentajes sobre esa población; el resto sólo se calcula con total coherente.',
  devices_by_user_status: 'Conteo por estado de usuario informado entre dispositivos con evento en 7 días. El Top-8 muestra porcentajes sobre esa población; el resto sólo se calcula con total coherente.',
  devices_by_company: 'Conteo por empresa del usuario observado entre dispositivos con evento en 7 días. El Top-40 muestra porcentajes sobre esa población; el resto sólo se calcula con total coherente.',
  users_by_company: 'Conteo por dominio corporativo del correo entre identidades en inventario. El Top-40 muestra porcentajes sobre esa población; el resto sólo se calcula con total coherente.',
};

/* The 7- and 30-day windows are read against the time of the query, while the data only changes with each
   sync, so a count moves by a device or two between queries and against the Netskope console. */
/* Where Custodia's 7-day device and user counts can differ from the Netskope console's «Devices» page. Measured on
   2026-10-09: the API returns the same 4.525 devices and 4.413 users as the console, so the gap is how each side counts. */
const CONSOLE_DEVICES_GAP = 'Frente a la página «Devices» de la consola de Netskope (últimos 7 días) puede haber unos pocos equipos de diferencia: un equipo que apareció después del último sync (los datos se actualizan cada 30 min), un evento fechado a más de 1 hora por delante del reloj (se considera no confiable) y la ventana móvil de 7 días, que se corre unos 3 equipos por hora. ';
const CONSOLE_USERS_GAP = 'Frente al conteo de usuarios de la consola de Netskope (últimos 7 días) la diferencia esperada es de unas pocas decenas. La consola cuenta los nombres de usuario que aparecen en equipos con evento; Custodia cuenta identidades del inventario que tienen al menos un equipo con evento. Quedan fuera de Custodia los usuarios con todas sus cuentas borradas en Netskope cuyos equipos siguen reportando (unos 10 el 9 oct 2026), y un usuario cuyo único equipo reciente tiene fecha futura fuera de tolerancia. ';
const WINDOW_LIMIT = 'La ventana se mide contra la hora de la consulta y los datos sólo cambian con cada sync (cada 30 min): la cifra puede variar en uno o dos equipos entre consultas y frente a la consola de Netskope. ';

function repeatedExplanation(gap: number, repeated: number | null | undefined): string {
  if (typeof repeated !== 'number') return 'La última sincronización no guardó cuántas filas llegaron repetidas, así que la diferencia no se puede conciliar con exactitud.';
  if (repeated === gap) return `En la última sincronización la API devolvió ${formatNumber(repeated)} ${repeated === 1 ? 'fila repetida' : 'filas repetidas'}: explican exactamente la diferencia.`;
  return `En la última sincronización la API devolvió ${formatNumber(repeated)} ${repeated === 1 ? 'fila repetida' : 'filas repetidas'}, que no explican por completo la diferencia de ${formatNumber(Math.abs(gap))}: queda ${formatNumber(Math.abs(gap - repeated))} sin explicar y conviene revisar el sync.`;
}

function usersReferenceLimit(metrics: NetskopeMetrics | null): string {
  const reference = netskopeUsersReference(metrics);
  if (!reference) return '';
  const accounts = typeof metrics?.accounts_reported_active === 'number' && typeof metrics?.accounts_reported_inactive === 'number'
    ? ` Su consola también informa ${formatNumber(metrics.accounts_reported_active)} cuentas habilitadas y ${formatNumber(metrics.accounts_reported_inactive)} deshabilitadas${typeof metrics.ous_reported_total === 'number' ? `, ${formatNumber(metrics.ous_reported_total)} OUs` : ''}${typeof metrics.groups_reported_total === 'number' ? ` y ${formatNumber(metrics.groups_reported_total)} grupos` : ''}.` : '';
  return `Conciliación con Netskope: su consola informa ${formatNumber(reference.reported)} usuarios («Total Users») y Custodia lista ${formatNumber(reference.listed)}. ${reference.label}. La cifra de Netskope cuenta filas, no identidades distintas: su API de usuarios devuelve a algunos usuarios dos veces al paginar (mismo id y mismo contenido) y la consola los suma dos veces; Custodia los une por id y cuenta cada identidad una vez. Ambos excluyen a quien tiene todas sus cuentas borradas. ${repeatedExplanation(reference.reported - reference.listed, metrics?.users_repeated_rows)}${accounts} `;
}

export function NetskopeMetricReading({ instance, metrics, activityDays = 7, expanded = false }: {
  instance: NetskopeWidgetInstance; metrics: NetskopeMetrics | null; activityDays?: 7 | 14 | 30; expanded?: boolean;
}) {
  const formula = FORMULAS[instance.id];
  const definition = netskopeWidgetDefinition(instance.id);
  if (!formula || !definition) return null;
  const users = instance.id.startsWith('users_');
  const stale = instance.id === 'devices_stale_30d';
  const population = users ? metrics?.users_total : stale ? metrics?.devices_stale_30d : metrics?.devices_total;
  const filters = Object.entries(instance.filters ?? {}).filter(([, value]) => value).map(([key, value]) => `${key === 'os' ? 'SO' : key === 'company' ? 'Empresa' : 'Clasificación'}: ${value}`).join(' · ');
  const buckets = metrics?.[instance.id as 'devices_by_os'];
  const unknownBucket = Array.isArray(buckets) ? buckets.find((bucket) => bucket.key === 'Sin dato') : undefined;
  const unknown = unknownBucket?.count;
  const noPopulation = population === 0;
  const activityMissing = instance.id === 'users_recent_activity' && typeof metrics?.[`users_with_device_activity_${activityDays}d`] !== 'number';
  const period = users ? instance.id === 'users_recent_activity' ? `Últimos ${activityDays} días` : 'Inventario vigente' : stale ? 'Inventario observado · último evento de más de 30 días' : 'Últimos 7 días';
  return <MetricReading expanded={expanded} title={definition.title} meaning={definition.description}
    population={`${stale ? 'Dispositivos activos de todo el inventario' : `${typeof population === 'number' ? formatNumber(population) : 'Cantidad no informada'} ${users ? 'identidades en inventario' : 'dispositivos con evento en 7 días'}`}${filters ? ` · ${filters}` : ''}`}
    capture={<>{period} · {metrics?.last_observed_at ? <>último inventario observado <DateTime value={metrics.last_observed_at} /></> : 'Fecha de observación no informada'}</>}
    formula={formula} source="Inventario Netskope sincronizado en Custodia; filtros del widget aplicados en su consulta."
    limits={`${instance.id === 'users_total' ? usersReferenceLimit(metrics) : ''}${instance.id === 'devices_total' ? CONSOLE_DEVICES_GAP : ''}${instance.id === 'users_recent_activity' ? CONSOLE_USERS_GAP : ''}${instance.id === 'devices_total' ? 'Un latido de DEM prueba que el cliente reportó, no que alguien use el equipo; un evento de desinstalación o de falla también cuenta como señal reciente. ' : ''}${users ? '' : WINDOW_LIMIT}No prueba login, conexión en vivo, uso humano, propiedad del equipo ni cobertura DLP. La fecha de observación del inventario no es la fecha del último evento del cliente.${stale ? ` ${netskopeSyncStatement(metrics?.source_evidence).text}: la cifra cuenta lo observado en el último inventario; «candidato a revisión» sólo se evalúa con un sync completo vigente.` : ''}`}
    unknowns={`${stale ? 'Equipos con fecha de último evento ausente, no numérica, no positiva o futura quedan fuera de este conteo. ' : ''}${noPopulation ? stale ? '0 equipos cumplen el corte de más de 30 días. ' : 'Sin población: porcentaje no calculable. ' : ''}${activityMissing || typeof population !== 'number' ? 'No calculable con la información disponible. ' : ''}${typeof unknown === 'number' ? `Sin dato en el gráfico: ${formatNumber(unknown)}.` : 'Desconocidos: conteo no informado; no se asume cero.'}`} />;
}

export const hasNetskopeMetricReading = (id: NetskopeWidgetInstance['id']) => Boolean(FORMULAS[id]);

/** Same pattern as the CyberArk key data: a "?" button opens the full reading
 * (what it measures, population, period, unknowns, formula, source, limits). */
export function NetskopeDataHelp({ instance }: { instance: NetskopeWidgetInstance }) {
  const { open, setOpen, ref } = usePopover<HTMLDivElement>();
  const definition = netskopeWidgetDefinition(instance.id);
  if (!definition) return null;
  const tooltipId = `netskope-data-help-${instance.id}`;
  return <div ref={ref}>
    <button type="button" className={`dashboard-data-help ${open ? 'active' : ''}`.trim()} aria-label={`Qué mide: ${definition.title}`} aria-controls={tooltipId} aria-expanded={open} title={`Qué mide ${definition.title}`} onClick={() => setOpen((current) => !current)}><CircleHelp size={15} aria-hidden /></button>
    {open ? <section className="dashboard-data-tooltip netskope-data-tooltip" id={tooltipId} role="note">
      <strong>Qué mide</strong>
      <p>{definition.description}</p>
      <a href="/help?section=netskope">Más detalles en Ayuda <span aria-hidden="true">→</span></a>
    </section> : null}
  </div>;
}

/** Chart cards keep only the title and the bars; the full reading (what it measures, population, period, unknowns, formula, limits) opens from a "?". */
export function NetskopeChartHelp({ instance, metrics }: { instance: NetskopeWidgetInstance; metrics: NetskopeMetrics | null }) {
  const { open, setOpen, ref } = usePopover<HTMLDivElement>();
  const definition = netskopeWidgetDefinition(instance.id);
  if (!definition || !hasNetskopeMetricReading(instance.id)) return null;
  const tooltipId = `netskope-chart-help-${instance.id}`;
  return <div ref={ref}>
    <button type="button" className={`dashboard-data-help netskope-chart-help ${open ? 'active' : ''}`.trim()} aria-label={`Qué mide: ${definition.title}`} aria-controls={tooltipId} aria-expanded={open} title={`Qué mide ${definition.title}`} onClick={() => setOpen((current) => !current)}><CircleHelp size={15} aria-hidden /></button>
    {open ? <section className="dashboard-data-tooltip netskope-data-tooltip netskope-chart-tooltip" id={tooltipId} role="note">
      <NetskopeMetricReading instance={instance} metrics={metrics} expanded />
    </section> : null}
  </div>;
}
