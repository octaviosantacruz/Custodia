const EVENT_LABELS = new Map<string, string>([
  ['Uninstalled', 'Cliente desinstalado'],
  ['Disconnected By Uninstall', 'Desconectado por desinstalación'],
  ['Admin Disabled', 'Deshabilitado por un administrador'],
  ['Installed', 'Cliente instalado'],
  ['Tunnel Up', 'Túnel activo'],
  ['Tunnel Down', 'Túnel caído'],
  ['Tunnel down due to error', 'Túnel caído por error'],
  ['Tunnel down due to error in Modern Standby mode', 'Túnel caído por error en Modern Standby'],
  ['System Shutdown', 'Apagado del sistema'],
  ['System power-up', 'Encendido del sistema'],
  ['Dem Heartbeat', 'Heartbeat de DEM'],
  ['unknown', 'Evento desconocido'],
]);

export function netskopeEventLabel(literal: string): { label: string; literal: string; known: boolean } {
  const label = EVENT_LABELS.get(literal);
  return { label: label ?? literal, literal, known: label !== undefined };
}
