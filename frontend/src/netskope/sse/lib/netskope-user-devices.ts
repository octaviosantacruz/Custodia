/* One row per device of the selected user. Inventory devices carry location and client config; ADEM devices
   carry the scores and the POP. They are joined only by the backend's exact, unique name link (ADR 006),
   exposed as `inventory_device_id`; an unlinked device keeps its own side and shows "Sin dato" for the other. */
import type { NetskopeExperienceDeviceScore } from '../types/netskope';
import type { UserDevicePresence } from './netskope-user-presence';

export type UserDeviceRow = {
  key: string;
  name: string;
  os: string;
  /** null when ADEM lists the device but the inventory link is not unique: location is then "Sin dato". */
  presence: UserDevicePresence | null;
  adem: NetskopeExperienceDeviceScore | null;
  linked: boolean;
};

export function mergeUserDevices(presence: readonly UserDevicePresence[], adem: readonly NetskopeExperienceDeviceScore[]): UserDeviceRow[] {
  const known = new Set(presence.map((device) => device.objectId));
  const byInventory = new Map<number, NetskopeExperienceDeviceScore>();
  for (const device of adem) if (device.inventory_device_id !== null && known.has(device.inventory_device_id)) byInventory.set(device.inventory_device_id, device);
  const rows: UserDeviceRow[] = presence.map((device) => {
    const match = byInventory.get(device.objectId) ?? null;
    return { key: `inventory-${device.objectId}`, name: device.name, os: device.os, presence: device, adem: match, linked: match !== null };
  });
  for (const device of adem) {
    // An ADEM device is dropped only when it is already merged into an inventory row; a link to a device
    // that was not loaded keeps its own ADEM row instead of disappearing.
    if (device.inventory_device_id !== null && known.has(device.inventory_device_id)) continue;
    rows.push({ key: `adem-${device.device_id}`, name: device.device_name || device.device_id, os: device.device_os || '', presence: null, adem: device, linked: false });
  }
  return rows;
}

/** Rows with a recent signal first, then those with ADEM data, then by name. */
export function sortUserDeviceRows(rows: readonly UserDeviceRow[]): UserDeviceRow[] {
  const rank = (row: UserDeviceRow) => (row.presence?.recent ? 0 : row.presence ? 2 : 1);
  return [...rows].sort((left, right) => rank(left) - rank(right) || left.name.localeCompare(right.name));
}
