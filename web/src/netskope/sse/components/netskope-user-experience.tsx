import { DateTime } from '../../../cross/components/date-time';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Laptop2, MapPin, RefreshCw } from 'lucide-react';
import { ApiError } from '../../../cross/lib/api';
import { fetchNetskopeExperienceDevices, fetchNetskopeExperienceDetail } from '../lib/netskope-api';
import { epochSecondsToIso } from '../../../cross/lib/format';
import { StateBlock } from '../../../cross/components/state-block';
import { HelpHint } from '../../../cross/components/help-hint';
import { t } from '../../../cross/i18n/index.ts';

const WINDOWS = [2, 24, 48] as const;


type Props = {
  userId: number;
  user?: { label: string; detail: string };
  refreshKey?: number;
  onUnauthorized?: () => void;
};

export function NetskopeUserExperience({ userId, user, refreshKey = 0, onUnauthorized }: Props) {
  const [hours, setHours] = useState<2 | 24 | 48>(2);
  const [deviceId, setDeviceId] = useState('');
  const devices = useQuery({
    queryKey: ['netskope', 'experience', 'devices', userId, hours, refreshKey],
    queryFn: ({ signal }) => fetchNetskopeExperienceDevices(userId, hours, signal),
    retry: false, staleTime: 60_000, refetchOnWindowFocus: false,
  });
  const window = devices.data;
  const effectiveDeviceId = deviceId || (window?.devices.length === 1 ? window.devices[0].device_id : '');
  const selected = window?.devices.find((device) => device.device_id === effectiveDeviceId);
  const detail = useQuery({
    queryKey: ['netskope', 'experience', 'detail', userId, selected?.device_id, window?.window_start, window?.window_end],
    enabled: Boolean(selected && window) && !devices.isError,
    queryFn: ({ signal }) => fetchNetskopeExperienceDetail(userId, selected!.device_id, window!, signal),
    retry: false, staleTime: 60_000, refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if ([devices.error, detail.error].some((error) => error instanceof ApiError && error.status === 401)) onUnauthorized?.();
  }, [devices.error, detail.error, onUnauthorized]);

  return <section className="detail-section" aria-label={t('Observaciones del usuario Netskope')}>
    <div className="netskope-experience-toolbar">
      <h3>{t('Observaciones por dispositivo')}</h3>
      <div className="netskope-experience-actions">
        <div className="netskope-window-picker" role="group" aria-label={t('Ventana de observación ADEM')}>
          {WINDOWS.map((value) => <button key={value} type="button" aria-label={`${value} horas`} aria-pressed={hours === value} onClick={() => { setHours(value); setDeviceId(''); }}>{value} h</button>)}
        </div>
        <button className="button subtle" type="button" disabled={devices.isFetching || detail.isFetching} onClick={() => void devices.refetch()}><RefreshCw size={13} aria-hidden /> {t('Actualizar')}</button>
      </div>
    </div>
    {devices.isPending && <StateBlock variant="loading" title={t('Consultando dispositivos ADEM')} />}
    {devices.isError && <StateBlock variant="error" title={t('No se pudieron consultar los dispositivos ADEM')} hint="Verificá disponibilidad y permisos del token. La consulta puede reintentarse con Actualizar." />}
    {window && !devices.isError && <>
      <p className="netskope-experience-window" title={`Ventana de ${hours} h · observación histórica de ADEM`}><DateTime value={epochSecondsToIso(window.window_start)} /> – <DateTime value={epochSecondsToIso(window.window_end)} /></p>
      {window.devices.length === 0 ? <StateBlock variant="empty" title={t('Sin dispositivos observados en esta ventana')} /> : <div className="netskope-experience-observations" role="region" aria-label={`Observaciones de ${user?.label || `usuario Netskope ${userId}`}`}>
        <div className="netskope-experience-device-column">
          <span className="netskope-experience-column-label">{window.devices.length === 1 ? 'Dispositivo observado' : `${window.devices.length} dispositivos observados`}</span>
          {window.devices.map((device) => {
            const label = device.device_name || device.device_id;
            const os = device.device_os || 'SO sin dato';
            return <button key={device.device_id} type="button" className="netskope-experience-device" aria-pressed={selected?.device_id === device.device_id} aria-label={`Consultar ${label}, ${os}`} onClick={() => setDeviceId(device.device_id)}>
              <span className="netskope-experience-icon"><Laptop2 size={17} aria-hidden /></span>
              <span><strong>{label}</strong><small>{os}</small><em>{device.device_id}</em></span>
            </button>;
          })}
        </div>
        <article className="netskope-experience-pop" aria-live="polite">
          <span className="netskope-experience-icon"><MapPin size={18} aria-hidden /></span>
          <span><small>{t('POP informado por ADEM')} <HelpHint label={t('POP informado por ADEM')}><p>{t('No representa latencia, ubicación personal, egreso, cobertura ni ruta de red, y no confirma conexión en vivo. No se vincula con el ID del inventario SSE.')}</p></HelpHint></small>
            {!selected ? <strong>{t('Elegí un dispositivo')}</strong> : null}
            {selected && detail.isPending ? <strong>{t('Consultando…')}</strong> : null}
            {selected && detail.isError ? <><strong>{t('No disponible')}</strong><button className="button subtle" type="button" onClick={() => void detail.refetch()}>{t('Reintentar')}</button></> : null}
            {detail.data && !detail.isError ? <><strong className="mono">{detail.data.pop || 'Sin dato'}</strong><em>{detail.data.last_activity === null ? 'Última actividad: Sin dato' : <>{t('Última actividad:')} <DateTime value={epochSecondsToIso(detail.data.last_activity)} /></>}</em></> : null}
          </span>
        </article>
      </div>}
    </>}
    {detail.data?.activity_status === 'outside_window' ? <p className="netskope-experience-freshness is-warning">{t('Fecha fuera de la ventana consultada.')}</p> : null}
    {detail.data?.activity_status === 'unknown' ? <p className="netskope-experience-freshness">{t('Sin dato de última actividad.')}</p> : null}
  </section>;
}
