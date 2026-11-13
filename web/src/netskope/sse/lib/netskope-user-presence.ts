/* Where a user connects from, read from the inventory devices linked to them by exact
   username (the same link the inventory uses) and Netskope's own On-Premises Detection
   on each device. A user is "in office" when any device with a recent signal is, and
   "outside" only when every device Netskope could classify is off-prem. */
import type { NetskopeRow } from '../types/netskope';
import { t } from '../../../cross/i18n/index.ts';

export type UserDevicePresence = {
  objectId: number;
  name: string;
  os: string;
  /** Netskope's raw value: on-prem, off-prem, unconfig, Unknown or '' when not stored yet. */
  status: string;
  config: string;
  recent: boolean;
  lastSignalAt: string | null;
};

export type UserPresenceVerdict = 'office' | 'remote' | 'unknown' | 'no_recent' | 'no_devices';

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export function userDevicePresence(row: NetskopeRow): UserDevicePresence {
  const os = [text(row.attributes.os), text(row.attributes.os_version)].filter(Boolean).join(' ');
  return {
    objectId: row.object_id,
    name: row.display_name || text(row.attributes.hostname) || row.source_id,
    os,
    status: text(row.attributes.onprem_status),
    config: text(row.attributes.client_config),
    recent: row.device_evidence?.state === 'recent',
    lastSignalAt: row.device_evidence?.last_signal_at ?? null,
  };
}

export function userPresenceVerdict(devices: readonly UserDevicePresence[]): UserPresenceVerdict {
  if (devices.length === 0) return 'no_devices';
  const recent = devices.filter((device) => device.recent);
  if (recent.length === 0) return 'no_recent';
  if (recent.some((device) => device.status === 'on-prem')) return 'office';
  return recent.some((device) => device.status === 'off-prem') ? 'remote' : 'unknown';
}

export const USER_PRESENCE_LABELS: Record<UserPresenceVerdict, string> = {
  office: 'En oficina',
  remote: t('Fuera de oficina'),
  unknown: t('Sin dato de ubicación'),
  no_recent: t('Sin señal reciente'),
  no_devices: t('Sin equipos vinculados'),
};

export function userPresenceTone(verdict: UserPresenceVerdict): 'success' | 'info' | 'neutral' {
  return verdict === 'office' ? 'success' : verdict === 'remote' ? 'info' : 'neutral';
}

/** Recent devices first, then by name. */
export function sortUserDevices(devices: readonly UserDevicePresence[]): UserDevicePresence[] {
  return [...devices].sort((left, right) => Number(right.recent) - Number(left.recent) || left.name.localeCompare(right.name));
}
