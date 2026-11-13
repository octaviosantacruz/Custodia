const EVENT_LABELS = new Map<string, string>([
  ['Uninstalled', 'Cliente desinstalado'],
  ['Disconnected By Uninstall', t('Desconectado por desinstalación')],
  ['Admin Disabled', t('Deshabilitado por un administrador')],
  ['Installed', 'Cliente instalado'],
  ['Tunnel Up', t('Túnel activo')],
  ['Tunnel Down', t('Túnel caído')],
  ['Tunnel down due to error', t('Túnel caído por error')],
  ['Tunnel down due to error in Modern Standby mode', t('Túnel caído por error en Modern Standby')],
  ['System Shutdown', t('Apagado del sistema')],
  ['System power-up', t('Encendido del sistema')],
  ['Dem Heartbeat', t('Heartbeat de DEM')],
  ['unknown', 'Evento desconocido'],
]);

export function netskopeEventLabel(literal: string): { label: string; literal: string; known: boolean } {
  const label = EVENT_LABELS.get(literal);
  return { label: label ?? literal, literal, known: label !== undefined };
}

import { t } from '../../../cross/i18n/index.ts';